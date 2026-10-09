"use strict";
// GET /api/projects/:slug   project.json plus a file index of the folder
const gh = require("../../_lib/github");
const H = require("../../_lib/http");
const S = require("../../../tools/state");
const P = require("../_shared");

module.exports = H.handler(async (req, res) => {
  const session = require("../../_lib/session").requireSession(req, res); if (!session) return;
  if (!H.methods(req, res, ["GET"])) return;
  const slug = H.param(req, "slug", 2);
  const { project } = await P.loadProject(slug);
  const tree = await gh.getTree();
  const prefix = P.projectPath(slug) + "/";
  const files = tree.entries
    .filter(e => e.type === "blob" && e.path.startsWith(prefix))
    .map(e => ({ path: e.path.slice(prefix.length), size: e.size || 0 }))
    .filter(f => !f.path.endsWith(".gitkeep"))
    .sort((a, b) => a.path.localeCompare(b.path));
  H.send(res, 200, { project, waiting: S.waitingOn(project), files, truncated: tree.truncated });
});
