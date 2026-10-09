"use strict";
// Login layer tests. No browser, no network. Run: node tools/test-auth.js
//
// Covers: session create/verify round trip, tampering, expiry, the middleware's
// crypto.subtle verifier agreeing with api/_lib/session.js, rate limiting, and
// the auth handlers invoked with mock req/res (setup routes 404 without
// SETUP_TOKEN, options 404 without PASSKEY_CREDENTIAL, verify failures count).

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const SECRET = "test-secret-0123456789abcdef";
process.env.SESSION_SECRET = SECRET;
delete process.env.SETUP_TOKEN;
delete process.env.PASSKEY_CREDENTIAL;
process.env.RP_ID = "oncogenik.test";
process.env.ORIGIN = "https://oncogenik.test";

const S = require(path.join(ROOT, "api/_lib/session.js"));
const rl = require(path.join(ROOT, "api/_lib/ratelimit.js"));

let n = 0;
const tests = [];
function t(name, fn) { tests.push([name, fn]); }

// ---- mocks -----------------------------------------------------------------

function mockReq(opts) {
  opts = opts || {};
  return {
    method: opts.method || "POST",
    headers: Object.assign({ "x-forwarded-for": opts.ip || "203.0.113.5" }, opts.headers || {}),
    body: opts.body,
  };
}
function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    ended: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    end(b) { this.body = b; this.ended = true; },
    json() { return JSON.parse(this.body); },
    cookies() { const sc = headers["set-cookie"]; return Array.isArray(sc) ? sc : sc ? [sc] : []; },
  };
}
async function call(handler, reqOpts) {
  const req = mockReq(reqOpts);
  const res = mockRes();
  await handler(req, res);
  return res;
}
function cookieValue(res, name) {
  for (const c of res.cookies()) {
    const m = c.match(new RegExp("^" + name + "=([^;]*)"));
    if (m) return m[1];
  }
  return undefined;
}

// Load the ESM middleware from a CommonJS test: copy it to a .mjs file and import it.
async function loadMiddleware() {
  const src = fs.readFileSync(path.join(ROOT, "middleware.js"), "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-mw-"));
  const file = path.join(dir, "middleware.mjs");
  fs.writeFileSync(file, src);
  const mod = await import(pathToFileURL(file).href);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}

function flipChar(s, i) {
  const c = s[i] === "A" ? "B" : "A";
  return s.slice(0, i) + c + s.slice(i + 1);
}

// ---- session.js --------------------------------------------------------------

t("session round trip", () => {
  const v = S.createSession();
  assert.match(v, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const p = S.verifySession(v);
  assert.ok(p, "verifies");
  assert.equal(p.sub, "owner");
  assert.equal(p.exp - p.iat, 12 * 60 * 60);
  // payload is exactly {sub, iat, exp}
  assert.deepEqual(Object.keys(p).sort(), ["exp", "iat", "sub"]);
  // whole Cookie header also accepted
  assert.ok(S.verifySession("a=1; og_session=" + v + "; b=2"));
  assert.equal(S.verifySession("a=1; b=2"), null);
  assert.equal(S.verifySession(""), null);
  assert.equal(S.verifySession(undefined), null);
});

t("tampered signature and payload rejected", () => {
  const v = S.createSession();
  const [payload, mac] = v.split(".");
  assert.equal(S.verifySession(payload + "." + flipChar(mac, 3)), null);
  assert.equal(S.verifySession(flipChar(payload, 5) + "." + mac), null);
  assert.equal(S.verifySession(payload), null);
  assert.equal(S.verifySession(payload + "." + mac + ".x"), null);
  // forged payload with a different sub but valid-looking shape
  const forged = Buffer.from(JSON.stringify({ sub: "admin", iat: 1, exp: 9e9 })).toString("base64url");
  assert.equal(S.verifySession(forged + "." + mac), null);
  // signed under another secret
  const other = S.signPayload({ sub: "owner", iat: 1, exp: 9e9 }, "another-secret-with-length");
  assert.equal(S.verifySession(other), null);
});

t("expired session rejected", () => {
  const now = Math.floor(Date.now() / 1000);
  const expired = S.signPayload({ sub: "owner", iat: now - 100000, exp: now - 10 });
  assert.equal(S.verifySession(expired), null);
  const future = S.signPayload({ sub: "owner", iat: now + 3600, exp: now + 7200 });
  assert.equal(S.verifySession(future), null, "issued in the future rejected");
  const fine = S.signPayload({ sub: "owner", iat: now, exp: now + 10 });
  assert.ok(S.verifySession(fine));
});

t("cookie setters and requireSession", async () => {
  const res = mockRes();
  const v = S.createSession();
  S.setSessionCookie(res, v);
  const c = res.cookies()[0];
  assert.ok(c.startsWith("og_session=" + v + ";"));
  for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=43200"]) {
    assert.ok(c.includes(attr), "has " + attr);
  }
  S.clearSessionCookie(res);
  assert.equal(res.cookies().length, 2, "appends, does not clobber");
  assert.ok(res.cookies()[1].includes("Max-Age=0"));

  const ok = S.requireSession({ headers: { cookie: "og_session=" + v } }, mockRes());
  assert.equal(ok.sub, "owner");
  const r2 = mockRes();
  assert.equal(S.requireSession({ headers: { cookie: "og_session=nope.nope" } }, r2), null);
  assert.equal(r2.statusCode, 401);
  assert.deepEqual(r2.json(), { error: "unauthorized" });
});

t("challenge cookie: kind bound, 2 minutes, Path=/api/auth", () => {
  const res = mockRes();
  S.setChallengeCookie(res, "abc123", "auth");
  const c = res.cookies()[0];
  assert.ok(c.includes("Path=/api/auth") && c.includes("Max-Age=120") && c.includes("HttpOnly") && c.includes("SameSite=Strict"));
  const val = cookieValue(res, "og_challenge");
  const req = { headers: { cookie: "og_challenge=" + val } };
  assert.equal(S.readChallenge(req, "auth"), "abc123");
  assert.equal(S.readChallenge(req, "reg"), null, "registration challenge is not a login challenge");
  const now = Math.floor(Date.now() / 1000);
  const old = S.signPayload({ challenge: "x", kind: "auth", iat: now - 300, exp: now - 180 });
  assert.equal(S.readChallenge({ headers: { cookie: "og_challenge=" + old } }, "auth"), null);
});

t("readBody handles object, string, empty", async () => {
  assert.deepEqual(await S.readBody({ body: { a: 1 } }), { a: 1 });
  assert.deepEqual(await S.readBody({ body: '{"a":2}' }), { a: 2 });
  assert.deepEqual(await S.readBody({ body: "" }), {});
  assert.equal(await S.readBody({ body: "{bad" }), null);
  assert.equal(await S.readBody({ body: "42" }), null);
});

// ---- middleware.js -----------------------------------------------------------

t("middleware verifier agrees with session.js", async () => {
  const mw = await loadMiddleware();
  assert.equal(typeof mw.default, "function");
  assert.ok(Array.isArray(mw.config.matcher) && mw.config.matcher.length);

  const v = S.createSession();
  const p = await mw.verifySessionValue(v, SECRET);
  assert.ok(p && p.sub === "owner");
  assert.deepEqual(p, S.verifySession(v));

  const [payload, mac] = v.split(".");
  assert.equal(await mw.verifySessionValue(payload + "." + flipChar(mac, 2), SECRET), null);
  assert.equal(await mw.verifySessionValue(flipChar(payload, 4) + "." + mac, SECRET), null);
  assert.equal(await mw.verifySessionValue(v, "wrong-secret-wrong-secret"), null);
  assert.equal(await mw.verifySessionValue(v, ""), null);
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await mw.verifySessionValue(S.signPayload({ sub: "owner", iat: now - 50000, exp: now - 1 }), SECRET), null);
  assert.equal(await mw.verifySessionValue(S.signPayload({ sub: "admin", iat: now, exp: now + 100 }), SECRET), null);

  // Independent re-implementation with crypto.subtle, to pin the byte-level contract:
  const key = await crypto.webcrypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Buffer.from(await crypto.webcrypto.subtle.sign("HMAC", key, Buffer.from(payload, "base64url")));
  assert.equal(sig.toString("base64url"), mac, "HMAC is over the decoded payload bytes");
});

t("middleware routing rules", async () => {
  const mw = await loadMiddleware();
  const v = S.createSession();
  const run = (p, cookie) => mw.default(new Request("https://oncogenik.test" + p, { headers: cookie ? { cookie } : {} }));
  const isPass = (r) => r.status === 200 && r.headers.get("x-middleware-next") === "1";

  for (const p of ["/login", "/login.js", "/api/auth/options", "/api/auth/verify", "/backgenapp", "/backgenapp/", "/backgenapp/index.html", "/vendor/x.js", "/favicon.ico"]) {
    assert.ok(isPass(await run(p)), "public: " + p);
  }
  for (const p of ["/", "/index.html", "/projects/abc", "/login-other", "/backgenappx", "/Login"]) {
    const r = await run(p);
    assert.equal(r.status, 302, "redirect: " + p);
    assert.equal(r.headers.get("location"), "https://oncogenik.test/login");
  }
  for (const p of ["/api/projects", "/api", "/api/auth", "/api/authx"]) {
    const r = await run(p);
    assert.equal(r.status, 401, "401: " + p);
    assert.deepEqual(await r.json(), { error: "unauthorized" });
  }
  assert.ok(isPass(await run("/", "og_session=" + v)));
  assert.ok(isPass(await run("/api/projects", "a=b; og_session=" + v)));
  assert.equal((await run("/api/projects", "og_session=" + v + "x")).status, 401);
  assert.equal((await run("/", "og_session=garbage")).status, 302);

  // No secret configured: nothing verifies.
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  assert.equal((await run("/", "og_session=" + v)).status, 302);
  process.env.SESSION_SECRET = saved;
});

// ---- ratelimit.js ------------------------------------------------------------

t("ratelimit: 5 failures in 10 minutes lock for an hour", () => {
  rl.reset();
  const ip = "198.51.100.7";
  let now = 1_000_000_000_000;
  for (let i = 0; i < 4; i++) assert.equal(rl.recordFailure(ip, now + i * 1000).blocked, false);
  const s = rl.recordFailure(ip, now + 5000);
  assert.equal(s.blocked, true);
  assert.ok(s.retryAfter > 3590 && s.retryAfter <= 3600);
  assert.equal(rl.status(ip, now + 30 * 60 * 1000).blocked, true, "still locked after 30 min");
  assert.equal(rl.status(ip, now + 5000 + 60 * 60 * 1000).blocked, false, "free after an hour");
  assert.equal(rl.status("other", now).blocked, false);

  // Failures outside the window do not accumulate.
  rl.reset();
  for (let i = 0; i < 4; i++) rl.recordFailure(ip, now + i * 1000);
  assert.equal(rl.recordFailure(ip, now + 11 * 60 * 1000).blocked, false, "window expired");
  rl.clear(ip);
  assert.equal(rl.status(ip, now).blocked, false);

  assert.equal(rl.clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }), "1.2.3.4");
  assert.equal(rl.clientIp({ headers: {} }), "unknown");

  rl.reset();
  for (let i = 0; i < 5; i++) rl.recordFailure(ip);
  const res = mockRes();
  assert.equal(rl.guard({ headers: { "x-forwarded-for": ip } }, res), false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error, "rate_limited");
  assert.ok(Number(res.getHeader("Retry-After")) > 0);
  assert.equal(rl.guard({ headers: { "x-forwarded-for": "9.9.9.9" } }, mockRes()), true);
  rl.reset();
});

// ---- handlers ----------------------------------------------------------------

const options = require(path.join(ROOT, "api/_auth/options.js"));
const verify = require(path.join(ROOT, "api/_auth/verify.js"));
const setupOptions = require(path.join(ROOT, "api/_auth/setup-options.js"));
const setupVerify = require(path.join(ROOT, "api/_auth/setup-verify.js"));
const logout = require(path.join(ROOT, "api/_auth/logout.js"));
const me = require(path.join(ROOT, "api/_auth/me.js"));

const FAKE_CRED = {
  id: "dGVzdC1jcmVkZW50aWFsLWlk",
  publicKey: Buffer.from(crypto.randomBytes(77)).toString("base64url"),
  counter: 0,
  transports: ["internal", "hybrid"],
};

t("setup routes return 404 without SETUP_TOKEN", async () => {
  rl.reset();
  delete process.env.SETUP_TOKEN;
  for (const h of [setupOptions, setupVerify]) {
    let r = await call(h, { headers: {} });
    assert.equal(r.statusCode, 404);
    assert.deepEqual(r.json(), { error: "not_found" });
    r = await call(h, { headers: { "x-setup-token": "anything" } });
    assert.equal(r.statusCode, 404);
  }
  // Wrong token also 404s and counts as a failure; the right one works.
  process.env.SETUP_TOKEN = "s3tup-t0ken";
  let r = await call(setupOptions, { headers: { "x-setup-token": "wrong" } });
  assert.equal(r.statusCode, 404);
  assert.equal(rl.status("203.0.113.5").blocked, false);
  r = await call(setupOptions, { headers: { "x-setup-token": "s3tup-t0ken" } });
  assert.equal(r.statusCode, 200, r.body);
  const opts = r.json();
  assert.equal(opts.rp.name, "OncoGenik");
  assert.equal(opts.rp.id, "oncogenik.test");
  assert.equal(opts.user.name, "owner");
  assert.equal(opts.authenticatorSelection.residentKey, "preferred");
  assert.equal(opts.authenticatorSelection.userVerification, "preferred");
  assert.ok(opts.challenge);
  const ch = cookieValue(r, "og_challenge");
  assert.ok(ch);
  assert.equal(S.readChallenge({ headers: { cookie: "og_challenge=" + ch } }, "reg"), opts.challenge);
  // Fixed 16-byte user handle, stable across calls
  const r2 = await call(setupOptions, { headers: { "x-setup-token": "s3tup-t0ken" } });
  assert.equal(r2.json().user.id, opts.user.id);
  assert.equal(Buffer.from(opts.user.id, "base64url").length, 16);

  // setup-verify with a garbage body: challenge consumed, 400, failure counted
  r = await call(setupVerify, { headers: { "x-setup-token": "s3tup-t0ken", cookie: "og_challenge=" + ch }, body: { id: "x", response: {} } });
  assert.equal(r.statusCode, 400);
  assert.ok(r.cookies().some((c) => c.startsWith("og_challenge=;")), "challenge cleared");
  // without a challenge cookie
  r = await call(setupVerify, { headers: { "x-setup-token": "s3tup-t0ken" }, body: {} });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, "challenge_missing_or_expired");
  // method
  r = await call(setupOptions, { method: "GET", headers: { "x-setup-token": "s3tup-t0ken" } });
  assert.equal(r.statusCode, 405);
  delete process.env.SETUP_TOKEN;
  rl.reset();
});

t("options: 404 until enrolled, then options + challenge cookie", async () => {
  rl.reset();
  delete process.env.PASSKEY_CREDENTIAL;
  let r = await call(options, {});
  assert.equal(r.statusCode, 404);
  process.env.PASSKEY_CREDENTIAL = JSON.stringify(FAKE_CRED);
  r = await call(options, {});
  assert.equal(r.statusCode, 200, r.body);
  const o = r.json();
  assert.equal(o.rpId, "oncogenik.test");
  assert.equal(o.userVerification, "preferred");
  assert.equal(o.allowCredentials.length, 1);
  assert.equal(o.allowCredentials[0].id, FAKE_CRED.id);
  assert.deepEqual(o.allowCredentials[0].transports, FAKE_CRED.transports);
  const ch = cookieValue(r, "og_challenge");
  assert.equal(S.readChallenge({ headers: { cookie: "og_challenge=" + ch } }, "auth"), o.challenge);
  assert.equal((await call(options, { method: "GET" })).statusCode, 405);
  // malformed env is a 500, not a crash
  process.env.PASSKEY_CREDENTIAL = "{nope";
  assert.equal((await call(options, {})).statusCode, 500);
  process.env.PASSKEY_CREDENTIAL = JSON.stringify(FAKE_CRED);
});

t("verify: bad responses fail, count toward the lock, never set a session", async () => {
  rl.reset();
  process.env.PASSKEY_CREDENTIAL = JSON.stringify(FAKE_CRED);
  const ip = "203.0.113.77";
  // no challenge cookie
  let r = await call(verify, { ip, body: { id: FAKE_CRED.id, response: {} } });
  assert.equal(r.statusCode, 400);
  assert.equal(cookieValue(r, "og_session"), undefined);

  // fresh challenge, wrong credential id
  let o = await call(options, { ip });
  let ch = cookieValue(o, "og_challenge");
  r = await call(verify, { ip, headers: { cookie: "og_challenge=" + ch }, body: { id: "other", response: {} } });
  assert.equal(r.statusCode, 401);
  assert.equal(r.json().error, "unknown_credential");

  // fresh challenge, right id, garbage assertion -> library rejects
  o = await call(options, { ip });
  ch = cookieValue(o, "og_challenge");
  const garbage = {
    id: FAKE_CRED.id,
    rawId: FAKE_CRED.id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: o.json().challenge, origin: "https://oncogenik.test" })).toString("base64url"),
      authenticatorData: Buffer.alloc(37).toString("base64url"),
      signature: Buffer.alloc(64).toString("base64url"),
    },
  };
  r = await call(verify, { ip, headers: { cookie: "og_challenge=" + ch }, body: garbage });
  assert.equal(r.statusCode, 401, r.body);
  assert.equal(r.json().error, "verification_failed");
  assert.equal(cookieValue(r, "og_session"), undefined);
  assert.ok(r.cookies().some((c) => c.startsWith("og_challenge=;")), "challenge consumed");

  // string body is handled
  o = await call(options, { ip });
  ch = cookieValue(o, "og_challenge");
  r = await call(verify, { ip, headers: { cookie: "og_challenge=" + ch }, body: JSON.stringify(garbage) });
  assert.equal(r.statusCode, 401);

  // that was 4 failures; one more locks, and the lock applies to options too
  r = await call(verify, { ip, body: {} });
  assert.equal(r.statusCode, 400);
  assert.equal(rl.status(ip).blocked, true);
  assert.equal((await call(verify, { ip, body: {} })).statusCode, 429);
  assert.equal((await call(options, { ip })).statusCode, 429);
  assert.equal((await call(options, { ip: "203.0.113.78" })).statusCode, 200, "other IPs unaffected");
  rl.reset();
});

t("me and logout", async () => {
  const v = S.createSession();
  let r = await call(me, { method: "GET", headers: { cookie: "og_session=" + v } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().ok, true);
  assert.equal(typeof r.json().exp, "number");
  r = await call(me, { method: "GET", headers: {} });
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.json(), { error: "unauthorized" });
  r = await call(me, { method: "POST", headers: { cookie: "og_session=" + v } });
  assert.equal(r.statusCode, 405);

  r = await call(logout, { method: "POST" });
  assert.equal(r.statusCode, 200);
  assert.ok(r.cookies()[0].startsWith("og_session=;") && r.cookies()[0].includes("Max-Age=0"));
  assert.equal((await call(logout, { method: "GET" })).statusCode, 405);
});

// ---- run ---------------------------------------------------------------------

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      n++;
      console.log("ok " + name);
    } catch (e) {
      failed++;
      console.log("FAIL " + name);
      console.log(e && e.stack ? e.stack : e);
    }
  }
  console.log(`\n${n} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
