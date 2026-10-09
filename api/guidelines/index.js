"use strict";
// GET /api/guidelines            { files: {script.md, images.md, outline.md}, proposals: [...] }
// PUT /api/guidelines {file, content}   edit one guideline directly
const gh = require("../_lib/github");
const H = require("../_lib/http");

const FILES = ["script.md", "images.md", "outline.md"];

async function list(req, res) {
  const files = {};
  for (const name of FILES) {
    const f = await gh.getFile("guidelines/" + name);
    files[name] = f ? f.content : "";
  }
  const proposals = [];
  const entries = (await gh.listDir("guidelines/proposals")).filter(e => e.type === "file" && /\.json$/.test(e.name));
  for (const e of entries) {
    const f = await gh.getFile(e.path);
    if (!f) continue;
    try {
      const j = JSON.parse(f.content);
      proposals.push({ slug: j.slug || e.name.replace(/\.json$/, ""), created: j.created || "", path: e.path, proposals: j.proposals || [] });
    } catch (err) {
      proposals.push({ slug: e.name.replace(/\.json$/, ""), path: e.path, error: "invalid JSON", proposals: [] });
    }
  }
  proposals.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  H.send(res, 200, { files, proposals });
}

async function update(req, res) {
  const body = await H.readBody(req);
  const file = String(body.file || "").replace(/^guidelines\//, "");
  if (FILES.indexOf(file) < 0) throw new H.HttpError(400, "file must be one of " + FILES.join(", "));
  if (typeof body.content !== "string") throw new H.HttpError(400, "content must be a string");
  let content = body.content.replace(/\r\n/g, "\n");
  if (content && !content.endsWith("\n")) content += "\n";
  const commit = await gh.commitFiles({ message: "ui: edit guidelines/" + file, files: [{ path: "guidelines/" + file, content }] });
  H.send(res, 200, { file, commit: commit.sha });
}

module.exports = H.handler(async (req, res) => {
  const session = require("../_lib/session").requireSession(req, res); if (!session) return;
  if (!H.methods(req, res, ["GET", "PUT"])) return;
  if (req.method === "GET") return list(req, res);
  return update(req, res);
});
module.exports.FILES = FILES;
