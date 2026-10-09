"use strict";
/*
 * Small helpers shared by the serverless functions. They work whether or not
 * Vercel's Node helpers (req.body, req.query, res.json) are present.
 */

function send(res, status, body, headers) {
  res.statusCode = status;
  if (headers) for (const k of Object.keys(headers)) res.setHeader(k, headers[k]);
  if (Buffer.isBuffer(body)) { res.end(body); return; }
  if (typeof body === "string") { res.end(body); return; }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body === undefined ? null : body));
}

function fail(res, status, message, extra) {
  send(res, status, Object.assign({ error: message }, extra || {}));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function query(req) {
  if (req.query && typeof req.query === "object") return req.query;
  const u = new URL(req.url || "/", "http://localhost");
  const out = {};
  u.searchParams.forEach((v, k) => { out[k] = v; });
  return out;
}

// Dynamic route segment, e.g. [slug]. Vercel puts it in req.query; fall back
// to parsing the path so the handlers also work under a plain Node server.
function param(req, name, position) {
  const q = query(req);
  if (q[name]) return String(q[name]);
  const parts = new URL(req.url || "/", "http://localhost").pathname.split("/").filter(Boolean);
  return parts[position] || null;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { throw new HttpError(400, "invalid JSON body"); } }
    if (Buffer.isBuffer(req.body)) { try { return JSON.parse(req.body.toString("utf8")); } catch (e) { throw new HttpError(400, "invalid JSON body"); } }
    return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { throw new HttpError(400, "invalid JSON body"); }
}

function methods(req, res, allowed) {
  if (allowed.indexOf(req.method) >= 0) return true;
  res.setHeader("Allow", allowed.join(", "));
  fail(res, 405, "method not allowed");
  return false;
}

// Wrap a handler so thrown errors become JSON responses.
function handler(fn) {
  return async function (req, res) {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e && e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) fail(res, status, (e && e.message) || "internal error");
    }
  };
}

function isSafeSlug(s) { return typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,59}$/.test(s); }

module.exports = { send, fail, HttpError, query, param, readBody, methods, handler, isSafeSlug };
