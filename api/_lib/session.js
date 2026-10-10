"use strict";
// Signed cookies for the single-user login. Node crypto only, no database.
//
// Cookie contract (shared with middleware.js and every other agent):
//   og_session = <base64url(JSON payload)>.<base64url(HMAC-SHA256(payload bytes, SESSION_SECRET))>
//   payload    = {"sub":"owner","iat":<unix seconds>,"exp":<unix seconds>}
//   lifetime   = 12 hours; HttpOnly; Secure; SameSite=Strict; Path=/oncogenik
//
// The WebAuthn challenge rides in a second cookie, og_challenge, signed the
// same way with a 2 minute lifetime and Path=/oncogenik/api/auth. See docs/AUTH.md.

const crypto = require("crypto");

// The app is served under this path, at markburbridge.com/oncogenik through
// the frontpage proxy. Cookies are scoped to it so other apps on the domain
// never receive them.
const BASE = "/oncogenik";
const SESSION_COOKIE = "og_session";
const CHALLENGE_COOKIE = "og_challenge";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const CHALLENGE_TTL_SECONDS = 2 * 60;
const CHALLENGE_PATH = BASE + "/api/auth";

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is not set or is shorter than 16 characters");
  }
  return s;
}

function b64u(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

// Sign a JSON payload. Returns "<base64url payload>.<base64url mac>".
function signPayload(payloadObj, key) {
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const mac = crypto.createHmac("sha256", key || secret()).update(payload).digest();
  return b64u(payload) + "." + b64u(mac);
}

// Verify a signed value. Returns the payload object or null. Constant-time
// MAC comparison, then exp check. `now` is injectable for tests.
function verifySigned(value, key, now) {
  if (typeof value !== "string" || value.length > 4096) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  const payload = Buffer.from(parts[0], "base64url");
  const mac = Buffer.from(parts[1], "base64url");
  const expected = crypto.createHmac("sha256", key || secret()).update(payload).digest();
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(mac, expected)) return null;
  let obj;
  try {
    obj = JSON.parse(payload.toString("utf8"));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  if (!Number.isFinite(obj.iat) || !Number.isFinite(obj.exp)) return null;
  const t = typeof now === "number" ? now : nowSeconds();
  if (obj.exp <= t) return null;
  if (obj.iat > t + 60) return null; // issued in the future: reject
  return obj;
}

// Parse a Cookie request header into an object. Later duplicates win.
function parseCookies(header) {
  const out = {};
  if (typeof header !== "string" || !header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function getCookie(req, name) {
  const header = req && req.headers ? req.headers.cookie || req.headers.Cookie : null;
  return parseCookies(header)[name];
}

// Append a Set-Cookie header without clobbering ones already queued.
function appendSetCookie(res, cookie) {
  const prev = res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", [cookie]);
  else if (Array.isArray(prev)) res.setHeader("Set-Cookie", prev.concat(cookie));
  else res.setHeader("Set-Cookie", [prev, cookie]);
}

// ---- session ----------------------------------------------------------------

function createSession() {
  const iat = nowSeconds();
  return signPayload({ sub: "owner", iat, exp: iat + SESSION_TTL_SECONDS });
}

// Accepts either the raw cookie value or a whole Cookie header.
function verifySession(cookieHeaderOrValue) {
  if (typeof cookieHeaderOrValue !== "string") return null;
  let value = cookieHeaderOrValue;
  if (value.includes("=")) value = parseCookies(value)[SESSION_COOKIE];
  if (!value) return null;
  let payload;
  try {
    payload = verifySigned(value);
  } catch {
    return null; // SESSION_SECRET unset: nothing verifies
  }
  if (!payload || payload.sub !== "owner") return null;
  return payload;
}

function setSessionCookie(res, value) {
  appendSetCookie(
    res,
    SESSION_COOKIE + "=" + value +
      "; Max-Age=" + SESSION_TTL_SECONDS +
      "; Path=" + BASE + "; HttpOnly; Secure; SameSite=Strict",
  );
}

function clearSessionCookie(res) {
  appendSetCookie(
    res,
    SESSION_COOKIE + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=" + BASE + "; HttpOnly; Secure; SameSite=Strict",
  );
}

// Returns the payload, or sends 401 JSON and returns null.
function requireSession(req, res) {
  const payload = verifySession(getCookie(req, SESSION_COOKIE) || "");
  if (payload) return payload;
  sendJson(res, 401, { error: "unauthorized" });
  return null;
}

// ---- challenge --------------------------------------------------------------

// kind is "auth" or "reg" so a registration challenge cannot be replayed as a
// login challenge or the reverse.
function setChallengeCookie(res, challenge, kind) {
  const iat = nowSeconds();
  const value = signPayload({ challenge, kind, iat, exp: iat + CHALLENGE_TTL_SECONDS });
  appendSetCookie(
    res,
    CHALLENGE_COOKIE + "=" + value +
      "; Max-Age=" + CHALLENGE_TTL_SECONDS +
      "; Path=" + CHALLENGE_PATH + "; HttpOnly; Secure; SameSite=Strict",
  );
}

// Returns the challenge string or null. Does not clear the cookie; callers
// clear it themselves so a challenge is consumed whether or not it verifies.
function readChallenge(req, kind) {
  const value = getCookie(req, CHALLENGE_COOKIE);
  if (!value) return null;
  let payload;
  try {
    payload = verifySigned(value);
  } catch {
    return null;
  }
  if (!payload || payload.kind !== kind || typeof payload.challenge !== "string") return null;
  return payload.challenge;
}

function clearChallengeCookie(res) {
  appendSetCookie(
    res,
    CHALLENGE_COOKIE + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=" + CHALLENGE_PATH +
      "; HttpOnly; Secure; SameSite=Strict",
  );
}

// ---- small HTTP helpers shared by the auth handlers -------------------------

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

// Vercel parses JSON bodies into req.body. Handle the string and raw-stream
// cases too so the handlers work under any invoker, including the tests.
async function readBody(req) {
  let body = req.body;
  if (body === undefined && req.on && typeof req.on === "function") {
    body = await new Promise((resolve, reject) => {
      let data = "";
      req.setEncoding && req.setEncoding("utf8");
      req.on("data", (c) => { data += c; if (data.length > 1e6) reject(new Error("body too large")); });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (!body.trim()) return {};
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (body === undefined || body === null) return {};
  if (typeof body !== "object") return null;
  return body;
}

// PASSKEY_CREDENTIAL env var -> SimpleWebAuthn v13 WebAuthnCredential, or null.
function credentialFromEnv() {
  const raw = process.env.PASSKEY_CREDENTIAL;
  if (!raw) return null;
  let c;
  try {
    c = JSON.parse(raw);
  } catch {
    throw new Error("PASSKEY_CREDENTIAL is not valid JSON");
  }
  if (!c || typeof c.id !== "string" || typeof c.publicKey !== "string") {
    throw new Error("PASSKEY_CREDENTIAL needs string fields id and publicKey");
  }
  return {
    id: c.id,
    publicKey: new Uint8Array(Buffer.from(c.publicKey, "base64url")),
    counter: Number.isFinite(c.counter) ? c.counter : 0,
    transports: Array.isArray(c.transports) ? c.transports : undefined,
  };
}

function rpConfig() {
  const rpID = process.env.RP_ID;
  if (!rpID) throw new Error("RP_ID is not set");
  const origin = process.env.ORIGIN || "https://" + rpID;
  return { rpID, origin };
}

module.exports = {
  BASE,
  SESSION_COOKIE,
  CHALLENGE_COOKIE,
  SESSION_TTL_SECONDS,
  CHALLENGE_TTL_SECONDS,
  signPayload,
  verifySigned,
  parseCookies,
  getCookie,
  appendSetCookie,
  createSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  requireSession,
  setChallengeCookie,
  readChallenge,
  clearChallengeCookie,
  sendJson,
  readBody,
  credentialFromEnv,
  rpConfig,
};
