#!/usr/bin/env node
"use strict";
/*
 * OncoGenik project CLI. Local file system only. Every command reads and
 * writes projects/<slug>/project.json and runs reconcile afterwards.
 *
 *   node tools/project.js new <slug> --title "..." [--minutes 10] [--idea ideas/x.md]
 *   node tools/project.js todo [claude|hermes]        tasks ready to run, one per line: <slug> <task>
 *   node tools/project.js start <slug> <task>         mark running
 *   node tools/project.js done <slug> <task>          mark done, advance
 *   node tools/project.js fail <slug> <task> "<why>"
 *   node tools/project.js action <slug> <action> [--json '{...}' | --file payload.json]
 *   node tools/project.js reconcile [slug]
 *   node tools/project.js status [slug]
 *   node tools/project.js validate
 */
const fs = require("fs");
const path = require("path");
const S = require("./state");

const ROOT = path.resolve(__dirname, "..");
const PROJECTS = path.join(ROOT, "projects");

function die(msg) { console.error("error: " + msg); process.exit(1); }
function projDir(slug) { return path.join(PROJECTS, slug); }
function projFile(slug) { return path.join(projDir(slug), "project.json"); }
function load(slug) {
  const f = projFile(slug);
  if (!fs.existsSync(f)) die("no project " + slug);
  return JSON.parse(fs.readFileSync(f, "utf8"));
}
function save(p) {
  fs.mkdirSync(projDir(p.slug), { recursive: true });
  fs.writeFileSync(projFile(p.slug), JSON.stringify(p, null, 2) + "\n");
}
function slugs() {
  if (!fs.existsSync(PROJECTS)) return [];
  return fs.readdirSync(PROJECTS).filter(s => fs.existsSync(projFile(s))).sort();
}
function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) { out[a.slice(2)] = args[i + 1]; i++; }
    else out._.push(a);
  }
  return out;
}
function runOps(slug, ops) {
  const dir = projDir(slug);
  for (const op of ops) {
    if (op.op === "write") {
      const f = path.join(dir, op.path);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, op.content);
    } else if (op.op === "copy") {
      const from = path.join(dir, op.from), to = path.join(dir, op.to);
      if (!fs.existsSync(from)) die("missing " + op.from);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}
function readProjectFiles(slug, names) {
  const out = {};
  for (const n of names) {
    const f = path.join(projDir(slug), n);
    if (fs.existsSync(f)) out[n] = fs.readFileSync(f, "utf8");
  }
  return out;
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

switch (cmd) {
  case "new": {
    const slug = flags._[0];
    if (!slug || !flags.title) die("usage: new <slug> --title \"...\" [--minutes 10] [--idea ideas/x.md]");
    if (fs.existsSync(projFile(slug))) die("project exists: " + slug);
    const p = S.createProject({ slug, title: flags.title, target_minutes: flags.minutes, idea: flags.idea || null });
    save(p);
    if (flags.idea) {
      const src = path.join(ROOT, flags.idea);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(projDir(p.slug), "idea.md"));
    } else {
      fs.writeFileSync(path.join(projDir(p.slug), "idea.md"),
        "title: " + flags.title + "\nsource: human\nfound: " + p.created + "\nstatus: started\n\n");
    }
    for (const d of ["research", "script", "outline", "images/generated", "slides", "package"]) {
      fs.mkdirSync(path.join(projDir(p.slug), d), { recursive: true });
    }
    console.log("created " + p.slug + " in phase " + p.phase);
    break;
  }
  case "todo": {
    const owner = flags._[0];
    for (const slug of slugs()) {
      const p = load(slug);
      for (const name of Object.keys(p.tasks)) {
        const t = p.tasks[name];
        if (t.status !== "todo") continue;
        if (owner && t.owner !== owner) continue;
        console.log(slug + " " + name + (owner ? "" : " " + t.owner));
      }
    }
    break;
  }
  case "start": case "done": case "fail": {
    const [slug, task, why] = flags._;
    if (!slug || !task) die("usage: " + cmd + " <slug> <task>");
    const p = load(slug);
    const status = cmd === "start" ? "running" : cmd === "done" ? "done" : "failed";
    S.setTask(p, task, status, status === "failed" ? { error: why || "unknown" } : null);
    save(p);
    console.log(slug + " " + task + " -> " + status + "; phase " + p.phase + "; waiting on " + S.waitingOn(p).on);
    break;
  }
  case "action": {
    const [slug, action] = flags._;
    if (!slug || !action) die("usage: action <slug> <action> [--json '{...}' | --file payload.json]");
    let payload = {};
    if (flags.json) payload = JSON.parse(flags.json);
    else if (flags.file) payload = JSON.parse(fs.readFileSync(flags.file, "utf8"));
    const p = load(slug);
    const files = readProjectFiles(slug, ["images/decisions.json", "images/prompts.json", "slides/order.json"]);
    let res;
    try { res = S.applyAction(p, action, payload, files); } catch (e) { die(e.message); }
    runOps(slug, res.ops);
    save(res.project);
    console.log(slug + " " + action + " ok; phase " + p.phase + "; waiting on " + S.waitingOn(p).on);
    break;
  }
  case "reconcile": {
    const list = flags._[0] ? [flags._[0]] : slugs();
    for (const slug of list) {
      const p = load(slug);
      const changes = S.reconcile(p);
      save(p);
      if (changes.length) console.log(slug + ": " + changes.join("; "));
    }
    break;
  }
  case "status": {
    const list = flags._[0] ? [flags._[0]] : slugs();
    for (const slug of list) {
      const p = load(slug);
      const w = S.waitingOn(p);
      console.log(slug + "  phase=" + p.phase + "  waiting=" + w.on + (w.reason ? " (" + w.reason + ")" : ""));
      for (const name of Object.keys(p.tasks)) {
        const t = p.tasks[name];
        if (t.status === "done") continue;
        console.log("    " + name.padEnd(22) + t.owner.padEnd(8) + t.status + (t.error ? "  " + t.error : ""));
      }
    }
    break;
  }
  case "validate": {
    let bad = 0;
    for (const slug of slugs()) {
      const p = load(slug);
      const errs = S.validate(p);
      if (p.slug !== slug) errs.push("folder name differs from slug");
      if (errs.length) { bad++; console.log(slug + ": " + errs.join("; ")); }
    }
    console.log(bad ? bad + " invalid" : "all projects valid (" + slugs().length + ")");
    process.exit(bad ? 1 : 0);
  }
  default:
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].split("\n").slice(2).map(l => l.replace(/^ \* ?/, "")).join("\n"));
}
