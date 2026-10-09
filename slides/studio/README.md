# Slide Background Studio

A single self-contained HTML tool that generates animated/static **SVG backgrounds**
for HTML slide decks. No build step, no dependencies — works fully offline by
double-clicking, and deploys to any static host.

## Files

- **`background generator.html`** — the canonical deliverable. Double-click to run locally (`file://`).
- **`index.html`** — identical copy that serves as the web entry point (e.g. on Vercel),
  since the canonical filename contains a space.

## What it does

Three stacked layers, each with live controls:

1. **Low-poly grid** — seeded grid + jitter, Bowyer–Watson Delaunay triangulation,
   multi-stop gradient fill, edge/hairline control.
2. **Blob scene** — Catmull-Rom → cubic Bézier blobs; count / complexity / wobble + colors.
3. **Mouse light** — cursor-tracking radial highlight with a CSS blend mode.

Compositing offers a top-layer selector, all 16 CSS blend modes, and an opacity slider.
**"Copy full slide HTML"** exports a zero-dependency `<div>` snippet (with an inline
mouse-light tracking script) to paste straight into your slides.

## Deploy to Vercel

This is a static site (framework preset: **Other**). To deploy as **`backgenapp`**:

### Option A — Vercel dashboard (recommended)
1. Go to <https://vercel.com/new> and **Import** `mtburbridge-creator/background-generator`.
2. Set the **Project Name** to `backgenapp`.
3. **Framework Preset:** Other · **Build Command:** none · **Output Directory:** `.` (root).
4. Click **Deploy**. The app is served from `index.html` at the project root.

### Option B — Vercel CLI
```bash
npm i -g vercel
vercel login
vercel --prod --name backgenapp   # run from the repo root
```

Every push to `main` redeploys automatically once the GitHub repo is linked.

### Canonical URL

The app is public at **<https://markburbridge.com/backgenapp>** and that is the only
URL it should be read at. `vercel.json` handles both halves of this:

- `/backgenapp` and `/backgenapp/*` **rewrite to `backgenapp/index.html`**, which is a
  byte-identical copy of `index.html`. Rewriting the subpath onto the root document
  instead (`destination: "/index.html"`) was tried and **404s** — Vercel will not serve
  the root file from that subpath — so the physical copy is required.
- That copy is therefore a **third file to keep in sync**, and it is what broke:
  it silently served a months-old build to the proxy long after `index.html` had moved
  on. `tests/deploy-config.js` now fails if it ever drifts again.

Keeping the app off the raw `backgenapp.vercel.app` domain is still **open**. A
host-conditional redirect in `vercel.json` does not work: the proxy forwards the
`backgenapp.vercel.app` host upstream, so the redirect matches the proxy's own fetch and
sends `markburbridge.com/backgenapp` into a loop. It needs Vercel's Deployment Protection
on the production alias (a dashboard setting), or a shared secret header the proxy sends.

## Tests

```bash
node tests/deploy-config.js   # no duplicate app copies, rewrites resolve (fast, no browser)
node tests/collate.spec.js    # 20 headless Collate-tab checks (needs Playwright + Chromium)
```

`tests/collate.spec.js` generates its own image fixtures at runtime, so no binaries are
committed. Set `PLAYWRIGHT_PATH` / `CHROMIUM_PATH` if they are not on the default paths.

## Keeping the copies in sync

`index.html` and `background generator.html` are byte-identical by rule. After editing
one, copy it over the other and confirm:

```bash
cp index.html "background generator.html"
cp index.html backgenapp/index.html
node tests/deploy-config.js
```

All three must match: `index.html` (root URL), `background generator.html` (local
double-click), and `backgenapp/index.html` (the markburbridge.com proxy path).
