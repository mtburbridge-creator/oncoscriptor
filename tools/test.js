"use strict";
// Fast checks a contributor runs before pushing. No browser, no network.
const assert = require("assert");
const S = require("./state");

let n = 0;
function t(name, fn) { fn(); n++; console.log("ok " + name); }

t("new project enters research with five tasks", () => {
  const p = S.createProject({ title: "Immunotherapy side effects", target_minutes: 10 });
  assert.equal(p.slug, "immunotherapy-side-effects");
  assert.equal(p.phase, "research");
  assert.deepEqual(Object.keys(p.tasks).sort(),
    ["research.forums", "research.literature", "research.news", "research.sources", "synthesis"]);
  assert.equal(p.tasks.synthesis.status, "blocked");
  assert.equal(S.waitingOn(p).on, "agents");
});

t("synthesis unblocks after all research, then draft, then review", () => {
  const p = S.createProject({ title: "T", target_minutes: 9 });
  for (const k of ["research.forums", "research.literature", "research.sources", "research.news"]) S.setTask(p, k, "done");
  assert.equal(p.tasks.synthesis.status, "todo");
  assert.equal(S.waitingOn(p).on, "claude");
  S.setTask(p, "synthesis", "done");
  assert.equal(p.phase, "draft");
  assert.equal(p.tasks["script.draft"].status, "todo");
  S.setTask(p, "script.draft", "done");
  assert.equal(p.phase, "script_review");
  assert.equal(p.script_version, 1);
  assert.equal(S.waitingOn(p).on, "human");
});

function toReview() {
  const p = S.createProject({ title: "T", target_minutes: 9 });
  for (const k of ["research.forums", "research.literature", "research.sources", "research.news"]) S.setTask(p, k, "done");
  S.setTask(p, "synthesis", "done");
  S.setTask(p, "script.draft", "done");
  return p;
}

t("feedback queues a revise, approve moves on", () => {
  const p = toReview();
  let r = S.applyAction(p, "script.feedback", { text: "Shorter intro." });
  assert.equal(r.ops[0].path, "script/feedback-v1.md");
  assert.equal(p.tasks["script.revise"].status, "todo");
  assert.throws(() => S.applyAction(p, "script.approve"), /revision/);
  S.setTask(p, "script.revise", "done");
  assert.equal(p.script_version, 2, "revise done bumps the version");
  r = S.applyAction(p, "script.approve");
  assert.equal(r.ops[0].from, "script/v2.md");
  assert.equal(r.ops[0].op, "copy");
  assert.equal(p.phase, "outline_images");
  assert.equal(p.tasks["images.generate"].status, "blocked");
  S.setTask(p, "images.prompts", "done");
  assert.equal(p.tasks["images.generate"].status, "todo");
  assert.equal(p.tasks["images.generate"].owner, "hermes");
});

t("image iterate loops through reprompt and regenerate, then finish", () => {
  const p = toReview();
  S.applyAction(p, "script.approve");
  for (const k of ["outline.draft", "images.prompts", "images.generate"]) S.setTask(p, k, "done");
  assert.equal(p.phase, "review");
  const prompts = JSON.stringify({ prompts: [{ id: "01" }, { id: "02" }] });
  let r = S.applyAction(p, "images.decide",
    { decisions: { "01": { decision: "approve" }, "02": { decision: "iterate", note: "warmer" } } },
    { "images/prompts.json": prompts });
  const decisions = r.ops[0].content;
  assert.equal(p.tasks["images.reprompt"].status, "todo");
  assert.equal(p.tasks["images.generate"].status, "blocked");
  S.setTask(p, "images.reprompt", "done");
  assert.equal(p.tasks["images.generate"].status, "todo");
  S.setTask(p, "images.generate", "done");
  r = S.applyAction(p, "images.decide", { decisions: { "02": { decision: "reject" } } },
    { "images/prompts.json": prompts, "images/decisions.json": decisions });
  const decisions2 = r.ops[0].content;
  const d2 = JSON.parse(decisions2).decisions["02"];
  assert.equal(d2.decision, "reject");
  assert.equal(d2.history[0].decision, "iterate");
  assert.equal(d2.history[0].note, "warmer");
  assert.throws(() => S.applyAction(p, "review.finish", {}, { "images/prompts.json": prompts, "images/decisions.json": decisions2 }), /outline/);
  S.applyAction(p, "outline.approve");
  assert.throws(() => S.applyAction(p, "slides.order", { order: ["02"] }, { "images/decisions.json": decisions2 }), /not approved/);
  S.applyAction(p, "slides.order", { order: ["01"] }, { "images/decisions.json": decisions2 });
  S.applyAction(p, "review.finish", {}, { "images/prompts.json": prompts, "images/decisions.json": decisions2 });
  assert.equal(p.phase, "slides");
  S.setTask(p, "slides.build", "done");
  assert.equal(p.phase, "package");
  S.setTask(p, "package.build", "done");
  assert.equal(p.phase, "done");
  assert.equal(p.tasks.learn.status, "todo");
  assert.equal(S.validate(p).length, 0);
});

t("validate catches bad projects", () => {
  const p = S.createProject({ title: "T", target_minutes: 30 });
  assert.ok(S.validate(p).some(e => /target_minutes/.test(e)));
});

console.log(n + " checks passed");
