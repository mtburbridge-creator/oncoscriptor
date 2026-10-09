#!/usr/bin/env node
"use strict";
/*
 * Pick the next Claude task for the Actions runner.
 *
 *   node tools/next-claude-task.js [--no-reconcile]
 *
 * Runs reconcile over every project (so tasks whose needs just landed are
 * unblocked and phases advance), saves any project that changed, then prints
 * ONE line, "<slug> <task> <skill>", for the first Claude-owned task with
 * status todo. Projects are visited in slug order; within a project tasks
 * are visited in the order they appear in project.json, which is the order
 * the state machine created them.
 *
 * Exit codes: 0 a task was printed, 3 nothing is ready, 1 on error.
 *
 * tools/project.js runs its CLI on require, so the tiny project loader is
 * repeated here rather than imported.
 */
const fs = require("fs");
const path = require("path");
const S = require("./state");

const ROOT = path.resolve(__dirname, "..");
const PROJECTS = path.join(ROOT, "projects");

function projFile(slug) { return path.join(PROJECTS, slug, "project.json"); }
function slugs() {
  if (!fs.existsSync(PROJECTS)) return [];
  return fs.readdirSync(PROJECTS).filter(s => fs.existsSync(projFile(s))).sort();
}
function load(slug) { return JSON.parse(fs.readFileSync(projFile(slug), "utf8")); }
function save(p) { fs.writeFileSync(projFile(p.slug), JSON.stringify(p, null, 2) + "\n"); }

function main(argv) {
  const reconcile = argv.indexOf("--no-reconcile") < 0;
  let found = null;
  for (const slug of slugs()) {
    let p;
    try { p = load(slug); } catch (e) {
      console.error("skip " + slug + ": " + e.message);
      continue;
    }
    if (reconcile) {
      const changes = S.reconcile(p);
      if (changes.length) {
        save(p);
        console.error(slug + ": " + changes.join("; "));
      }
    }
    if (found) continue;
    for (const name of Object.keys(p.tasks)) {
      const t = p.tasks[name];
      if (t.owner !== "claude" || t.status !== "todo") continue;
      const def = S.TASKS[name];
      if (!def || !def.skill) {
        console.error("skip " + slug + " " + name + ": no skill for task");
        continue;
      }
      found = { slug, task: name, skill: def.skill };
      break;
    }
  }
  if (!found) return 3;
  console.log(found.slug + " " + found.task + " " + found.skill);
  return 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (e) { console.error("error: " + e.message); process.exit(1); }
}

module.exports = { main };
