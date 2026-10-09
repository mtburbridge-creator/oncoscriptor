// Vercel Routing Middleware (formerly Edge Middleware) for OncoGenik.
//
// Web APIs only (Request, Response, URL, crypto.subtle), so it runs on either
// of Vercel's middleware runtimes. Declared the way Vercel documents for a
// project without a framework: this file at the repo root, a default export,
// and `export const config = { matcher }`. Sources in docs/AUTH.md.
//
// Rules
//   public (no session needed): /login, /login.js, /api/auth/*, /backgenapp,
//     /backgenapp/*, /vendor/*, /favicon.ico
//   everything else needs a valid og_session cookie
//     /api/*  -> 401 {"error":"unauthorized"}
//     pages   -> 302 /login
//
// The cookie contract is the one in api/_lib/session.js:
//   og_session = base64url(payload JSON) "." base64url(HMAC-SHA256(payload bytes, SESSION_SECRET))

const SESSION_COOKIE = "og_session";
const PUBLIC_EXACT = new Set(["/login", "/login.js", "/backgenapp", "/favicon.ico"]);
const PUBLIC_PREFIXES = ["/api/auth/", "/backgenapp/", "/vendor/"];

// Coarse filter: skip static vendor files and the favicon entirely. Every
// other rule is enforced in code below, so a near-miss path such as
// /login-other or /backgenappx is still protected.
export const config = {
  matcher: ["/((?!vendor/|favicon\\.ico).*)"],
};

export function isPublicPath(pathname) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const p of PUBLIC_PREFIXES) if (pathname.startsWith(p)) return true;
  return false;
}

export function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  let found = null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) found = part.slice(i + 1).trim();
  }
  return found;
}

function base64urlToBytes(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  let bin;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Verify "<payload>.<mac>" with HMAC-SHA256 under `secret`. Returns the payload
// object, or null. crypto.subtle.verify compares the MAC in constant time; the
// length check before it leaks nothing an attacker does not already know.
export async function verifySessionValue(value, secret, nowSeconds) {
  if (typeof value !== "string" || !secret || value.length > 4096) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const payload = base64urlToBytes(parts[0]);
  const mac = base64urlToBytes(parts[1]);
  if (!payload || !mac || mac.length !== 32) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify("HMAC", key, mac, payload);
  if (!ok) return null;

  let obj;
  try {
    obj = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  if (obj.sub !== "owner") return null;
  if (!Number.isFinite(obj.iat) || !Number.isFinite(obj.exp)) return null;
  const now = typeof nowSeconds === "number" ? nowSeconds : Math.floor(Date.now() / 1000);
  if (obj.exp <= now) return null;
  if (obj.iat > now + 60) return null;
  return obj;
}

// Same response @vercel/functions' next() builds: an empty body with the
// x-middleware-next header, which tells Vercel to continue to the route.
function passThrough() {
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (isPublicPath(path)) return passThrough();

  const secret = process.env.SESSION_SECRET;
  const cookie = getCookie(request.headers.get("cookie"), SESSION_COOKIE);
  const session = secret && cookie ? await verifySessionValue(cookie, secret) : null;
  if (session) return passThrough();

  if (path === "/api" || path.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: new URL("/login", request.url).toString(),
      "cache-control": "no-store",
    },
  });
}
