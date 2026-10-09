"use strict";
// Shared by the project handlers. Underscore-prefixed, so Vercel does not
// expose it as a function.
const gh = require("../_lib/github");
const { HttpError, isSafeSlug } = require("../_lib/http");
const S = require("../../tools/state");

const PROJECT_FOLDERS = ["research", "script", "outline", "images/generated", "slides", "package"];
const ACTION_FILES = ["images/decisions.json", "images/prompts.json", "slides/order.json"];

function projectPath(slug, rel) { return "projects/" + slug + (rel ? "/" + rel : ""); }

async function loadProject(slug) {
  if (!isSafeSlug(slug)) throw new HttpError(400, "bad slug");
  const f = await gh.getFile(projectPath(slug, "project.json"));
  if (!f) throw new HttpError(404, "no project " + slug);
  let p;
  try { p = JSON.parse(f.content); } catch (e) { throw new HttpError(500, "project.json is not valid JSON"); }
  return { project: p, sha: f.sha };
}

// Files applyAction may need, read from the repo. Missing files are skipped.
async function loadActionFiles(slug, names) {
  const out = {};
  for (const n of names || ACTION_FILES) {
    const f = await gh.getFile(projectPath(slug, n));
    if (f) out[n] = f.content;
  }
  return out;
}

// Turn applyAction ops into commit file entries.
async function materializeOps(slug, ops) {
  const files = [];
  for (const op of ops) {
    if (op.op === "write") {
      files.push({ path: projectPath(slug, op.path), content: op.content });
    } else if (op.op === "copy") {
      const buf = await gh.getBinary(projectPath(slug, op.from));
      if (buf === null) throw new HttpError(409, "missing " + op.from);
      files.push({ path: projectPath(slug, op.to), content: buf });
    } else {
      throw new HttpError(500, "unknown op " + op.op);
    }
  }
  return files;
}

function summarize(p) {
  const w = S.waitingOn(p);
  const open = [], failed = [];
  for (const name of Object.keys(p.tasks || {})) {
    const t = p.tasks[name];
    if (t.status === "failed") failed.push({ name, owner: t.owner, error: t.error || "", updated: t.updated });
    else if (t.status !== "done") open.push({ name, owner: t.owner, status: t.status, updated: t.updated });
  }
  return {
    slug: p.slug, title: p.title, phase: p.phase, created: p.created, updated: p.updated,
    target_minutes: p.target_minutes, script_version: p.script_version, outline_version: p.outline_version,
    waiting: w, open, failed
  };
}

function projectJSON(p) { return JSON.stringify(p, null, 2) + "\n"; }

module.exports = { PROJECT_FOLDERS, ACTION_FILES, projectPath, loadProject, loadActionFiles, materializeOps, summarize, projectJSON };
