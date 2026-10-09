#!/usr/bin/env node
/*
 * stage-static.js — the Vercel build command.
 *
 *   node tools/stage-static.js
 *
 * Assembles dist/, the only directory Vercel serves statically:
 *
 *   dist/                              <- web/**  (the OncoGenik UI pages)
 *   dist/backgenapp/index.html         <- slides/studio/index.html (the Studio, one canonical copy in git)
 *   dist/vendor/simplewebauthn-browser.js <- node_modules/@simplewebauthn/browser UMD bundle
 *   dist/vendor/marked.min.js          <- node_modules/marked UMD bundle
 *
 * Nothing else is copied, so projects/, ideas/, guidelines/ and the rest of the
 * repo are never reachable over HTTP. Serverless functions in api/ are picked up
 * by Vercel from the repo root independently of this output directory.
 *
 * Idempotent: dist/ is rebuilt from scratch on every run.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DIST = path.join(REPO, 'dist');

const COPIES = [
  { from: 'slides/studio/index.html', to: 'backgenapp/index.html' },
  { from: 'node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', to: 'vendor/simplewebauthn-browser.js' },
  { from: 'node_modules/marked/lib/marked.umd.js', to: 'vendor/marked.min.js' }
];

function stage() {
  const copied = [];
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const web = path.join(REPO, 'web');
  if (fs.existsSync(web) && fs.statSync(web).isDirectory()) {
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.isFile()) {
          const rel = path.relative(web, abs);
          const dest = path.join(DIST, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(abs, dest);
          copied.push({ from: path.join('web', rel), to: rel });
        }
      }
    };
    walk(web);
  }

  for (const c of COPIES) {
    const src = path.join(REPO, c.from);
    if (!fs.existsSync(src)) throw new Error(`missing ${c.from} (run npm install?)`);
    const dest = path.join(DIST, c.to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(c);
  }
  return copied;
}

if (require.main === module) {
  try {
    const copied = stage();
    for (const c of copied) console.log(`copied ${c.from} -> dist/${c.to}`);
    console.log(`staged ${copied.length} file${copied.length === 1 ? '' : 's'} into dist/`);
  } catch (e) {
    console.error('stage-static: ' + e.message);
    process.exit(1);
  }
}

module.exports = { stage, COPIES, DIST };
