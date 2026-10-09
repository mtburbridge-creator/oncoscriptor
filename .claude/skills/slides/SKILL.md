---
name: slides
description: Task slides.build. Build projects/<slug>/slides/deck.html from the owner's slides/order.json by running tools/build-deck.js. Argument is the project slug.
---

# slides

Argument: `<slug>`. Project dir is `projects/<slug>/`. Task name is `slides.build`.

## Ground rules

- You do not design slides here; `tools/build-deck.js` drives Slide Background Studio with `guidelines/slideshow.settings.json` and the approved images. Do not edit the Studio, the tool, or the settings file.
- No patient data. The only file this task produces is `slides/deck.html`, written by the tool.

## Inputs

- `projects/<slug>/slides/order.json`: `{ "order": ["03", "01", "07"], "updated": "..." }`, the owner's picked images in order.
- `projects/<slug>/images/generated/<id>.png` for each id in the order.
- `projects/<slug>/images/decisions.json`: every id in the order must be `approve`.
- `guidelines/slideshow.settings.json`: the deck look.

## Steps

1. Read `project.json`. Confirm `tasks["slides.build"].status` is `todo` and the phase is `slides`.
2. `node tools/project.js start <slug> slides.build`
3. Pre-check the inputs so failures are specific:
   ```
   node -e 'const s="<slug>";const fs=require("fs");const o=require("./projects/"+s+"/slides/order.json").order;const d=require("./projects/"+s+"/images/decisions.json").decisions;for(const id of o){if(!fs.existsSync("projects/"+s+"/images/generated/"+id+".png"))throw"missing png "+id;if(!d[id]||d[id].decision!=="approve")throw"not approved "+id}console.log("ok",o.length,"slides")'
   ```
4. Build the deck:
   ```
   node tools/build-deck.js <slug>
   ```
   The tool opens `slides/studio/index.html` headlessly, applies the settings file, loads the images in order, exports through the Studio's Collate path, and writes `projects/<slug>/slides/deck.html`.
5. Confirm `projects/<slug>/slides/deck.html` exists, is non-empty, and contains one slide per id in the order (`grep -o '<section' deck.html | wc -l` must equal the order length plus two blanks; `grep -c` counts lines, not matches).
6. `node tools/project.js done <slug> slides.build` (the project moves to `package`).

## Quality bar

- `deck.html` is a single self-contained file, opens without network access, and shows the approved images in the owner's order on the Studio background.
- Nothing else in the project changed.

## When something is missing or the tool fails

- `order.json` missing or empty: `node tools/project.js fail <slug> slides.build "slides/order.json missing; set a slide order in the UI"`.
- A PNG missing or an id not approved: fail with that exact message from the pre-check.
- `tools/build-deck.js` missing, throws, or exits non-zero: capture the last lines of its output and `node tools/project.js fail <slug> slides.build "build-deck: <error text>"`. Do not try to assemble the deck by hand.
- Playwright or Chromium unavailable: fail with "build-deck: browser unavailable" so the owner can install it (`npx playwright install chromium`).
