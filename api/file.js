"use strict";
// GET /api/file?path=projects/<slug>/script/v1.md      -> { content, sha, size }
// GET /api/file?path=projects/<slug>/images/generated/01.png -> image bytes
// GET /api/file?path=...&raw=1                          -> raw bytes as a download
const gh = require("./_lib/github");
const H = require("./_lib/http");

const ALLOWED_ROOTS = ["projects/", "ideas/", "guidelines/", "exemplars/"];
const TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  md: "text/markdown; charset=utf-8", json: "application/json; charset=utf-8", html: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8"
};
const BINARY = { png: 1, jpg: 1, jpeg: 1, webp: 1, gif: 1 };

// Only files under the content roots, no traversal, no odd characters.
function safePath(p) {
  if (typeof p !== "string" || !p) return null;
  if (p.indexOf("..") >= 0 || p.indexOf("\\") >= 0 || p.indexOf("\0") >= 0) return null;
  if (p.startsWith("/") || p.endsWith("/")) return null;
  if (!/^[A-Za-z0-9._\/-]+$/.test(p)) return null;
  if (p.split("/").some(seg => seg === "" || seg === ".")) return null;
  if (!ALLOWED_ROOTS.some(r => p.startsWith(r))) return null;
  return p;
}

function ext(p) { const m = /\.([a-z0-9]+)$/i.exec(p); return m ? m[1].toLowerCase() : ""; }

module.exports = H.handler(async (req, res) => {
  const session = require("./_lib/session").requireSession(req, res); if (!session) return;
  if (!H.methods(req, res, ["GET"])) return;
  const q = H.query(req);
  const path = safePath(q.path);
  if (!path) throw new H.HttpError(400, "bad path");
  const e = ext(path);
  const isImage = BINARY[e] && /\/images\/generated\//.test(path);

  if (isImage || q.raw) {
    const buf = await gh.getBinary(path);
    if (buf === null) throw new H.HttpError(404, "not found");
    const headers = {
      "Content-Type": TYPES[e] || "application/octet-stream",
      "Content-Length": String(buf.length),
      "Cache-Control": isImage ? "private, max-age=3600" : "no-store"
    };
    if (q.raw) headers["Content-Disposition"] = "attachment; filename=\"" + path.split("/").pop() + "\"";
    H.send(res, 200, buf, headers);
    return;
  }
  const f = await gh.getFile(path);
  if (!f) throw new H.HttpError(404, "not found");
  H.send(res, 200, { path, content: f.content, sha: f.sha, size: f.size });
});

module.exports.safePath = safePath;
