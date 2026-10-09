"use strict";
/*
 * OncoGenik project state machine.
 *
 * Pure functions over a project.json object. No file system here. Callers
 * (the CLI, the serverless API, the Actions runner) execute the returned
 * file operations against whatever store they have.
 */

const PHASES = ["research", "draft", "script_review", "outline_images", "review", "slides", "package", "done"];
const STATUSES = ["todo", "running", "done", "blocked", "failed"];
const OWNERS = ["human", "claude", "hermes"];

// Phases where nothing moves until a person acts.
const HUMAN_PHASES = { script_review: true, review: true };

// Every agent task the engine can create. `needs` lists tasks that must be
// done before this one leaves `blocked`. `skill` names the Claude skill.
const TASKS = {
  "research.forums":     { owner: "hermes" },
  "research.literature": { owner: "hermes" },
  "research.sources":    { owner: "claude", skill: "research-sources" },
  "research.news":       { owner: "claude", skill: "research-news" },
  "synthesis":           { owner: "claude", skill: "synthesis",
                           needs: ["research.forums", "research.literature", "research.sources", "research.news"] },
  "script.draft":        { owner: "claude", skill: "draft" },
  "script.revise":       { owner: "claude", skill: "revise" },
  "outline.draft":       { owner: "claude", skill: "outline" },
  "outline.revise":      { owner: "claude", skill: "outline-revise" },
  "images.prompts":      { owner: "claude", skill: "prompts" },
  "images.reprompt":     { owner: "claude", skill: "reprompt" },
  "images.generate":     { owner: "hermes", needs: ["images.prompts"] },
  "slides.build":        { owner: "claude", skill: "slides" },
  "package.build":       { owner: "claude", skill: "package" },
  "learn":               { owner: "claude", skill: "learn" }
};

// Tasks created on entering each phase.
const PHASE_TASKS = {
  research: ["research.forums", "research.literature", "research.sources", "research.news", "synthesis"],
  draft: ["script.draft"],
  script_review: [],
  outline_images: ["outline.draft", "images.prompts", "images.generate"],
  review: [],
  slides: ["slides.build"],
  package: ["package.build"],
  done: ["learn"]
};

function today() { return new Date().toISOString().slice(0, 10); }
function now() { return new Date().toISOString(); }

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function makeTask(name, extra) {
  const def = TASKS[name];
  if (!def) throw new Error("unknown task " + name);
  const t = { owner: def.owner, status: def.needs ? "blocked" : "todo", updated: now() };
  if (def.needs) t.needs = def.needs.slice();
  return Object.assign(t, extra || {});
}

function createProject(opts) {
  if (!opts || !opts.title) throw new Error("title required");
  const slug = opts.slug ? slugify(opts.slug) : slugify(opts.title);
  const p = {
    slug,
    title: opts.title,
    audience: "patient",
    target_minutes: Number(opts.target_minutes || opts.minutes || 10),
    phase: "research",
    created: today(),
    updated: now(),
    idea: opts.idea || null,
    tasks: {},
    script_version: 0,
    outline_version: 0,
    approved: { script: false, outline: false },
    history: []
  };
  enterPhase(p, "research", "created");
  return p;
}

function log(p, msg) {
  p.history = p.history || [];
  p.history.push({ at: now(), msg });
  if (p.history.length > 200) p.history.splice(0, p.history.length - 200);
  p.updated = now();
}

function enterPhase(p, phase, why) {
  if (PHASES.indexOf(phase) < 0) throw new Error("unknown phase " + phase);
  p.phase = phase;
  for (const name of PHASE_TASKS[phase]) {
    if (!p.tasks[name] || p.tasks[name].status === "done" || p.tasks[name].status === "failed") {
      const round = p.tasks[name] ? (p.tasks[name].round || 1) + 1 : 1;
      p.tasks[name] = makeTask(name, { round });
    }
  }
  log(p, "phase " + phase + (why ? " (" + why + ")" : ""));
}

function taskDone(p, name) { return p.tasks[name] && p.tasks[name].status === "done"; }
function taskOpen(p, name) {
  const t = p.tasks[name];
  return !!t && (t.status === "todo" || t.status === "running" || t.status === "blocked");
}
function openTasks(p) {
  return Object.keys(p.tasks).filter(n => taskOpen(p, n));
}

function setTask(p, name, status, extra) {
  if (!p.tasks[name]) throw new Error("task " + name + " not on project " + p.slug);
  if (STATUSES.indexOf(status) < 0) throw new Error("bad status " + status);
  const t = p.tasks[name];
  t.status = status;
  t.updated = now();
  if (status !== "failed") delete t.error;
  if (extra) Object.assign(t, extra);
  log(p, name + " -> " + status);
  reconcile(p);
  return p;
}

// Re-create an agent task for another round, e.g. a revise after feedback.
function requeue(p, name, extra) {
  const round = p.tasks[name] ? (p.tasks[name].round || 1) + 1 : 1;
  p.tasks[name] = makeTask(name, Object.assign({ round }, extra || {}));
  log(p, name + " queued (round " + round + ")");
  reconcile(p);
}

/*
 * Make the project consistent with its task statuses. Idempotent. Unblocks
 * tasks whose needs are done, and advances phases whose exit rule holds.
 * Returns the list of changes made.
 */
function reconcile(p) {
  const changes = [];
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 20) {
    moved = false;
    for (const name of Object.keys(p.tasks)) {
      const t = p.tasks[name];
      if (t.status === "blocked" && (t.needs || []).every(n => taskDone(p, n))) {
        t.status = "todo"; t.updated = now();
        changes.push(name + " unblocked"); moved = true;
      }
    }
    const next = phaseExit(p);
    if (next) {
      enterPhase(p, next.phase, next.why);
      changes.push("phase -> " + next.phase); moved = true;
    }
  }
  if (p.phase === "script_review" && p.script_version === 0 && taskDone(p, "script.draft")) {
    p.script_version = 1;
  }
  return changes;
}

// Exit rule per phase. Returns {phase, why} or null.
function phaseExit(p) {
  switch (p.phase) {
    case "research":
      return taskDone(p, "synthesis") ? { phase: "draft", why: "synthesis done" } : null;
    case "draft":
      if (taskDone(p, "script.draft")) {
        if (p.script_version === 0) p.script_version = 1;
        return { phase: "script_review", why: "draft done" };
      }
      return null;
    case "script_review":
      // Leaves only through the script.approve action.
      return null;
    case "outline_images":
      if (taskDone(p, "outline.draft") && taskDone(p, "images.prompts") && taskDone(p, "images.generate")) {
        if (p.outline_version === 0) p.outline_version = 1;
        return { phase: "review", why: "outline and images ready" };
      }
      return null;
    case "review":
      // Leaves only through the review.finish action.
      return null;
    case "slides":
      return taskDone(p, "slides.build") ? { phase: "package", why: "deck built" } : null;
    case "package":
      return taskDone(p, "package.build") ? { phase: "done", why: "package built" } : null;
    default:
      return null;
  }
}

// Who the project waits on right now.
function waitingOn(p) {
  const open = openTasks(p);
  const owners = {};
  for (const n of open) {
    const t = p.tasks[n];
    if (t.status === "todo" || t.status === "running") owners[t.owner] = true;
  }
  const list = Object.keys(owners);
  if (list.length) return { on: list.length === 1 ? list[0] : "agents", owners: list, tasks: open };
  const failed = Object.keys(p.tasks).filter(n => p.tasks[n].status === "failed");
  if (failed.length) return { on: "human", owners: ["human"], tasks: failed, reason: "failed tasks" };
  if (HUMAN_PHASES[p.phase]) return { on: "human", owners: ["human"], tasks: [] };
  if (p.phase === "done") return { on: "none", owners: [], tasks: [] };
  // Blocked-only tasks with nothing running means a dependency never got created.
  return { on: "human", owners: ["human"], tasks: open, reason: "stalled" };
}

function tasksFor(p, owner, status) {
  return Object.keys(p.tasks).filter(n => p.tasks[n].owner === owner && p.tasks[n].status === (status || "todo"));
}

/*
 * Human actions. Each returns { project, ops } where ops are file operations
 * relative to the project folder:
 *   { op: "write", path, content }
 *   { op: "copy", from, to }
 * Callers may also pass `files`, a map of path -> content for files the action
 * needs to read (decisions.json, prompts.json). Missing files are treated as empty.
 */
function applyAction(p, action, payload, files) {
  payload = payload || {};
  files = files || {};
  const ops = [];
  const read = (path) => files[path];
  const readJSON = (path, fallback) => {
    const s = read(path);
    if (!s) return fallback;
    try { return JSON.parse(s); } catch (e) { return fallback; }
  };

  switch (action) {
    case "script.approve": {
      if (p.phase !== "script_review") throw new Error("script.approve needs phase script_review, have " + p.phase);
      if (taskOpen(p, "script.revise")) throw new Error("a revision is still in progress");
      const v = "script/v" + p.script_version + ".md";
      ops.push({ op: "copy", from: v, to: "script/final.md" });
      p.approved.script = true;
      log(p, "script approved at v" + p.script_version);
      enterPhase(p, "outline_images", "script approved");
      reconcile(p);
      break;
    }
    case "script.feedback": {
      if (p.phase !== "script_review") throw new Error("script.feedback needs phase script_review, have " + p.phase);
      if (!payload.text || !payload.text.trim()) throw new Error("feedback text required");
      if (taskOpen(p, "script.revise")) throw new Error("a revision is still in progress");
      ops.push({ op: "write", path: "script/feedback-v" + p.script_version + ".md",
                 content: "# Feedback on v" + p.script_version + "\n\n" + payload.text.trim() + "\n" });
      log(p, "feedback on script v" + p.script_version);
      requeue(p, "script.revise");
      break;
    }
    case "outline.approve": {
      if (p.phase !== "review") throw new Error("outline.approve needs phase review, have " + p.phase);
      if (taskOpen(p, "outline.revise")) throw new Error("an outline revision is still in progress");
      ops.push({ op: "copy", from: "outline/v" + p.outline_version + ".md", to: "outline/final.md" });
      p.approved.outline = true;
      log(p, "outline approved at v" + p.outline_version);
      break;
    }
    case "outline.feedback": {
      if (p.phase !== "review") throw new Error("outline.feedback needs phase review, have " + p.phase);
      if (!payload.text || !payload.text.trim()) throw new Error("feedback text required");
      if (taskOpen(p, "outline.revise")) throw new Error("an outline revision is still in progress");
      ops.push({ op: "write", path: "outline/feedback-v" + p.outline_version + ".md",
                 content: "# Feedback on outline v" + p.outline_version + "\n\n" + payload.text.trim() + "\n" });
      p.approved.outline = false;
      log(p, "feedback on outline v" + p.outline_version);
      requeue(p, "outline.revise");
      break;
    }
    case "images.decide": {
      if (p.phase !== "review") throw new Error("images.decide needs phase review, have " + p.phase);
      if (taskOpen(p, "images.reprompt") || taskOpen(p, "images.generate")) throw new Error("images are still being regenerated");
      const decisions = readJSON("images/decisions.json", { decisions: {} });
      const incoming = payload.decisions || {};
      const ids = Object.keys(incoming);
      if (!ids.length) throw new Error("no decisions given");
      let iterate = 0;
      for (const id of ids) {
        const d = incoming[id] || {};
        if (["approve", "reject", "iterate"].indexOf(d.decision) < 0) throw new Error("bad decision for " + id);
        decisions.decisions[id] = { decision: d.decision, note: d.note || "", at: now() };
        if (d.decision === "iterate") iterate++;
      }
      decisions.updated = now();
      ops.push({ op: "write", path: "images/decisions.json", content: JSON.stringify(decisions, null, 2) + "\n" });
      log(p, "image decisions: " + ids.length + " (" + iterate + " to iterate)");
      if (iterate) {
        requeue(p, "images.reprompt");
        // Generation waits on the reprompt this round.
        p.tasks["images.generate"] = makeTask("images.generate", {
          round: (p.tasks["images.generate"].round || 1) + 1, needs: ["images.reprompt"], status: "blocked"
        });
        reconcile(p);
      }
      break;
    }
    case "slides.order": {
      if (p.phase !== "review") throw new Error("slides.order needs phase review, have " + p.phase);
      const order = Array.isArray(payload.order) ? payload.order.map(String) : null;
      if (!order || !order.length) throw new Error("order must be a non-empty list of image ids");
      const decisions = readJSON("images/decisions.json", { decisions: {} }).decisions;
      for (const id of order) {
        if (!decisions[id] || decisions[id].decision !== "approve") throw new Error("image " + id + " is not approved");
      }
      ops.push({ op: "write", path: "slides/order.json",
                 content: JSON.stringify({ order, updated: now() }, null, 2) + "\n" });
      p.slides_order = order;
      log(p, "slide order set: " + order.join(","));
      break;
    }
    case "review.finish": {
      if (p.phase !== "review") throw new Error("review.finish needs phase review, have " + p.phase);
      if (!p.approved.outline) throw new Error("outline not approved");
      if (openTasks(p).length) throw new Error("agent tasks still open: " + openTasks(p).join(", "));
      const decisions = readJSON("images/decisions.json", { decisions: {} }).decisions;
      const prompts = readJSON("images/prompts.json", { prompts: [] }).prompts;
      for (const pr of prompts) {
        const d = decisions[pr.id];
        if (!d) throw new Error("image " + pr.id + " has no decision");
        if (d.decision === "iterate") throw new Error("image " + pr.id + " is still marked iterate");
      }
      if (!p.slides_order || !p.slides_order.length) throw new Error("set a slide order first");
      enterPhase(p, "slides", "review finished");
      reconcile(p);
      break;
    }
    default:
      throw new Error("unknown action " + action);
  }
  p.updated = now();
  return { project: p, ops };
}

function validate(p) {
  const errs = [];
  if (!p || typeof p !== "object") return ["not an object"];
  if (!p.slug || p.slug !== slugify(p.slug)) errs.push("bad slug");
  if (!p.title) errs.push("missing title");
  if (PHASES.indexOf(p.phase) < 0) errs.push("bad phase " + p.phase);
  if (p.audience !== "patient") errs.push("audience must be patient");
  if (!(p.target_minutes >= 8 && p.target_minutes <= 15)) errs.push("target_minutes must be 8 to 15");
  if (!p.tasks || typeof p.tasks !== "object") errs.push("missing tasks");
  else for (const name of Object.keys(p.tasks)) {
    const t = p.tasks[name];
    if (!TASKS[name]) errs.push("unknown task " + name);
    else if (t.owner !== TASKS[name].owner) errs.push(name + " owner should be " + TASKS[name].owner);
    if (STATUSES.indexOf(t.status) < 0) errs.push(name + " bad status " + t.status);
  }
  return errs;
}

module.exports = {
  PHASES, STATUSES, OWNERS, TASKS, PHASE_TASKS, HUMAN_PHASES,
  slugify, createProject, enterPhase, setTask, requeue, reconcile,
  waitingOn, tasksFor, openTasks, applyAction, validate
};
