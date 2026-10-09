"use strict";
// GET  /api/projects          list every project with who it waits on
// POST /api/projects          { title, minutes, idea? }  start a project
const gh = require("../_lib/github");
const H = require("../_lib/http");
const S = require("../../tools/state");
const P = require("./_shared");

async function list(req, res) {
  const tree = await gh.getTree();
  const paths = tree.entries
    .filter(e => e.type === "blob" && /^projects\/[^/]+\/project\.json$/.test(e.path))
    .map(e => e.path).sort();
  const projects = [];
  const errors = [];
  for (const path of paths) {
    const f = await gh.getFile(path);
    if (!f) continue;
    try { projects.push(P.summarize(JSON.parse(f.content))); }
    catch (e) { errors.push({ path, error: "invalid project.json" }); }
  }
  H.send(res, 200, { projects, errors, truncated: tree.truncated });
}

async function create(req, res) {
  const body = await H.readBody(req);
  const title = String(body.title || "").trim();
  const minutes = Number(body.minutes || body.target_minutes || 10);
  const idea = body.idea ? String(body.idea) : null;
  if (!title) throw new H.HttpError(400, "title required");
  if (!(minutes >= 8 && minutes <= 15)) throw new H.HttpError(400, "minutes must be 8 to 15");
  if (idea && !/^ideas\/[a-z0-9][a-z0-9-]*\.md$/.test(idea)) throw new H.HttpError(400, "idea must be an ideas/<slug>.md path");

  const slug = S.slugify(title);
  if (!H.isSafeSlug(slug)) throw new H.HttpError(400, "title does not make a usable slug");
  if (await gh.getFile(P.projectPath(slug, "project.json"))) throw new H.HttpError(409, "project exists: " + slug);

  const p = S.createProject({ slug, title, target_minutes: minutes, idea });
  const errs = S.validate(p);
  if (errs.length) throw new H.HttpError(400, errs.join("; "));

  const files = [{ path: P.projectPath(slug, "project.json"), content: P.projectJSON(p) }];
  let ideaText = null;
  if (idea) {
    const src = await gh.getFile(idea);
    if (!src) throw new H.HttpError(404, "no idea file " + idea);
    ideaText = src.content;
    // Mark the idea as started in place.
    const started = /^status:.*$/m.test(ideaText)
      ? ideaText.replace(/^status:.*$/m, "status: started")
      : ideaText.replace(/\n\n/, "\nstatus: started\n\n");
    files.push({ path: idea, content: started });
  }
  files.push({
    path: P.projectPath(slug, "idea.md"),
    content: ideaText !== null ? ideaText
      : "title: " + title + "\nsource: human\nfound: " + p.created + "\nstatus: started\n\n"
  });
  for (const d of P.PROJECT_FOLDERS) files.push({ path: P.projectPath(slug, d + "/.gitkeep"), content: "" });

  const commit = await gh.commitFiles({ message: "ui: start " + slug, files });
  const routine = await require("../_lib/routine").fireRoutine("ui: start " + slug);
  H.send(res, 201, { project: p, waiting: S.waitingOn(p), commit: commit.sha, routine });
}

module.exports = H.handler(async (req, res) => {
  const session = require("../_lib/session").requireSession(req, res); if (!session) return;
  if (!H.methods(req, res, ["GET", "POST"])) return;
  if (req.method === "GET") return list(req, res);
  return create(req, res);
});
