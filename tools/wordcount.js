#!/usr/bin/env node
"use strict";
/*
 * Spoken word count for a script or outline, by the guideline definition:
 * skip the H1 and the header line under it, skip the Sources section,
 * strip citation keys like [S3], strip markdown markers, count words.
 *
 *   node tools/wordcount.js <file.md> [--wpm 140]
 * Prints: <words> words, <minutes> min at <wpm> wpm
 */
const fs = require("fs");
function count(text) {
  const lines = text.split("\n");
  let out = [], skip = false, seenH1 = false, headerSkipped = false;
  for (const line of lines) {
    if (/^#\s/.test(line)) { seenH1 = true; continue; }
    if (seenH1 && !headerSkipped && line.trim()) { headerSkipped = true; if (/^\*.*\*$/.test(line.trim()) || /minutes|words|slug/i.test(line)) continue; }
    if (/^##\s*sources/i.test(line)) { skip = true; continue; }
    if (/^##\s/.test(line)) { skip = false; continue; }
    if (skip) continue;
    if (/^\*About .* minutes?\*$/i.test(line.trim())) continue;
    out.push(line.replace(/\[S\d+\]/g, " ").replace(/[*_`>#-]/g, " "));
  }
  return out.join(" ").split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length;
}
module.exports = { count };
if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file) { console.error("usage: node tools/wordcount.js <file.md> [--wpm 140]"); process.exit(1); }
  const i = args.indexOf("--wpm");
  const wpm = i >= 0 ? Number(args[i + 1]) : 140;
  const words = count(fs.readFileSync(file, "utf8"));
  console.log(words + " words, " + (words / wpm).toFixed(1) + " min at " + wpm + " wpm");
}
