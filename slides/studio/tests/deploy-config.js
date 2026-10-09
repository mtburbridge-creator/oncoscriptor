/*
 * Deploy-config guard.
 *
 * The Studio ships as one self-contained HTML file. In its old repo it had to
 * be committed three times (root, "background generator.html", backgenapp/)
 * and the copies drifted: backgenapp/index.html served a months-old build to
 * markburbridge.com. In OncoGenik there is exactly one copy in git,
 * slides/studio/index.html, and the Vercel build (tools/stage-static.js)
 * copies it to dist/backgenapp/index.html, which the root vercel.json rewrites
 * /backgenapp onto. These checks fail loudly if any of that regresses.
 *
 *   node slides/studio/tests/deploy-config.js      (fast, no browser)
 */
const fs = require('fs'), path = require('path');
const STUDIO = path.resolve(__dirname, '..');
const REPO = path.resolve(STUDIO, '..', '..');
const rel = p => path.relative(REPO, p);

let fail = 0;
const ok = m => console.log('ok: ' + m);
const bad = m => { console.log('FAIL: ' + m); fail = 1; };
const isApp = buf => buf.includes('Slide Background Studio') && buf.includes('id="polySvg"');

// 1. Exactly one copy of the app in git: slides/studio/index.html.
const canonicalPath = path.join(STUDIO, 'index.html');
if (!fs.existsSync(canonicalPath)) bad('slides/studio/index.html is missing');
else if (!isApp(fs.readFileSync(canonicalPath))) bad('slides/studio/index.html does not look like the Studio');
else ok('slides/studio/index.html is the Studio');

const copies = [];
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(\.git|node_modules|dist|tests|docs)$/.test(e.name)) walk(abs); }
    else if (e.name.endsWith('.html') && abs !== canonicalPath && isApp(fs.readFileSync(abs))) copies.push(rel(abs));
  });
})(STUDIO);
if (copies.length) bad('committed duplicate(s) of the app, which can drift: ' + copies.join(', '));
else ok('no duplicate copies of the app under slides/studio');

['background generator.html', 'backgenapp', 'vercel.json'].forEach(n => {
  if (fs.existsSync(path.join(STUDIO, n))) bad(`slides/studio/${n} still exists — the Studio is deployed from the root vercel.json now`);
});

// 2. Root vercel.json: build copies the Studio into dist/, and /backgenapp
//    rewrites onto that copy.
const cfgPath = path.join(REPO, 'vercel.json');
let cfg = null;
if (!fs.existsSync(cfgPath)) bad('root vercel.json is missing');
else {
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { bad('root vercel.json is not valid JSON: ' + e.message); }
}
if (cfg) {
  if (cfg.buildCommand === 'node tools/stage-static.js') ok('buildCommand runs tools/stage-static.js');
  else bad('buildCommand should be "node tools/stage-static.js", got ' + JSON.stringify(cfg.buildCommand));
  if (cfg.outputDirectory === 'dist') ok('outputDirectory is dist');
  else bad('outputDirectory should be "dist", got ' + JSON.stringify(cfg.outputDirectory));
  if (cfg.framework === null) ok('framework is null (Other)');
  else bad('framework should be null so Vercel does not guess a preset, got ' + JSON.stringify(cfg.framework));

  const rewrites = cfg.rewrites || [];
  const want = { '/backgenapp': '/backgenapp/index.html', '/backgenapp/:path*': '/backgenapp/index.html' };
  Object.keys(want).forEach(src => {
    const r = rewrites.find(x => x.source === src);
    if (!r) bad(`no rewrite for ${src} — the markburbridge.com proxy would 404`);
    else if (r.destination !== want[src]) bad(`rewrite ${src} -> ${r.destination}, want ${want[src]}`);
    else ok(`rewrite ${src} -> ${r.destination}`);
  });
}

// 3. The build script really stages the Studio at backgenapp/index.html.
const stagePath = path.join(REPO, 'tools', 'stage-static.js');
if (!fs.existsSync(stagePath)) bad('tools/stage-static.js is missing');
else {
  const stage = require(stagePath);
  const copy = (stage.COPIES || []).find(c => c.to === 'backgenapp/index.html');
  if (!copy) bad('tools/stage-static.js does not copy anything to backgenapp/index.html');
  else if (copy.from !== 'slides/studio/index.html') bad(`tools/stage-static.js stages backgenapp/index.html from ${copy.from}, not slides/studio/index.html`);
  else ok('tools/stage-static.js copies slides/studio/index.html -> dist/backgenapp/index.html');
}

// 4. If a build output is lying around, it must match the canonical file, or a
//    stale build is about to be deployed.
const staged = path.join(REPO, 'dist', 'backgenapp', 'index.html');
if (fs.existsSync(staged) && fs.existsSync(canonicalPath)) {
  if (fs.readFileSync(staged).equals(fs.readFileSync(canonicalPath))) ok('dist/backgenapp/index.html matches slides/studio/index.html');
  else bad('dist/backgenapp/index.html is stale — rerun node tools/stage-static.js');
}

process.exit(fail);
