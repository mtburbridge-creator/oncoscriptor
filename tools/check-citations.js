#!/usr/bin/env node
"use strict";
/*
 * Every [Sn] key used in a script or outline must resolve to a "## Sn" heading
 * (or a line starting with "Sn.") in the project's research/sources.md.
 *
 *   node tools/check-citations.js <slug> [script/v1.md ...]
 * Defaults to the latest script version. Exit 1 on any unresolved key.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const slug = process.argv[2];
if (!slug) { console.error("usage: node tools/check-citations.js <slug> [files...]"); process.exit(1); }
const dir = path.join(ROOT, "projects", slug);
const proj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
let files = process.argv.slice(3);
if (!files.length) files = ["script/v" + Math.max(1, proj.script_version) + ".md"];
const sources = fs.readFileSync(path.join(dir, "research/sources.md"), "utf8");
const defined = new Set();
for (const m of sources.matchAll(/^(?:##\s*|\s*)(S\d+)\b/gm)) defined.add(m[1]);
let bad = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  const used = new Set([...text.matchAll(/\[(S\d+)\]/g)].map(m => m[1]));
  const missing = [...used].filter(k => !defined.has(k));
  console.log(f + ": " + used.size + " keys used, " + missing.length + " unresolved" + (missing.length ? " (" + missing.join(", ") + ")" : ""));
  bad += missing.length;
}
process.exit(bad ? 1 : 0);
