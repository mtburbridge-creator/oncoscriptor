"use strict";
// Routine fire hook: no-op without config, posts with it, never throws.
(async () => {
  const { fireRoutine } = require("../api/_lib/routine");
  delete process.env.ROUTINE_FIRE_URL; delete process.env.ROUTINE_FIRE_TOKEN;
  let r = await fireRoutine("x");
  if (r.fired !== false) throw new Error("fire without config should not fire");
  process.env.ROUTINE_FIRE_URL = "https://example.invalid/fire"; process.env.ROUTINE_FIRE_TOKEN = "t";
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ claude_code_session_url: "https://claude.ai/code/s" }) }; };
  r = await fireRoutine("ui(slug): script.approve");
  global.fetch = realFetch;
  if (!r.fired || calls.length !== 1) throw new Error("fire with config should post once");
  const h = calls[0].opts.headers;
  if (h.Authorization !== "Bearer t" || !h["anthropic-beta"]) throw new Error("fire headers wrong");
  if (JSON.parse(calls[0].opts.body).text !== "ui(slug): script.approve") throw new Error("fire body wrong");
  global.fetch = async () => { throw new Error("down"); };
  r = await fireRoutine("x");
  global.fetch = realFetch;
  if (r.fired !== false) throw new Error("fire failure must be swallowed");
  console.log("ok routine fire hook");
})().catch(e => { console.error("FAIL routine fire hook: " + e.message); process.exit(1); });
