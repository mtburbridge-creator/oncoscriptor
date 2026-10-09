# Slide Background Studio

A single self-contained HTML tool that generates animated/static **SVG backgrounds**
for HTML slide decks, and (Collate tab) bakes images into a standalone deck. No build
step, no dependencies — works fully offline by double-clicking, and deploys as a static
file.

It lives inside OncoGenik now. `tools/build-deck.js` at the repo root drives this same
file headlessly to produce each project's `deck.html`; see `docs/DECK_TOOL.md`.

## Files

- **`index.html`** — the app, and the only copy in git. Double-click to run locally
  (`file://`); the deploy and the deck tool both read this exact file.
- **`tests/`** — `deploy-config.js` (layout guard) and `collate.spec.js` (headless
  Collate-tab suite) with `fixtures.js` generating its images at runtime.
- **`docs/COLLATE_TAB_PLAN.md`** — the plan the Collate tab was built from.

There is no second copy to keep in sync any more. `background generator.html`,
`backgenapp/index.html` and the Studio's own `vercel.json` were removed when the Studio
moved into this repo; `tests/deploy-config.js` fails if any of them comes back.

## What it does

Three stacked layers, each with live controls:

1. **Low-poly grid** — seeded grid + jitter, Bowyer–Watson Delaunay triangulation,
   multi-stop gradient fill, edge/hairline control.
2. **Blob scene** — Catmull-Rom → cubic Bézier blobs; count / complexity / wobble + colors.
3. **Mouse light** — cursor-tracking radial highlight with a CSS blend mode.

Compositing offers a top-layer selector, all 16 CSS blend modes, and an opacity slider.
**"Copy full slide HTML"** exports a zero-dependency `<div>` snippet (with an inline
mouse-light tracking script) to paste straight into your slides. **"Copy settings"** /
**"Load settings…"** round-trip every control as JSON; OncoGenik keeps the house look in
`guidelines/slideshow.settings.json`.

The **Collate** tab takes images, orders them (blank, images by natural filename order,
blank, then reorder freely), and downloads a single `slide-deck.html` with the images
baked in as data URIs over the chosen background.

## Deployment

The Studio is deployed as part of OncoGenik, on the same Vercel project as the rest of
the app, at **`/backgenapp`**. The public URL stays <https://markburbridge.com/backgenapp>;
that site's proxy only needs repointing at the OncoGenik deployment.

How the path is served, all from the repo root:

- `vercel.json` sets `"buildCommand": "node tools/stage-static.js"` and
  `"outputDirectory": "dist"`, with `"framework": null`.
- `tools/stage-static.js` copies `slides/studio/index.html` to `dist/backgenapp/index.html`
  (plus `web/**` and two vendor bundles). Nothing else in the repo is served statically.
- `vercel.json` rewrites `/backgenapp` and `/backgenapp/*` to `/backgenapp/index.html`.
  Rewriting the subpath onto a root document does not work on Vercel (it 404s), which is
  why the build places a physical file at that path.
- `/backgenapp` is the one public route in OncoGenik: the Studio holds no secrets and
  writes nothing, so the login middleware leaves it alone.

Keeping the app off the raw `*.vercel.app` domain is still **open**. A host-conditional
redirect in `vercel.json` does not work: the proxy forwards the upstream host, so the
redirect matches the proxy's own fetch and loops. It needs Vercel's Deployment Protection
on the production alias (a dashboard setting), or a shared secret header the proxy sends.

## Tests

Run from the OncoGenik repo root. Chromium is at `/opt/pw-browsers/chromium` in the
build environment; set `CHROMIUM_PATH` if yours is elsewhere.

```bash
node slides/studio/tests/deploy-config.js                       # layout + vercel.json guard (fast, no browser)
PLAYWRIGHT_PATH=playwright-core node slides/studio/tests/collate.spec.js   # 20 headless Collate-tab checks
```

`collate.spec.js` requires the Playwright module named by `PLAYWRIGHT_PATH` (default
`playwright`); this repo installs `playwright-core`, hence the variable. It generates its
own image fixtures at runtime, so no binaries are committed. The deck tool's own suite is
`node tools/test-deck.js`.

## Editing the app

The script is ES5 inside one IIFE by design (the plan's file-hygiene rule: no `let`,
`const`, arrow functions or template literals). After an edit, run the two tests above and
`node tools/test-deck.js`; the deck tool depends on these ids and classes staying put:
`#loadSettingsBtn` (and its `window.prompt`), `#tabCollateBtn`, `#fileInput`,
`#slideStrip .slideCard[data-id]` with `.cardName`, `.cardLeft`, `.blank`, `.loading`,
`#uploadErrs`, `#collateDownloadBtn`, `#errBox`.
