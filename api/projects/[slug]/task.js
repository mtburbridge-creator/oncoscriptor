"use strict";
// POST /api/projects/:slug/task  { task, status: "todo" }
// The one task edit a person may make: put a failed agent task back in the queue.
const gh = require("../../_lib/github");
const H = require("../../_lib/http");
const S = require("../../../tools/state");
const P = require("../_shared");

module.exports = H.handler(async (req, res) => {
  const session = require("../../_lib/session").requireSession(req, res); if (!session) return;
  if (!H.methods(req, res, ["POST"])) return;
  const slug = H.param(req, "slug", 2);
  const body = await H.readBody(req);
  const task = String(body.task || "");
  if (body.status !== "todo") throw new H.HttpError(400, "status must be todo");
  if (!S.TASKS[task]) throw new H.HttpError(400, "unknown task " + task);

  const { project } = await P.loadProject(slug);
  const t = project.tasks[task];
  if (!t) throw new H.HttpError(404, "task " + task + " not on project");
  if (t.status !== "failed") throw new H.HttpError(409, "task " + task + " is " + t.status + ", only failed tasks can be retried");

  S.setTask(project, task, "todo");
  const commit = await gh.commitFiles({
    message: "ui(" + slug + "): retry " + task,
    files: [{ path: P.projectPath(slug, "project.json"), content: P.projectJSON(project) }]
  });
  H.send(res, 200, { project, waiting: S.waitingOn(project), commit: commit.sha });
});
