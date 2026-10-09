"use strict";
/*
 * The one serverless function. Vercel's Hobby plan allows 12 functions per
 * deployment, so every /api/* path is rewritten here (see vercel.json) and
 * dispatched to a handler module in an underscore folder, which Vercel does
 * not deploy as its own function. Public URLs stay the same.
 *
 * Requires are literal so Vercel's file tracer bundles every handler.
 */
const ROUTES = [
  { re: /^auth\/options$/,              load: () => require("./_auth/options") },
  { re: /^auth\/verify$/,               load: () => require("./_auth/verify") },
  { re: /^auth\/setup-options$/,        load: () => require("./_auth/setup-options") },
  { re: /^auth\/setup-verify$/,         load: () => require("./_auth/setup-verify") },
  { re: /^auth\/logout$/,               load: () => require("./_auth/logout") },
  { re: /^auth\/me$/,                   load: () => require("./_auth/me") },
  { re: /^file$/,                       load: () => require("./_file") },
  { re: /^projects$/,                   load: () => require("./_projects/index") },
  { re: /^projects\/([^/]+)$/,          load: () => require("./_projects/[slug]/index"),  params: ["slug"] },
  { re: /^projects\/([^/]+)\/action$/,  load: () => require("./_projects/[slug]/action"), params: ["slug"] },
  { re: /^projects\/([^/]+)\/task$/,    load: () => require("./_projects/[slug]/task"),   params: ["slug"] },
  { re: /^ideas$/,                      load: () => require("./_ideas/index") },
  { re: /^guidelines$/,                 load: () => require("./_guidelines/index") },
  { re: /^guidelines\/proposal$/,       load: () => require("./_guidelines/proposal") }
];

// The route arrives as ?__route=<path> from the rewrite. Without it, take the
// path after /api/ so the router also works when called directly.
function routeOf(req) {
  const u = new URL(req.url || "/", "http://localhost");
  let r = (req.query && req.query.__route) || u.searchParams.get("__route");
  if (Array.isArray(r)) r = r.join("/");
  if (!r) r = u.pathname.replace(/^\/api\/?/, "");
  return decodeURIComponent(String(r)).replace(/^\/+|\/+$/g, "");
}

function ensureQuery(req) {
  if (!req.query || typeof req.query !== "object") {
    const out = {};
    new URL(req.url || "/", "http://localhost").searchParams.forEach((v, k) => { out[k] = v; });
    req.query = out;
  }
  delete req.query.__route;
  return req.query;
}

function match(route) {
  for (const r of ROUTES) {
    const m = route.match(r.re);
    if (m) return { r, m };
  }
  return null;
}

async function router(req, res) {
  const route = routeOf(req);
  const q = ensureQuery(req);
  const hit = match(route);
  if (!hit) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "not found", route }));
    return;
  }
  (hit.r.params || []).forEach((name, i) => { q[name] = decodeURIComponent(hit.m[i + 1]); });
  return hit.r.load()(req, res);
}

module.exports = router;
module.exports.ROUTES = ROUTES;
module.exports.match = match;
module.exports.routeOf = routeOf;
