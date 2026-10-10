"use strict";
// The single-function API: Hobby plan cap, route coverage, and dispatch.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const router = require(path.join(ROOT, "api/router.js"));

let n = 0;
async function t(name, fn) { await fn(); n++; console.log("ok " + name); }

// Vercel deploys every .js under api/ as a function unless a path segment
// starts with an underscore or a dot.
function deployedFunctions(dir, rel) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name), r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) out = out.concat(deployedFunctions(p, r));
    else if (/\.(js|mjs|cjs|ts)$/.test(e.name)) out.push(r);
  }
  return out;
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: "" };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.headers["content-type"] = "application/json"; res.body = JSON.stringify(b); return res; };
  res.send = (b) => { res.body = typeof b === "string" ? b : JSON.stringify(b); return res; };
  res.end = (b) => { if (b !== undefined) res.body = String(b); return res; };
  return res;
}

(async () => {
  await t("api/ deploys at most 12 functions (Vercel Hobby cap)", () => {
    const fns = deployedFunctions(path.join(ROOT, "api"), "");
    assert.ok(fns.length <= 12, "deployed functions: " + fns.join(", "));
    assert.deepEqual(fns, ["router.js"]);
  });

  await t("vercel.json rewrites /api/* to the router", () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const r = v.rewrites.find(x => x.destination === "/api/router");
    assert.ok(r, "missing rewrite");
    // Vercel appends the rewrite's parameter as a query key. It must be the
    // router's own key, never one a handler reads, such as /api/file?path=.
    assert.equal(r.source, "/oncogenik/api/:__route*");
    assert.equal(v.rewrites.indexOf(r), 0, "api rewrite must come first");
  });

  await t("every API URL the web pages call has a route", () => {
    const urls = new Set();
    for (const f of fs.readdirSync(path.join(ROOT, "web"))) {
      if (!/\.(js|html)$/.test(f)) continue;
      const s = fs.readFileSync(path.join(ROOT, "web", f), "utf8");
      for (const m of s.matchAll(/\/api\/([a-zA-Z0-9_/.-]+)/g)) urls.add(m[1].replace(/\/$/, ""));
      // Every root-absolute app URL must carry the /oncogenik base path, or it
      // escapes the subpath that markburbridge.com forwards to this project.
      for (const m of s.matchAll(/(?:src|href)="(\/[^"#]*)"/g)) {
        assert.ok(m[1].startsWith("/oncogenik/") || m[1] === "/backgenapp", f + " links outside the base path: " + m[1]);
      }
      assert.ok(!/(?<!BASE \+ )["'`]\/(api|login|vendor)\b/.test(s), f + " has an unprefixed /api, /login or /vendor URL");
    }
    // The project view builds /api/projects/<slug>[/action|/task] at runtime.
    urls.add("projects/demo"); urls.add("projects/demo/action"); urls.add("projects/demo/task");
    for (const u of urls) assert.ok(router.match(u), "no route for /api/" + u);
  });

  await t("route comes from __route or from the path", () => {
    assert.equal(router.routeOf({ url: "/api/router?__route=auth%2Fme", query: { __route: "auth/me" } }), "auth/me");
    assert.equal(router.routeOf({ url: "/api/projects/x/task" }), "projects/x/task");
    assert.equal(router.routeOf({ url: "/oncogenik/api/projects/x/task" }), "projects/x/task");
  });

  await t("dispatch reaches the real handler and strips __route", async () => {
    const prev = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
    const req = { method: "GET", url: "/api/router?__route=auth/me", headers: {}, query: { __route: "auth/me" } };
    const res = mockRes();
    await router(req, res);
    process.env.SESSION_SECRET = prev;
    assert.equal(res.statusCode, 401, "auth/me without a cookie is 401");
    assert.equal(req.query.__route, undefined);
  });

  await t("dynamic slug is set on req.query", async () => {
    const req = { method: "GET", url: "/api/projects/immunotherapy-side-effects/task", headers: {} };
    const res = mockRes();
    await router(req, res);
    assert.equal(req.query.slug, "immunotherapy-side-effects");
  });

  await t("one base path everywhere", () => {
    const S = require(path.join(ROOT, "api/_lib/session.js"));
    const stage = require(path.join(ROOT, "tools/stage-static.js"));
    const mw = fs.readFileSync(path.join(ROOT, "middleware.js"), "utf8");
    assert.equal(S.BASE, "/oncogenik");
    assert.equal("/" + stage.BASE, S.BASE);
    assert.ok(mw.includes('export const BASE = "' + S.BASE + '"'), "middleware BASE");
    for (const f of ["web/app.js", "web/login.js"]) {
      assert.ok(fs.readFileSync(path.join(ROOT, f), "utf8").includes('var BASE = "' + S.BASE + '"'), f + " BASE");
    }
  });

  await t("unknown route is a JSON 404", async () => {
    const res = mockRes();
    await router({ method: "GET", url: "/api/nope", headers: {} }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, "not found");
  });

  console.log(n + " router checks passed");
})().catch(e => { console.error("FAIL " + e.message); process.exit(1); });
