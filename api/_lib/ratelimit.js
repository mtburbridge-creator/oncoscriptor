"use strict";
// Best-effort login rate limiting. In-memory, per serverless instance.
//
// Five failures inside ten minutes lock the caller's IP for one hour. The map
// lives in the function instance, so a cold start or a second instance begins
// with a clean slate. That is acceptable here: the passkey signature is what
// actually stops a guesser, and removing SETUP_TOKEN is what closes enrollment.
// See docs/AUTH.md.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 60 * 60 * 1000;

const buckets = new Map(); // ip -> { failures: number[], lockedUntil: number }

function clientIp(req) {
  const h = (req && req.headers) || {};
  const xff = h["x-forwarded-for"] || h["X-Forwarded-For"];
  if (xff) {
    const first = String(Array.isArray(xff) ? xff[0] : xff).split(",")[0].trim();
    if (first) return first;
  }
  const real = h["x-real-ip"];
  if (real) return String(real).trim();
  if (req && req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return "unknown";
}

function bucket(ip) {
  let b = buckets.get(ip);
  if (!b) {
    b = { failures: [], lockedUntil: 0 };
    buckets.set(ip, b);
  }
  return b;
}

function prune(b, now) {
  b.failures = b.failures.filter((t) => now - t < WINDOW_MS);
  if (b.lockedUntil && b.lockedUntil <= now) b.lockedUntil = 0;
}

// { blocked: boolean, retryAfter: seconds }
function status(ip, now) {
  const t = typeof now === "number" ? now : Date.now();
  const b = buckets.get(ip);
  if (!b) return { blocked: false, retryAfter: 0 };
  prune(b, t);
  if (b.lockedUntil > t) return { blocked: true, retryAfter: Math.ceil((b.lockedUntil - t) / 1000) };
  return { blocked: false, retryAfter: 0 };
}

function recordFailure(ip, now) {
  const t = typeof now === "number" ? now : Date.now();
  const b = bucket(ip);
  prune(b, t);
  b.failures.push(t);
  if (b.failures.length >= MAX_FAILURES) {
    b.lockedUntil = t + LOCK_MS;
    b.failures = [];
  }
  return status(ip, t);
}

function clear(ip) {
  buckets.delete(ip);
}

function reset() {
  buckets.clear();
}

// Sends 429 and returns false when the caller is locked out, else true.
function guard(req, res) {
  const s = status(clientIp(req));
  if (!s.blocked) return true;
  res.statusCode = 429;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Retry-After", String(s.retryAfter));
  res.end(JSON.stringify({ error: "rate_limited", retry_after: s.retryAfter }));
  return false;
}

module.exports = {
  WINDOW_MS,
  MAX_FAILURES,
  LOCK_MS,
  clientIp,
  status,
  recordFailure,
  clear,
  reset,
  guard,
};
