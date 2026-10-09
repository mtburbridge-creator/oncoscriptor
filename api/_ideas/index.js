"use strict";
// GET  /api/ideas            list ideas/*.md with parsed headers
// POST /api/ideas {title, text}  write ideas/<slug>.md with source human
const gh = require("../_lib/github");
const H = require("../_lib/http");
const S = require("../../tools/state");

// Header lines are "key: value" until the first blank line. See docs/HERMES_CONTRACT.md.
function parseIdea(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const head = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(lines[i]);
    if (!m) break;
    head[m[1]] = m[2].trim();
  }
  const body = lines.slice(i).join("\n").trim();
  return { title: head.title || "", source: head.source || "", found: head.found || "", status: head.status || "new", body };
}

async function list(req, res) {
  const entries = (await gh.listDir("ideas")).filter(e => e.type === "file" && /\.md$/.test(e.name));
  const ideas = [];
  for (const e of entries) {
    const f = await gh.getFile(e.path);
    if (!f) continue;
    const parsed = parseIdea(f.content);
    ideas.push(Object.assign({ slug: e.name.replace(/\.md$/, ""), path: e.path }, parsed));
  }
  ideas.sort((a, b) => (b.found || "").localeCompare(a.found || "") || a.slug.localeCompare(b.slug));
  H.send(res, 200, { ideas });
}

async function create(req, res) {
  const body = await H.readBody(req);
  const title = String(body.title || "").trim();
  const text = String(body.text || "").trim();
  if (!title) throw new H.HttpError(400, "title required");
  const slug = S.slugify(title);
  if (!H.isSafeSlug(slug)) throw new H.HttpError(400, "title does not make a usable slug");
  const path = "ideas/" + slug + ".md";
  if (await gh.getFile(path)) throw new H.HttpError(409, "idea exists: " + slug);
  const found = new Date().toISOString().slice(0, 10);
  const content = "title: " + title + "\nsource: human\nfound: " + found + "\nstatus: new\n\n" + (text ? text + "\n" : "");
  const commit = await gh.commitFiles({ message: "ui: idea " + slug, files: [{ path, content }] });
  H.send(res, 201, { idea: Object.assign({ slug, path }, parseIdea(content)), commit: commit.sha });
}

module.exports = H.handler(async (req, res) => {
  const session = require("../_lib/session").requireSession(req, res); if (!session) return;
  if (!H.methods(req, res, ["GET", "POST"])) return;
  if (req.method === "GET") return list(req, res);
  return create(req, res);
});
module.exports.parseIdea = parseIdea;
