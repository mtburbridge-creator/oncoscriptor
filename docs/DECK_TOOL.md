# The deck tool and the Studio deployment

How `projects/<slug>/slides/deck.html` gets built, how to run and test the tool, and how
Slide Background Studio reaches `/backgenapp`. Background in `ENGINE_DESIGN.md`, sections
"Slides" and "The UI".

## How the deck tool works

`tools/build-deck.js` does not fork the Studio. It opens the one canonical app file,
`slides/studio/index.html`, in headless Chromium through `playwright-core` and uses the
app the way a person would:

1. **Boot.** `file://…/slides/studio/index.html` is loaded and the tool waits for the
   background to render (`#polySvg` populated).
2. **Settings.** It clicks the Design tab's **Load settings…** button. The app asks for
   JSON with `window.prompt`; Playwright answers the dialog with the contents of
   `guidelines/slideshow.settings.json` (`page.on('dialog', d => d.accept(json))`), the
   same JSON the **Copy settings** button exports. The tool then confirms the error box
   stayed closed and that exact-valued controls (base colour, aspect) took the new value.
   If the settings file is missing the tool says so and the Studio defaults are used.
3. **Images.** It switches to the Collate tab and hands the image files to `#fileInput`
   with `setInputFiles`, then waits until no card is still decoding
   (`.slideCard.loading`), the image-card count matches, and the download button is
   enabled. Anything the Studio rejected (`#uploadErrs`) is a hard failure.
4. **Order.** The Collate tab always lays a fresh upload out as *blank, images in natural
   filename order, blank*. `order.json` is a chosen order, not a filename order, so the
   tool reorders through the UI: for each target slot it clicks that card's **‹** (move
   left) button until the card sits there, a selection sort over the strip. Moving a card
   marks the strip "user ordered" in the app, which leaves both blanks where they are. The
   tool then reads the strip back and refuses to continue unless it is exactly
   `blank, <order.json images>, blank`. Filenames must be unique within a deck.
5. **Export.** It clicks **Download deck (.html)**, the same button a person uses, and
   captures the download with `page.waitForEvent('download')` → `saveAs`. As a fallback
   it also keeps a handle on the `text/html` Blob the app creates (the trick
   `slides/studio/tests/collate.spec.js` uses) and writes that if no download event
   arrives. Any `pageerror` during the run fails the build.

It prints the slide count (images + 2 blanks) and the byte size, and exits non-zero with
a one-line reason for every missing or invalid input.

## Running it

```bash
# A project: reads projects/<slug>/slides/order.json and projects/<slug>/images/generated/<id>.png
node tools/build-deck.js <slug>
node tools/build-deck.js <slug> --settings guidelines/slideshow.settings.json --out projects/<slug>/slides/deck.html

# Explicit files, in deck order, bypassing a project (used by the tests)
node tools/build-deck.js --images a.png b.png c.png --out deck.html
```

- `order.json` looks like `{"order":["01","05","03"]}`. For each id the tool takes
  `<id>.png`, or `<id>.jpg` / `.jpeg` / `.webp` when the PNG is absent.
- `--settings` defaults to `guidelines/slideshow.settings.json`; `--out` defaults to
  `projects/<slug>/slides/deck.html` (or `./deck.html` with `--images`).
- Chromium is `/opt/pw-browsers/chromium` by default; override with `CHROMIUM_PATH`.
  Never run `playwright install`; the browser is already in the environment.
- `npm run deck -- <slug>` is the same command.

Changing the house look is a Studio job: adjust the Design tab, **Copy settings**, paste
the JSON into `guidelines/slideshow.settings.json`. Every later deck follows.

### What the tool depends on in the Studio

No Studio code was changed for the deck tool. It drives these ids and classes, so an
edit to the app that renames them must update `tools/build-deck.js` too:
`#loadSettingsBtn` and its `window.prompt`, `#errBox`, `#tabCollateBtn`, `#viewCollate`,
`#fileInput`, `#slideStrip .slideCard[data-id]` with `.cardName`, `.cardLeft`, `.blank`
and `.loading`, `#uploadErrs`, `#collateDownloadBtn`, and the `alt` text it derives from
filenames.

## Testing

All from the repo root. Chromium at `/opt/pw-browsers/chromium` (or `CHROMIUM_PATH`).

```bash
node tools/test-deck.js                                   # deck tool, ~10 s
node slides/studio/tests/deploy-config.js                 # Studio layout guard, no browser
PLAYWRIGHT_PATH=playwright-core node slides/studio/tests/collate.spec.js   # 20 Collate checks, ~1 min
node tools/stage-static.js                                # the Vercel build, check dist/
```

`tools/test-deck.js` draws three PNGs with a Chromium canvas (nothing binary is
committed), builds a deck from them in an order natural sorting would not produce
(`c, a, b`), then opens the deck in a second headless page and checks five `<section>`s
(blank + 3 + blank), that the three image sections carry `img-slide` with an `<img>`
whose `src` starts with `data:image`, that the images are in the requested order, and
that the deck logs no page errors. It also checks that settings change the baked
background, the CLI output, the missing-settings fallback, `order.json` resolution with
the `.jpg` fallback, and the non-zero exit on a missing project.

`collate.spec.js` requires the module named by `PLAYWRIGHT_PATH` (default `playwright`);
this repo installs `playwright-core`, hence the variable.

## Studio deployment path

One copy of the Studio lives in git: `slides/studio/index.html`. The old repo's
three-copy rule (`background generator.html`, `backgenapp/index.html`) and the Studio's
own `vercel.json` are gone; `slides/studio/tests/deploy-config.js` fails if they return.

The root `vercel.json`:

```json
{
  "buildCommand": "node tools/stage-static.js",
  "outputDirectory": "dist",
  "framework": null,
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    { "source": "/backgenapp", "destination": "/backgenapp/index.html" },
    { "source": "/backgenapp/:path*", "destination": "/backgenapp/index.html" }
  ]
}
```

`tools/stage-static.js` (the build command) rebuilds `dist/` from scratch:

| Destination | Source |
|---|---|
| `dist/**` | `web/**` (the OncoGenik UI; an absent `web/` is treated as empty) |
| `dist/backgenapp/index.html` | `slides/studio/index.html` |
| `dist/vendor/simplewebauthn-browser.js` | `node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js` |
| `dist/vendor/marked.min.js` | `node_modules/marked/lib/marked.umd.js` (marked's `browser` entry) |

Nothing else is copied, so `projects/`, `ideas/`, `guidelines/` and the rest of the repo
are never served statically. The rewrites put the Studio at `/backgenapp`, where the
markburbridge.com proxy expects it. Vercel will not rewrite a subpath onto a root
document (it 404s), so the build stages a physical file at that path instead of
committing one.

### Serverless functions next to a custom output directory

Checked against the Vercel docs on 2026-10-09:

- The functions docs put the "no framework" case in a root-level `api/` directory:
  `api/hello.js` is shown with `framework=other`, and the Node.js runtime page says
  "create a file inside the `/api` directory … No additional configuration is needed"
  ([Functions](https://vercel.com/docs/functions),
  [Quickstart](https://vercel.com/docs/functions/quickstart),
  [Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js)).
- `framework: null` is exactly how `vercel.json` selects the "Other" preset: "To select
  'Other' as the Framework Preset, use `null`"
  ([vercel.json reference](https://vercel.com/docs/project-configuration/vercel-json)).
- `outputDirectory` governs only static serving: "Only the contents of this Output
  Directory will be served statically by Vercel", and the build settings page refers to
  "the natively supported `api` directory" as separate from the framework build
  ([Configuring a build](https://vercel.com/docs/builds/configure-a-build)).
- `cleanUrls: true` also applies to functions ("a Vercel Function named `api/user.go`
  will be served when visiting `/api/user`"), which is the extensionless `/api/<name>`
  routing the UI wants anyway.

So root `api/` Node functions, `framework: null` and `outputDirectory: "dist"` are the
documented combination for a static site plus an API. One caveat worth knowing: a few
community threads report `api/` functions not being found when a framework preset's own
build was expected to emit them into the output directory
([example](https://github.com/objectstack-ai/objectstack/issues/1003)). That is the
framework-build path, not ours: with `framework: null` the `api/` directory is compiled
by Vercel itself from the repo root, independently of `dist/`. If it ever does not, the
dashboard's Framework Preset should also read "Other" (a dashboard value can disagree
with `vercel.json`), and `vercel dev` reproduces the routing locally.

### Still open

Keeping the Studio off the raw `*.vercel.app` hostname. A host-conditional redirect loops
through the proxy; it needs Deployment Protection on the production alias or a shared
secret header from the proxy. Unchanged from the old repo.
