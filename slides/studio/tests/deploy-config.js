/*
 * Deploy-config guard.
 *
 * The app ships as a self-contained HTML file, so it is easy to leave a second
 * copy behind and serve a stale build — which is exactly what happened when
 * backgenapp/index.html kept serving a July build to markburbridge.com long
 * after index.html had moved on. These checks fail loudly if that recurs.
 *
 *   node tests/deploy-config.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p));

let fail = 0;
const ok = m => console.log('ok: ' + m);
const bad = m => { console.log('FAIL: ' + m); fail = 1; };

const cfg = JSON.parse(read('vercel.json'));

// 1. Every rewrite/redirect destination that is a local path must exist.
(cfg.rewrites || []).forEach(r => {
  if (!/^https?:/.test(r.destination)) {
    const dest = r.destination.split('?')[0].replace(/^\//, '');
    if (fs.existsSync(path.join(ROOT, dest))) ok(`rewrite ${r.source} -> ${r.destination} exists`);
    else bad(`rewrite ${r.source} -> ${r.destination} points at a missing file`);
  }
});

// 2. The canonical subpath must resolve to the same file the root serves, so
//    the proxied URL can never lag behind the root one.
// Vercel will not rewrite the subpath onto the root document (tried: it 404s),
//    so a physical file has to live at backgenapp/index.html. Check 3 below is
//    what keeps that file from drifting out of date the way it did before.
const sub = (cfg.rewrites || []).find(r => r.source === '/backgenapp');
if (!sub) bad('no rewrite for /backgenapp — the markburbridge.com proxy would 404');
else if (!fs.existsSync(path.join(ROOT, sub.destination.replace(/^\//, ''))))
  bad(`/backgenapp resolves to ${sub.destination}, which does not exist — the proxy would 404`);
else ok(`/backgenapp resolves to ${sub.destination}`);

// 3. No second copy of the app may differ from index.html.
const canonical = read('index.html');
const copies = [];
(function walk(dir) {
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(e => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(\.git|node_modules|tests|docs)$/.test(e.name)) walk(rel); }
    else if (e.name.endsWith('.html')) copies.push(rel);
  });
})('.');
copies.map(c => c.replace(/^\.\//, '')).forEach(rel => {
  if (rel === 'index.html') return;
  const buf = read(rel);
  // A file that is clearly the app (not a showcase page) must match exactly.
  if (buf.includes('Slide Background Studio') && buf.includes('id="polySvg"')) {
    if (buf.equals(canonical)) ok(`${rel} is in sync with index.html`);
    else bad(`${rel} is a stale copy of the app — it differs from index.html`);
  }
});

process.exit(fail);
