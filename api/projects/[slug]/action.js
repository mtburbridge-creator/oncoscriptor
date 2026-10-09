"use strict";
// POST /api/projects/:slug/action  { action, payload }
// Runs a human action through tools/state.js applyAction and commits the result.
const gh = require("../../_lib/github");
const H = require("../../_lib/http");
const S = require("../../../tools/state");
const P = require("../_shared");

const ACTIONS = ["script.approve", "script.feedback", "outline.approve", "outline.feedback",
                 "images.decide", "slides.order", "review.finish"];

module.exports = H.handler(async (req, res) => {
  const session = require("../../_lib/session").requireSession(req, res); if (!session) return;
  if (!H.methods(req, res, ["POST"])) return;
  const slug = H.param(req, "slug", 2);
  const body = await H.readBody(req);
  const action = String(body.action || "");
  if (ACTIONS.indexOf(action) < 0) throw new H.HttpError(400, "unknown action " + action);
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

  const { project } = await P.loadProject(slug);
  const needs = action === "review.finish" ? ["images/decisions.json", "images/prompts.json"]
    : action === "images.decide" || action === "slides.order" ? ["images/decisions.json"]
    : [];
  const files = await P.loadActionFiles(slug, needs);

  let result;
  try { result = S.applyAction(project, action, payload, files); }
  catch (e) { throw new H.HttpError(400, e.message); }

  const commitFiles = await P.materializeOps(slug, result.ops);
  commitFiles.push({ path: P.projectPath(slug, "project.json"), content: P.projectJSON(result.project) });
  const commit = await gh.commitFiles({ message: "ui(" + slug + "): " + action, files: commitFiles });
  const routine = await require("../../_lib/routine").fireRoutine("ui(" + slug + "): " + action);
  H.send(res, 200, { project: result.project, waiting: S.waitingOn(result.project), commit: commit.sha, routine });
});
