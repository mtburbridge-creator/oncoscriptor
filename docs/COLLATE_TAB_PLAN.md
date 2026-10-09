# Slide Background Studio — "Collate" Tab Implementation Plan

## 1. Goal & context

**What is being built.** A second tab ("Collate") in Slide Background Studio — the single-file, zero-dependency HTML tool at `/home/user/background-generator/index.html` (1663 lines, vanilla ES5-style JS + inline SVG, no build step). The Collate tab lets the user: (1) preview the slide background produced by the current settings on the first tab; (2) upload images via file picker AND drag-and-drop; (3) choose slide order, including inserting blank slides, defaulting to `blank + [images in natural filename order: 1, 2, 3, 3a, 4, 10 …] + blank`; (4) download a baked, self-contained deck HTML in which images float on rounded cards with soft shadows and the deck's existing smooth one-slide-per-gesture navigation — exactly matching a hand-modified reference deck the user produced from this app's own generator.

**The reference deck's role.** The user hand-modified a generated 10-slide deck (3.7 MB, 8 baked JPEG slides + leading/trailing blanks). Analysis established that it differs from *current* stock generator output in three ways. The first two are what this feature reproduces automatically:

1. Three CSS rules appended to the deck's `<style>` after the `@media (max-width:760px)` rule (copy **verbatim**, no "improvements"):

```css
.slide.img-slide{padding:0}
.img-frame{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.img-frame img{max-width:80vw;max-height:80vh;width:auto;height:auto;object-fit:contain;display:block;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
```

2. The 10 `<section>` bodies replaced with: `<section class="slide"></section>` (blank), then 8 × `<section class="slide img-slide"><div class="img-frame"><img src="data:image/jpeg;base64,..." alt="meaningful description"></div></section>`, then a trailing blank.

3. **A known, inert third delta — do NOT act on it:** commit `8634fa5` ("Deck: drop slide numbering") removed the `.ticker` rule from `DECK_CSS`, but the reference deck predates that and still contains `.ticker{position:absolute;top:6vh;right:7vw;…}` between `.slide` and `.scrim`. No ticker elements exist in the reference body, so the rule is dead. New output correctly omits it; an implementer diffing generated output against the reference must not chase this delta or "fix" it by re-adding `.ticker`.

Everything else — the baked SVG world, `sbsStart` runtime, the smooth-scroll controller, config — is untouched stock output. **"Smooth transitions" means the deck's existing DECK_RUNTIME + DECK_CONTROLLER smooth-scroll engine, reused unchanged (except N parameterization). "Rounded edges" means `border-radius:14px` + that exact shadow on the `<img>`. No new transition code is needed.**

**Repo facts (verified).**
- Single file: all CSS lives in the one head `<style>` (lines 7–93); all JS in one `"use strict"` IIFE `<script>` (lines 453–1661).
- **Sync rule:** `background generator.html` (note the space in the filename) is a byte-identical copy. Every edit to `index.html` must end with `cp index.html "background generator.html"` and be verified with `cmp index.html "background generator.html"`.
- Current branch: `claude/beautiful-fermat-2dsea5` (HEAD `8634fa5`), remote `mtburbridge-creator/background-generator`, believed to carry **open PR #12**. Commit and push onto this existing branch; **do not open a new PR**, even if PR #12 cannot be verified from inside the environment — the existing PR (or the user) will carry the feature.
- All line references in this plan are against the current 1663-line file.

**Style discipline (hard rules).**
- ES5 *syntax* only: `var`, function declarations, string concatenation. Banned: arrow functions, template literals, `let`/`const`, classes, destructuring. One violation kills the whole app at parse time (single script). Modern *APIs* are fine and already in use: `forEach`, `map`, `Object.assign`, `Blob`, `URL.createObjectURL`, rAF; new code may use `FileReader`, `canvas.toDataURL`, `localeCompare(…, {numeric:true})`, drag/drop events.
- Every new event handler is wrapped in the existing `guard()` (lines 470–475) so failures log to `#errBox`.
- Any **closing** `</script>` tag emitted inside generated HTML strings must use the split-tag convention `"<\/scr"+"ipt>"` (see existing usage at 1449, 1638) — only a literal `</script>` can terminate the host script block, so closing tags are the actual hazard. Raw *opening* `<script>` literals inside strings are harmless and exist in current code (line 1429); do not "fix" them, and do not write greps that flag them.
- New UI reuses the existing vocabulary: CSS vars (`--bg --panel --panel2 --line --text --muted --accent --danger`, lines 8–17), `.group/.ghead/.gbody/.row/.hint/.pill/.pillRow/.btnRow/button.small/button.primary`, `toast()` (481–485), the Blob→`<a download>` pattern (1645–1655).

---

## 2. User-visible behavior spec

### 2.1 Tab bar

Two tabs: **"Design"** (the existing screen) and **"Collate"** (new). A full-width strip `#tabBar` is inserted as the first child of `<body>`, above `.app` — NOT inside `.stageHead`, because Collate replaces the entire `.app` (stage *and* panel):

```html
<div id="tabBar">
  <span class="tabBrand">Slide Background Studio</span>
  <div class="tabPills">
    <button class="tabBtn active" id="tabDesignBtn">Design</button>
    <button class="tabBtn" id="tabCollateBtn">Collate</button>
  </div>
</div>
```

- `.tabBtn` reuses `.pill` styling scaled up (padding 7px 18px, font-size 13px); `.tabBtn.active` gets the `.pill.active` accent treatment. Bar: background `--panel`, bottom border 1px `--line`, padding 8px 18px. `.tabBrand`: 13px `--muted`.
- The existing `<h1>Slide Background Studio</h1>` (line 101) becomes `<h1>Design</h1>`; its `.sub` tagline stays. The brand name now lives in `.tabBrand`.
- **Both views live permanently in the DOM.** The existing `.app` gets `id="viewDesign"`; a sibling `<div class="app hidden" id="viewCollate">` holds the new view. Switching toggles a new `.app.hidden{display:none}` class and `.active` on the tab buttons. Nothing is re-rendered or destroyed on switch — inputs, slide list, in-flight decodes all survive.
- On entering Collate, one cheap sync runs (`syncCollatePreview()`, §3.4): regenerate the background snapshot only if a serialized-settings hash changed since last visit; also stop the Design tab's drift/orb rAF loops. **Stopping mechanism (there is no existing cancel path — `driftRAF`/`orbRAF` are only double-start guards, and the loops self-terminate solely via their state predicates at lines 928/944):** add a module-level `collateActive` boolean and add `|| collateActive` to the bail condition inside both `step()` functions in `startDrift`/`startOrbDrift`; on bail the loop nulls its handle and exits on the next frame. On returning to Design, call `safeRender()` to restart whichever loops the current state wants. (If `cancelAnimationFrame` is used instead, note that `rAF` at line 921 may be the `setTimeout` fallback, so the cancel call must match — the flag approach avoids this entirely and is preferred.)
- Tab buttons are real `<button>`s (keyboard-native); add `role="tab"`/`aria-selected` if trivial.
- App always boots on Design; no routing/deep links.

### 2.2 Design tab changes (the "Slide deck" group, lines 431–446)

**Decision: deck download moves to Collate.** The Design group is slimmed to:
- `<button class="primary" id="gotoCollateBtn">Assemble deck in Collate →</button>` — same handler as `#tabCollateBtn`.
- `#deckSnippetBtn` ("Copy deck snippet") **stays on Design** — it emits background-only plumbing for people pasting behind their own slides. It now builds with N = current Collate slide count (see §3.5), and its hint drops every hard-coded "10".
- Revised hint: "Deck building moved to the Collate tab — add images, set the order, download. 'Copy deck snippet' still gives just the background <div> + script to paste behind your own full-screen slides (sized to your current Collate slide count)."
- `#deckDownloadBtn` and `deckSlides()` (the lorem sample slides, 1572–1593) are **removed** — with the download in Collate, a blank-only deck (the default two blanks) covers the old "sample deck" use case.

### 2.3 Collate view layout

`#viewCollate` mirrors the two-column `.app` layout: left `.stage`, right `.panel` (340px, unchanged width).

**Left column, top to bottom:**

a) `.stageHead`: `<h1>Collate</h1>`, `.sub`: "Order your images over the live background, then bake everything into one seamless deck."

b) **Slide preview** `#collateBox` — styled like `.canvasBox` (radius 10px, 1px `--line` border, overflow hidden), **aspect-ratio locked 16:9 always** (the deck bakes 1920×1080 regardless of `state.aspect`). Stacked absolutely inside:
   - `#colBgBase` and `#colBgTop` — two `<img>` elements holding **static SVG snapshots** of the tab-1 background (data-URI-encoded SVG strings, §3.4). NOT live SVG copies (duplicate gradient/filter ids would poison paint document-wide) and NOT animated (no second rAF loop).
   - `#colSlideOverlay` — full-cover flex-centered div showing the *selected* slide: for an image slide, `<img class="colOverlayImg">` (max-width 80%, max-height 80%, `object-fit:contain`, border-radius 8px, box-shadow `0 12px 32px rgba(0,0,0,.5)` — a scaled replica of the deck's card look); empty for a blank slide. Overlay `src` = the item's full `dataURL` when `bytes < 1500000`, else its `thumbURL`.
   - `#colAspectNote` — bottom-left chip, 11px muted, shown only when `state.aspect !== "16:9"`: "Deck bakes at 16:9 (1920×1080) — preview shown at deck aspect."

c) `#colPreviewLabel` — one line, 12px `--muted`, tabular-nums: "Slide 3 of 12 — DSC_0031.jpg" / "Slide 1 of 12 — blank".

d) **Ordering strip** (§2.5), full stage width.

e) `#colErrChip` — small footer chip, shown only when `#errBox` has entries: "⚠ errors logged — see Design tab".

**Right panel** — three groups: "Add images" (§2.4), "Selected slide" (§2.6), "Deck" (§2.7).

### 2.4 "Add images" group

- `#dropZone` — 88px rounded box, 1.5px **dashed** `--line` border, background `--bg`, radius 10px, flex-centered, cursor pointer. Line 1 (13px `--text`): "Drop images here"; line 2 (11px `--muted`): "or click to choose — JPG, PNG, WebP, GIF". Clicking anywhere in the zone opens the picker.
- `<input type="file" id="fileInput" multiple accept="image/jpeg,image/png,image/webp,image/gif" hidden>` plus an explicit `.btnRow` button `#filePickBtn` "Choose images…".
- Drag states: `dragover` with files adds `.dragOver` (`--accent` border, `rgba(110,168,254,0.08)` background, text "Drop to add") on `#dropZone` **and** on `#slideStrip` — dropping on the strip also adds files. A body-level `dragover` listener adds `.dragHint` (pulsing accent border) to `#dropZone` whenever files enter the window. Use an enter/leave counter (or `relatedTarget` containment) to prevent highlight flicker over children.
- **Document-level `dragover` + `drop` handlers calling `preventDefault()` unconditionally, registered at boot** — otherwise a missed drop navigates the browser to the image and destroys all work. Non-negotiable.
- Quality row: label "Bake quality", `.pillRow` `#qualityPills` with pills `data-q="orig|high|med"`: Original / **High (default)** / Medium. High = longest edge ≤2560px, JPEG q0.82; Medium = ≤1600px, q0.72; Original = untouched bytes. **Decision — SUPERSEDED BY §9.2: quality applies to every image, including ones already added.** Changing it re-encodes the existing images from their retained originals (`reprocessAll()`, §9.2). The hint says so.
- `#uploadErrs` — hidden-by-default per-file failure list (danger border, 11px mono): e.g. "IMG_0042.HEIC — HEIC not supported — export as JPEG from Photos first", with `#uploadErrsClear` "Dismiss". Failures never block other files in the batch.
- `.hint`: "Images are baked into the deck as data URIs, so the file is fully self-contained — your work isn't saved anywhere until you download the deck. Quality applies to every image, including ones already added — switching re-encodes them from the originals. 'High' keeps things crisp at 1080p without ballooning the download. Drop more files any time; they slot in by filename."
- Processing feedback: each incoming file appears in the strip immediately as a `.slideCard.loading` skeleton (shimmering `--panel2` block + filename) at its final sorted position, replaced in place when decoded. No modal, no global spinner.

### 2.5 Ordering strip

Container `#stripWrap` (background `--panel2`, 1px `--line` border, radius 10px, padding 10px) under the preview. Header row: left, 12px semibold "Slide order"; right, `.small` buttons `#addBlankEndBtn` "+ Blank slide" (appends a blank at the end) and `#resetOrderBtn` "Reset order".

`#slideStrip` — horizontal `display:flex`, `overflow-x:auto`, padding 6px 2px, thin scrollbar, vertical wheel also scrolls it.

**Card** (`.slideCard`, ~148px wide, one per slide):
- `.cardThumb` 132×74 (16:9), radius 6px, overflow hidden. Background layer = a shared small raster of the current background (~264×148 data URI drawn once per settings-hash change by `syncCollatePreview()`, set as CSS `background-image` on every thumb). Image layer = `<img class="thumbImg">` — the item's ~192px canvas thumbnail (**never** the full data URI scaled down) — centered, max 80% both axes, radius 3px, small dark shadow: a miniature of the deck's img-frame look.
- `.cardIdx` — top-left chip, 10px tabular-nums on `#0b1020cc`, 1-based slide number, renumbered live on reorder.
- Meta line: `.cardName` (11px, ellipsis-truncated, full name in `title`) + `.cardSize` (10px `--muted`, baked size, e.g. "412 KB").
- Hover/selected/focus-within controls over the thumb: `.cardRemove` ("×" top-right, danger on hover — removes, no confirm, toast "Removed DSC_0031.jpg"), `.cardLeft`/`.cardRight` ("‹"/"›" bottom corners — swap one position; **these buttons are the reorder contract**, keyboard-accessible).
- States: `.selected` (2px `--accent` border; drives `#colSlideOverlay`, `#colPreviewLabel`, and the Selected-slide group), `.dragging` (opacity .4), `.loading` (skeleton).

**Blank card** (`.slideCard.blank`): same chrome; thumb shows only the background raster with a centered "Blank" label (11px `--muted`); `.cardName` reads "blank", no `.cardSize`. Fully movable/removable.

**Insert gaps** (`.insertGap`): 14px flex element between every pair of cards and at both ends; invisible at rest; on hover expands to 26px showing a vertical accent line + "+" chip; **click inserts a blank slide there** (toast "Blank slide inserted"). During drag-reorder the gaps double as drop targets.

**Drag to reorder** (optional polish, buttons are the contract): pointer-based — pointerdown on a card, 5px move threshold, translated clone follows pointer, nearest gap highlights, pointerup drops, Escape cancels. Internal drags must be distinguishable from OS-file drops (pointer events, not HTML5 DnD, so no collision; the strip's file-drop handler checks `e.dataTransfer && e.dataTransfer.files.length`).

**Keyboard:** cards get `tabindex="0"`; ←/→ moves selection, Ctrl/Cmd+←/→ moves the card (same as chips), Delete/Backspace removes, Enter selects for preview. Focus follows a moved card.

**Ordering rules (exact, resolving team contradictions):**
- The list seeds at boot as `[blank, blank]`.
- A boolean `collate.userOrdered` starts `false`. **While false**, every add = strip to image items → concat new batch → sort ALL images with `naturalCompare` on `sortKey` → re-wrap with one leading and one trailing blank. **Once the user drags/swaps anything, inserts or removes any slide, `userOrdered` becomes `true`**; from then on new batches are natural-sorted among themselves only and inserted as a block immediately before the trailing blank (or at the very end if the user deleted it). **Existing entries are never re-sorted after manual intervention.**
- `#resetOrderBtn` restores canonical order — one leading blank + all current images natural-sorted + one trailing blank, extra blanks dropped — and sets `userOrdered = false`. Toast: "Order reset — blank, images by filename, blank". No confirm, no undo.

**Empty state:** when only the two default blanks exist, render `#stripEmpty` between them — dashed placeholder card, 200px: "Your images land here" / "Drop files anywhere on this strip, or use Add images →". First visit shows slide 1 (leading blank) selected; label "Slide 1 of 2 — blank".

### 2.6 "Selected slide" group

- Nothing selected: `.hint` "Click a card in the strip to preview it here and edit its details."
- Image selected: row "File" → `#selFileVal` (filename + "· 412 KB"); row "Alt text" → `<input type="text" id="altInput">`, pre-filled with filename minus extension with `-`/`_` → spaces, live-saved to the item, baked into `<img alt="…">` (attribute-escaped; empty is allowed and emits `alt=""`). `.hint`: "Written into the deck as the image's alt text — screen readers and search engines read it. A short description beats a filename." `.btnRow` `#selRemoveBtn` "Remove slide".
- Blank selected: `#selFileVal` = "Blank slide" + `#selRemoveBtn`; no alt field.

### 2.7 "Deck" group

- Readout rows (label + right-aligned tabular-nums `.val`): "Slides" → `#deckCountVal` ("12 (10 images, 2 blank)"); "Est. size" → `#deckSizeVal` ("≈ 7.4 MB", "—" while processing). Estimate = `1200000 + Σ items[i].dataURL.length` bytes.
- `#deckWarn` — hidden-by-default strip. Coloring/tiers: estimate <15 MB muted (hidden); 15–40 MB amber (`#ffd27a` on `rgba(255,210,122,.08)`): "Heads up — this deck will be ≈ NN MB. It'll work, but big files are slow to open and share. Try 'Medium' quality."; >40 MB danger tint: "This deck will be ≈ NN MB — some browsers and mail clients will choke. Strongly consider 'Medium' quality or fewer images." Info tone when no images: "No images yet — you'll get a deck of blank slides over the background."
- Style-mismatch hint, shown only when `state.style !== "poly"`: "Deck backgrounds currently use the Low-poly style; Orbs/Dots/Lines apply to the single-slide export only."
- `.btnRow`: `<button class="primary" id="collateDownloadBtn">Download deck (.html)</button>`. Disabled only while files are processing (label "Processing images…"); blank-only decks are legal (N=2 default). Filename `slide-deck.html`. Success toast: "Deck downloaded — 12 slides, ≈ 7.4 MB".
- `.hint`: "Bakes your slides into one standalone .html: a continuous 'river' background flowing across every boundary, images floating on rounded cards, gentle per-slide light — no hard lines, nothing to install. Wheel / arrow / space / swipe = one slide."

### 2.8 Toasts and safety

Toasts reuse `#toast`/`toast()`: "Added 6 images", "Added 6 images — 1 file skipped (see Add images)", "Blank slide inserted", "Removed X", "Order reset — …", "Deck downloaded — …". A guard-wrapped `beforeunload` handler fires whenever any image item exists, using the modern contract — `ev.preventDefault(); ev.returnValue = "";` — since returned prompt strings are ignored by current Chrome/Firefox and custom text is never shown. The "your work isn't saved until you download" messaging lives in the UI copy (the §2.4 hint), not in the dialog.

---

## 3. Architecture & data model

### 3.1 Collate state

Declared immediately after `state` (after line 558), sibling to it — never nested; `render()`, `syncControlsFromState()`, `applySettings()` never touch it:

```
var collate = {
  items: [],            // ordered slide list — THE single source of truth; deck N = items.length
  nextId: 1,            // monotonic id counter
  userOrdered: false,   // see §2.5 ordering rules
  quality: "high",      // "orig" | "high" | "med"
  selectedId: null,     // currently selected card's item id
  processing: 0         // count of in-flight decodes (drives busy states)
};
```

Item shape — blanks are real, reorderable entries, never implicit indices:

```
{ kind:"blank", id:7 }
{ kind:"image", id:8,
  name:"photo 3a.jpg",      // original filename verbatim
  sortKey:"photo 3a",       // filename sans final extension — the natural-sort input
  type:"image/jpeg",
  file:File,                // §9.2 — RETAINED original handle (disk-backed, ~0 JS heap); source for re-encodes
  origBytes:3145728,        // file.size — the untouched original's size, for the memory meter
  dataURL:"data:image/jpeg;base64,...",  // FULL processed payload, exactly what gets baked
  bytes:412345,             // dataURL.length
  w:2560, h:1440,
  thumbURL:"data:image/jpeg;base64,...", // ~192px thumbnail for all UI
  alt:"photo 3a" }
```

**Persistence decision: collate state is NOT persisted** in `serializeSettings()` (1115–1130) / `applySettings()` (1131–1151). Settings JSON travels via clipboard/`window.prompt` — multi-MB base64 breaks both; settings are "style", collate is "content". Do not bump the `{v:1}` tag. Leave a code comment noting order-without-images persistence as a possible follow-up.

**Memory rule (amended by §9.2):** each item holds exactly one full-size string (`dataURL`, already at export quality), one thumb, **and the original `File` handle**. A `File` is a disk-backed Blob reference, not bytes on the JS heap, so retaining it costs ~0 memory while making re-encode-at-new-quality possible. The decode-time ObjectURL and `<img>` are still dropped immediately after processing; no second base64 copy of the original is ever kept.

### 3.2 Image ingestion pipeline

Both the picker `change` and every drop funnel into one `addFiles(fileList)` (guard-wrapped). After processing, set `fileInput.value = ""` (same-file reselect fires no `change` otherwise); `files.length === 0` → no-op.

**Validation per file** (`accept` is advisory only; DnD bypasses it):
- Allowlist by MIME `image/(jpeg|png|webp|gif)` OR extension `jpg|jpeg|png|webp|gif` (some files arrive with empty `type`). Reject `image/svg+xml` and `.svg` explicitly (XSS vector when baked into distributable HTML; no reliable raster size). Detect `.heic/.heif` by extension → specific error line ("HEIC not supported — export as JPEG from Photos first"). Everything else (folders, .txt) fails decode → error line. A batch yielding zero valid files toasts "No supported images in that drop".
- Size guardrails: reject files >25 MB (error line); toast-warn but accept >8 MB.

**Placeholder-first, sequential processing** (fixes async-completion scrambling AND concurrent-decode memory spikes): at add time, synchronously create items for the whole valid batch (with ids, `name`, `sortKey`, default `alt`, no payload), insert them at their final sorted positions per §2.5, and render `.loading` skeleton cards. Then process files one at a time via an index-driven `next()` chain — one decoded bitmap alive at any moment. A failed decode removes its placeholder and adds an `#uploadErrs` line; the chain continues.

**Per-file steps:**
1. `var url = URL.createObjectURL(file); var img = new Image(); img.onload/onerror; img.src = url;` — decode via `<img>`, not FileReader (avoids a second full-size base64 copy). **EXIF orientation: rely on the browser** — since Chrome 81 / Firefox 77 / Safari 13.1, `<img>` decode and `drawImage()` from it honor EXIF (`image-orientation:from-image` default). No manual EXIF parsing. Compute dims from the decoded `naturalWidth/Height` (already swapped for portrait).
2. **GIF special case:** skip canvas entirely (re-encode kills animation) — `FileReader.readAsDataURL(file)` IS the payload; toast a size note when >2 MB. Thumbnail still via canvas (static first frame is fine).
3. **"orig" quality:** `FileReader.readAsDataURL(file)` passthrough, no canvas resize.
4. **"high"/"med":** `scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight))` (maxEdge 2560/1600 — longest edge, so portraits keep vertical resolution; never upscale; never draw at native size then scale — Safari canvas caps ~16.7 MP). Draw once to a canvas at target dims. Encoding rule (exact): produce `canvas.toDataURL("image/jpeg", q)` (q 0.82/0.72); for PNG/WebP sources ALSO produce `canvas.toDataURL("image/png")` and keep the **shorter** string (real transparent PNGs usually stay PNG; JPEG flattens alpha to black, acceptable on the dark deck background). When `scale === 1` and the source is JPEG/PNG/WebP, additionally read the original via FileReader and keep the shorter of original vs re-encode (re-encoding small optimized files can inflate them — a small already-optimized WebP especially, and WebP data URIs bake into the deck fine).
5. Thumbnail: second canvas, longest edge 192px, `toDataURL("image/jpeg", 0.7)`.
6. `URL.revokeObjectURL(url)` on both onload-completion and onerror paths; drop the `<img>`.
7. Fill the placeholder item, swap the skeleton card for the real card, update count/size readouts.

### 3.3 Natural sort

```
function naturalCompare(a, b) {
  var r = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  if (r !== 0) return r;
  return a < b ? -1 : (a > b ? 1 : 0);   // deterministic tie-break: raw code-unit order
}
```

Compared on `sortKey` (basename sans extension) — yields `1 < 2 < 3 < 3a < 4 < 10`, `img9 < img10`, case-insensitive series grouping; `003` vs `3` tie broken stably by the raw fallback (then by original selection index if still equal — sort is applied to arrays whose order is selection order, and the comparator chain above is stable-adjacent; keep insertion order as final tie-break by using the item id). Slides are keyed by generated `id`, never filename — duplicate filenames are legal. This is a runtime API, not syntax: allowed.

### 3.4 Collate preview strategy — static snapshot, not live SVG

**Decision:** the collate preview and card-thumb background are **rasterized snapshots**, not live SVG copies. Cloning `#polySvg`/`#blobSvg` markup would duplicate gradient/filter def ids; `url(#id)` resolves document-wide, so one copy renders wrong or blank. Instead, `syncCollatePreview()` (run on tab activation, only when a serialized-settings hash changed):

1. Build fresh strings at fixed deck aspect. **Do NOT use `buildBase()`** — it branches on `state.style` (lines 884–889: orbs → `buildOrbs`, dots/lines → `buildGrid`), which would show an orbs/grid preview while the deck always bakes poly, violating the honesty rule below. Instead call `shadePoly(1280, 720, lx, ly, false)` directly (the deck world regardless of style), with the light pinned to a fixed point (e.g. 640, 360) — `state.light.x/y` live in current-aspect Design coordinates (at 4:3, y ranges to 960 in a 720-tall snapshot) and must not be passed through raw. Plus (if `state.blob.enabled`) `buildBlobSvg(1280, 720)`. Never copy DOM innerHTML, and ignore `state.aspect` (deck is always 16:9). Note: `shadePoly→buildMesh` uses the single-slot `polyMesh` cache keyed on `W×H` (lines 642–648), so a 720-tall snapshot evicts the Design mesh whenever Design aspect ≠ 16:9 — harmless but causes a mesh rebuild on every tab switch; add a comment saying so, or bypass the cache for the snapshot build.
2. Wrap each in a full `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">…</svg>` string and set as `'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr)` on `#colBgBase` / `#colBgTop`. The explicit `width`/`height` attributes are **required**: WebKit renders an `<img>`-loaded SVG with no intrinsic size as zero-size when drawn to canvas (step 4 would silently produce blank thumbs in Safari), and they make the `drawImage` target size deterministic.
3. Replicate `applyComposite()`'s decision (which layer is on top, blend mode, opacity — factor the logic at 894–907 so it can drive CSS `z-index`/`mix-blend-mode`/`opacity` on the two `<img>`s as well as the live SVGs).
4. Draw the composed box to a ~264×148 canvas (`drawImage` both imgs after they load) → data URI → set as CSS `background-image` on all `.cardThumb`s. Blend handling rule (exact): map the blend mode to its `globalCompositeOperation` equivalent when one exists; **for any mode without a faithful equivalent (`hue`/`saturation`/`color`/`luminosity` and other non-separable or divergent modes), plain source-over is the rule** — acceptable for the tiny thumb.

No drift/relight rAF runs for the collate copy — it is a representative still frame. Tab-1 rAF loops are stopped while Collate is visible via the `collateActive` flag mechanism specified in §2.1 (added to both `step()` bail conditions in `startDrift`/`startOrbDrift`) and restarted on return to Design via `safeRender()`.

**Honesty rule:** the preview shows what the deck bakes — 16:9, poly+blob (with the `state.style!=="poly"` hint from §2.7), blob layer omitted when `state.blob.enabled` is false (see §3.5 item 8).

### 3.5 Dynamic-N deck generation — exact changes

N = `collate.items.length` (minimum 2 via default blanks; N=1 must still build and work). Compute at the top of `buildDeck`: `var N = collate.items.length; var WH = N * DK.SH;` and thread `(N, WH)` as parameters — all consumers are only called from `buildDeck` (1617–1643).

1. **Line 1468** `DK`: keep `W:1920, SH:1080, SIGMA:1404` as constants; remove `N`/`WH` from constant use (all consumers take params); **delete the dead `XC`**.
2. **`deckBlobLayer(N)`** (1470–1491): replace both `DK.N` uses — the seam-fraction array `s[0..N]` (must have N+1 entries; slide k uses `s[k]`/`s[k+1]` — this shared-contact mechanism is the seam-continuity guarantee and already generalizes) and the slice loop. Per-slice call `buildBlobSvg(DK.W, DK.SH, {orientation…, top:s[k], bottom:s[k+1], seed:b.seed+k*1013, vSeam:true, noBg:true})` inside `<g transform="translate(0 k*1080)">` is unchanged.
3. **`deckMesh(N, WH)`** (1494–1521): replace `DK.WH`. **Rescale the point budget (line 1496)** from `clamp(300, 3500, density*12)` (calibrated for N=10) to `Math.max(300, Math.min(Math.min(350 * N, 8000), Math.round(state.poly.density * 1.2 * N)))` — identical density-per-slide and identical floor/ceiling at N=10 (350×10 = 3500, floor stays 300), linear scaling, absolute ceiling 8000 points so 50-slide decks don't explode generation time/SVG bytes. `sideN = WH/160` already scales. **Leave line 1500's `var topN = 10;` alone** — it is the count of fixed perimeter points along the world's top/bottom edges, a coincidental 10, not a slide count; parameterizing it would make edge-point spacing depend on N for no reason.
4. **`deckWorld(N, WH)`** (1595–1607): line 1605 bgRect literals `2320`/`11200` become `(DK.W + 400)` / `(WH + 400)`, string-concatenated. Pass N/WH into the `deckBlobLayer`/`deckMesh` calls.
5. **`DECK_CONTROLLER`** (1542–1551) hard-codes `N=10` at 1543. Split the string constant into `DECK_CONTROLLER_A = "var deck=document.getElementById('sbsDeck'),N="` and `DECK_CONTROLLER_B = ",…rest unchanged…"`; `buildDeck` emits `DECK_CONTROLLER_A + N + DECK_CONTROLLER_B`. Do NOT regex-replace at runtime. Everything else in the controller (wheel debounce, keys, touch, `__sbsCur`/`__sbsGoTo`) is reused byte-for-byte.
6. **`deckCfgObj(D, N)`** (1609–1615): `N: DK.N` → param. `DECK_RUNTIME` (1525–1539) is already fully N-parametric via the config — untouched. `SIGMA` stays 1404 (per-slide-height constant). One light per slide is automatic; the Gaussian `w<0.02` skip and binary-search band culling bound per-frame cost at any N.
7. **Slide emission** — new `collateSlides()` replaces `deckSlides()` (which is deleted):

```
function collateSlides() {
  var out = "";
  for (var i = 0; i < collate.items.length; i++) {
    var it = collate.items[i];
    if (it.kind === "blank") out += '<section class="slide"></section>';
    else out += '<section class="slide img-slide"><div class="img-frame"><img src="'
              + it.dataURL + '" alt="' + escAttr(it.alt) + '"></div></section>';
  }
  return out;
}
```

with `escAttr(s)` replacing `&`→`&amp;`, `"`→`&quot;`, `<`→`&lt;`, `>`→`&gt;` — **mandatory for every attribute interpolation** (hostile filename `my "best" <pic>.jpg` must not break the deck). Data URIs need no escaping (base64 alphabet is attribute-safe) — but nothing except the item's own `dataURL` ever goes in `src`. In the parts-array export (§3.6), each section is pushed as its own part rather than concatenated into `out`.

8. **`state.blob.enabled` decision:** `deckWorld` currently always bakes the blob layer (ignores the toggle). **Change it to honor `state.blob.enabled`** — emit no blob group when disabled — because the collate preview honors it and a preview/output mismatch is worse than preserving the legacy quirk.
9. **Img-slide CSS:** append the three reference rules (§1, verbatim) to `DECK_CSS` **unconditionally**, immediately after the `@media (max-width:760px)` rule (string ends line 1570) — inert on blank-only decks, matches the reference's position, keeps decks byte-comparable except intended changes. The stock text-slide classes stay (unused, harmless, matches reference). The reference's stray `.ticker` rule (§1 item 3) is NOT re-added.
10. **Snippet mode** (1617–1643): builds with the same N; the `!==10` console.warn (~1628) becomes `!==` + N baked into the emitted string. Snippet stays image-free by nature (background only) so clipboard size is fine. Keep the split-closing-tag convention everywhere.
11. **Comment sweep (mandatory in this step):** rewrite the stale deck comments — the block at 1457–1467 ("bakes … into a 10-slide deck", "1920x10800 world") and the comment at 1493 ("full 1920x10800 world") — to N-generic wording, so the whole-file greps in Step 8 / test 16 pass with zero hits.
12. **Determinism note (code comment):** background geometry depends only on tab-1 state + N (blob slice seeds are `b.seed + k*1013`, independent of images), so re-downloads after reorder reproduce the same background.

### 3.6 Export pipeline

- **Blob parts array, never one string.** With images, the deck reaches tens of MB; single-string concat risks the V8 string ceiling and GC churn. `buildDeck` (standalone branch) becomes `buildDeckParts()` returning an **array** of string parts (doctype+head+CSS, bg SVG world, each slide section pushed individually, runtime, config, close) passed directly to `new Blob(parts, {type:"text/html"})` — never `.join("")`.
- Download: existing pattern verbatim — Blob → `URL.createObjectURL` → temp `<a download="slide-deck.html">` → click → revoke after 4s (copy `downloadDeck`, 1645–1655). **Forbidden:** `href="data:text/html,…"` (Chrome truncates multi-MB data hrefs).
- Snippet copy (1352–1354) keeps using the joined string (it's image-free and small).
- Size estimate: `1200000 + Σ dataURL.length` (the 1.2 MB constant covers background SVG + runtime + config; hardcode with a comment), displayed per §2.7.

### 3.7 Style coverage decision

**Deck output remains poly-FSS + blob regardless of `state.style`**, exactly as today (`buildDeck→deckWorld→deckMesh` never branches on style). The Collate tab changes slide content and N only. Mitigations shipped now: the §2.7 hint on the Collate Deck group and the Design snippet hint when `state.style !== "poly"`, plus a `// FOLLOW-UP:` comment at `deckWorld` noting orbs would need a continuous W×WH orb field and grids a whole-world pattern fill with rethought per-canvas fade/tint masks (868–880). The download button is never disabled for style — a poly deck is valid output. `state.aspect` is likewise ignored by decks (16:9 fixed), surfaced by `#colAspectNote`.

---

## 4. Step-by-step implementation sequence

Each step ends with: `cp index.html "background generator.html" && cmp index.html "background generator.html"`, then a browser smoke check (`#errBox` empty).

**Step 1 — Tab bar + view shells.**
Touches: `<body>` top (before line 96), `.app` open tag (line 96 area), head `<style>` (append before line 93), IIFE init (near 1211/1658), `startDrift`/`startOrbDrift` step loops (bail conditions at 928/944).
Add `#tabBar` markup, `id="viewDesign"` on the existing `.app`, empty `<div class="app hidden" id="viewCollate">` with stage/panel shells (§2.3 skeleton, groups empty). Add CSS: `.app.hidden{display:none}`, `#tabBar`, `.tabBrand`, `.tabPills`, `.tabBtn(.active)`. Add `setTab(name)` (guard-wrapped) toggling classes + calling `syncCollatePreview()` stub + the `collateActive` flag mechanism from §2.1 (add `|| collateActive` to both step-loop bail conditions; `safeRender()` restart on return to Design). Demote the Design `<h1>` (line 101). Verify: switching works, Design unchanged, drift/orb loops stop on Collate and resume on Design.

**Step 2 — Design deck-group rewrite.**
Touches: lines 431–446 markup, wiring at 1351–1354, hint copy 435/440–444.
Remove `#deckDownloadBtn` + its handler wiring; add `#gotoCollateBtn` → `setTab("collate")`. Keep `#deckSnippetBtn`; rewrite hints per §2.2 (no "10" anywhere). (`deckSlides()` deletion lands in Step 6 with the buildDeck refactor.)

**Step 3 — Collate state, ingestion, natural sort.**
Touches: after line 558 (state), new functions in the IIFE, "Add images" group markup + CSS.
Add `collate` object seeded `[blank, blank]`; `naturalCompare`; `escAttr`; `addFiles` with validation, placeholder-first sequential pipeline, quality-dependent encode rules (including the WebP keep-shorter rule), GIF/orig FileReader paths, thumbnail generation, error list + toasts (§3.2 exactly). Wire `#fileInput`/`#filePickBtn`/`#dropZone` + strip drop + body-level `dragover`/`drop` preventDefault + `.dragOver`/`.dragHint` with enter/leave counter. Wire `#qualityPills`. Add the guard-wrapped `beforeunload` handler using `ev.preventDefault(); ev.returnValue = "";` (§2.8).

**Step 4 — Ordering strip UI.**
Touches: strip markup/CSS, new `renderStrip()` + selection/reorder/remove/insert handlers.
`renderStrip()` rebuilds `#slideStrip` from `collate.items` (cards keyed by item id, index badges, gaps, empty state); implement selection (`selectedId` → `.selected`, overlay, `#colPreviewLabel`, Selected-slide group §2.6 incl. `#altInput` live-save), ‹/›/× chips, gap-click blank insertion, `#addBlankEndBtn`, `#resetOrderBtn` (canonical reset + `userOrdered=false`), keyboard handling, `userOrdered` flips on any manual op. Optional: pointer-drag reorder. All ops = splices on `collate.items` + `renderStrip()` + readout refresh.

**Step 5 — Preview snapshot.**
Touches: new `syncCollatePreview()` + factored `applyComposite` logic (894–907), `#collateBox` internals + CSS.
Implement §3.4: settings-hash check, direct `shadePoly(1280,720, 640,360, false)` (NOT `buildBase` — it branches on style) + `buildBlobSvg(1280,720)` when enabled → data-URI SVG `<img>`s with explicit `width="1280" height="720"` on the wrapper roots, composite CSS on the img pair, shared 264×148 thumb-background raster (source-over fallback for unmappable blend modes) applied to `.cardThumb`s, `polyMesh` cache-eviction comment or bypass, `#colAspectNote` visibility. Hook into `setTab`.

**Step 6 — Dynamic-N deck refactor + collate baking.**
Touches: 1457–1467 + 1493 (stale "10-slide"/"10800" comments rewritten, §3.5 item 11), 1468 (DK), 1470–1491 (deckBlobLayer), 1494–1521 (deckMesh incl. the 1496 budget formula; leave `topN = 10` at 1500 alone — edge-point count, not slide count), 1542–1551 (controller split), 1553–1570 (DECK_CSS append), 1572–1593 (delete deckSlides), 1595–1607 (deckWorld params, bgRect, blob.enabled honor), 1609–1615 (deckCfgObj), 1617–1643 (buildDeck→ N computed, parts array for standalone, snippet N-warn), 1645–1655 (downloadDeck → parts Blob, moved wiring to `#collateDownloadBtn`).
Implement §3.5 items 1–12 and §3.6. Add `collateSlides()`/per-section parts + `escAttr` usage.

**Step 7 — Deck group readouts + polish.**
Touches: Deck group markup/CSS, a `refreshDeckReadouts()` called from every add/remove/reorder/quality change.
Slide count breakdown, size estimate + `#deckWarn` tiers, processing-disabled download button, style-mismatch hint, `#colErrChip`, all remaining hint copy and toasts (§2.7–2.8).

**Step 8 — Final sync + sweep.**
Grep the built file for stale literals: `10800`, `11200`, `N=10`, "10-slide" — **zero hits anywhere in the file, comments included** (the stale comments were rewritten in Step 6; this matches test 16 exactly); grep the script block for `=>`, backticks, `\blet\b`, `\bconst\b`, and raw `</script>` inside string literals (closing tags only — raw opening `<script>` literals such as line 1429's are fine and must not be flagged). Run the test plan (§6). Final `cp` + `cmp`.

---

## 5. Pitfalls the implementer MUST handle

Merged and deduplicated; mitigations inline (most are already baked into §2–§4 — this is the checklist).

**Memory & size**
1. Giant-string concat of the deck HTML → **parts array straight into `new Blob(parts)`**; never join.
2. `data:` hrefs truncate multi-MB downloads → Blob + objectURL + `<a download>` only.
3. Triple-copy blowup (File + full base64 + preview) → pipeline stores exactly two strings per image (payload + 192px thumb) plus the disk-backed `File` handle, which is a reference and NOT a heap copy (§9.2); revoke objectURLs; never render the full data URI at thumb size; the memory meter (§9.3) makes any regression here visible immediately.
4. Canvas dimension limits (Safari ~16.7 MP) → cap longest edge (2560) computed from `naturalWidth/Height` before drawing; never draw native-size-then-scale.
5. No size feedback → live estimate + 15/40 MB warn tiers; per-file 8 MB warn / 25 MB reject.
6. Clipboard with baked images freezes/fails → collate deck is **download-only**; snippet stays image-free background plumbing.
7. Concurrent decode of 30 phone photos ≈ GB-scale bitmaps → strictly sequential `next()` chain; one bitmap alive at a time.

**Image decoding**
8. EXIF rotation → decode via `<img>` (browser auto-orients since Chrome 81/FF 77/Safari 13.1); dims from decoded `naturalWidth/Height`; no manual EXIF parsing; orientation-6 fixture in tests.
9. HEIC undecodable in Chrome/Firefox, often with empty `file.type` → detect by extension or decode failure; specific error message; never abort the batch (per-file guard).
10. PNG alpha → JPEG turns transparent regions black → the "produce JPEG + PNG for PNG/WebP sources, keep the shorter" rule (§3.2 step 4).
11. Re-encode larger than source → when `scale===1` and the source is JPEG/PNG/WebP, compare against the original data URI and keep the shorter; never upscale.
12. Animated GIF loses animation on canvas → GIFs pass through as original bytes (FileReader), size note >2 MB.
13. SVG input → rejected explicitly (XSS vector in distributable HTML).
14. `accept` is advisory; DnD bypasses it; empty MIMEs exist → extension allowlist + attempt-decode, one shared `addFiles` for both paths.

**Sorting & ordering**
15. Lexicographic `1,10,2` → `naturalCompare` (§3.3) on basename sans extension; test table incl. `9<10`, `3<3a<4`, `003` vs `3`, `IMG2` vs `img10`, `ü1.jpg`, duplicates.
16. Ties/duplicates → stable tie-break chain (numeric compare → raw code-unit → insertion order); items keyed by generated id, never filename.
17. Re-sort clobbering manual order → the `userOrdered` rule (§2.5), stated verbatim in code comments: after any manual intervention, new batches sort among themselves only and append before the trailing blank; existing entries are NEVER re-sorted (explicit "Reset order" is the only exception).
18. Async decode order ≠ selection order → synchronous placeholders at sorted positions; decodes fill in place; failures remove their placeholder.
19. Blanks as implicit prepend/append → blanks are ordinary tagged entries in the one array; the two defaults are created once at boot, never re-injected.

**Drag-and-drop**
20. Drop outside the zone navigates away, losing everything → unconditional document-level `dragover`+`drop` `preventDefault()` at boot. Tested.
21. dragenter/dragleave flicker over children → enter/leave counter or `relatedTarget` check.
22. Non-file drops (text/URLs) → check `dataTransfer.files.length`, ignore silently.
23. Folder drops → decode-validation catches them; "no supported images" toast for zero-valid batches.
24. Reorder-drag vs file-drop collision → reorder uses pointer events (not HTML5 DnD); the file-drop handler requires `files.length > 0`.
25. `<input type=file>` quirks → reset `value=""` after processing; empty selection is a no-op.

**Variable N (highest-risk category — six leak points)**
26. `DECK_CONTROLLER` literal `N=10` (1543) → string split + injected N; post-build test asserts emitted N == section count.
27. `deckWorld` bgRect `2320`/`11200` (1605) → `(DK.W+400)`/`(WH+400)`.
28. `DK.N`/`DK.WH` literals (1468) → computed per build; dead `XC` deleted. **False positive to leave alone:** line 1500's `var topN = 10;` is the fixed perimeter-point count along the world's top/bottom edges — a coincidental 10, correct at any N; do NOT parameterize it while sweeping tens.
29. Mesh point budget calibrated for N=10 (1496) → `density*1.2*N`, clamps `max(300, min(350*N, 8000))` — identical to today's output at N=10, floor included; soft-cap advice ~30 slides in `#deckWarn` territory.
30. Blob seam array off-by-one → `s` must have N+1 entries, slide k uses `s[k]`/`s[k+1]`; test asserts N tiles at `translate(0 k*1080)`.
31. Snippet `!==10` warn (1628) + "10-slide" copy (435, 440–444) + stale comments (1457–1467, 1493) → parameterized/rewritten in Steps 2/6; whole-file grep test for `10800|11200|N=10|10-slide` (zero hits).
32. N=0/N=1 degenerates → N≥2 by default blanks; N=1 must still build and scroll (controller clamps); blank-only N=2 tested.
33. Runtime cost grows O(N) → bounded by Gaussian-window skip + binary-search culling; one manual 30-slide perf check mandated.
34. Reproducibility → background depends only on tab-1 state + N; comment stating so.

**Integration & state**
35. Tab switch destroying state → both views permanent in DOM; display toggling only.
36. Duplicate SVG ids across two live previews → **snapshot `<img>` strategy (§3.4)**, no live SVG copies; explicit intrinsic size on wrapper `<svg>` (Safari zero-size canvas draw); tab-1 rAF paused via the `collateActive` flag in both step-loop bail conditions (§2.1 — there is no pre-existing cancel path to reuse), restarted via `safeRender()`.
37. Preview lying about the deck → collate snapshot calls `shadePoly` directly (never `buildBase`, which branches on `state.style`), fixed light point, 16:9 poly+blob honoring `blob.enabled`; style/aspect hints (§2.7, §2.3b); `polyMesh` cache eviction noted or bypassed.
38. Refresh = total loss → guard-wrapped `beforeunload` with `ev.preventDefault(); ev.returnValue = "";` whenever image items exist (returned prompt strings are ignored by modern browsers; custom copy lives in the UI, not the dialog).
39. Settings JSON contamination → zero collate state in `serializeSettings`; test asserts no `data:image` in copied JSON.
40. ES5 syntax discipline → banned-token grep test.
41. Split-tag convention → mandatory for all emitted **closing** `</script>` tags in string literals (the only sequence that can terminate the host block); raw opening `<script>` literals are fine (line 1429 exists today); grep test targets closing tags only.
42. Two-file sync → `cp` + `cmp` after every step; test suite runs `cmp` as an assertion.
43. Boot fragility → collate init is its own `guard()` call after existing `initControls()`; smoke test: `#errBox` empty after load and after visiting Collate.

**Output correctness & accessibility**
44. Alt/attribute injection → `escAttr()` on every interpolated attribute; hostile-filename test.
45. Default alt quality → editable per-image alt defaulting to cleaned filename; empty allowed (`alt=""` = decorative).
46. Keyboard-inaccessible reorder → ‹ › chips + keyboard bindings are the contract; drag is optional polish; focus follows moved cards.
47. Portrait/panorama → handled correctly by the verbatim reference CSS (`80vw/80vh` + `contain`); downscale cap is longest-edge, not width.
48. `.img-slide` CSS placement → unconditional append after the `@media(max-width:760px)` rule, matching the reference position; the reference's leftover `.ticker` rule (§1 item 3) is a known inert delta — never re-add it.

---

## 6. Test plan

**Harness:** Playwright + Chromium against `file:///home/user/background-generator/index.html`. Capture downloads by wrapping `URL.createObjectURL` via `page.addInitScript` (stash Blobs in `window.__testBlobs`), then `page.evaluate` `.text()` on the last Blob to get the generated deck HTML. Fixtures: tiny PNGs/JPEGs generated in-page via canvas or ~1 KB committed files named for the sort cases; one committed EXIF-orientation-6 JPEG (create once with exiftool/PIL); one dummy `.heic` (any bytes — the name matters).

**Headless checks**
1. **Boot regression:** load → `#errBox` empty, no `pageerror`; both views exist; Design active; move a slider → no errors, `#polySvg` innerHTML changed. Repeat error check after visiting Collate.
2. **Default order:** `setInputFiles` with `10.png, 2.png, 1.png, 3a.png, 3.png, 9.png` → strip order `blank, 1, 2, 3, 3a, 9, 10, blank`.
3. **Natural-sort table** (via `page.evaluate` if comparator reachable, else via the strip): `img9<img10`; `IMG2<img10`; `003` vs `3` stable; `ü1.jpg` no throw; `4<4a`; duplicate filename twice → two distinct cards.
4. **Batch-append rule:** after test 2, reorder one card (sets `userOrdered`), then add `0.png, 5.png` → they appear as a sorted block before the trailing blank; existing rows unmoved. Also verify pre-`userOrdered` adds fully re-sort.
5. **Reorder persistence:** move a card, switch tabs and back, add another file → manual order intact.
6. **Insert/remove blanks:** gap-click inserts; remove the leading blank; strip and generated deck both reflect it.
7. **Same-file reselect:** same file twice → added twice; empty selection → no-op, no error.
8. **Dynamic-N deck (core):** 4 images + 3 blanks (N=7) → download, assert on the captured HTML: exactly 7 `<section class="slide"` (blanks empty, image sections matching `<section class="slide img-slide"><div class="img-frame"><img src="data:image/` exactly); controller regex `/N=7[,;]/`; cfg contains `N:7`; bgRect `width="2320" height="7960"`; zero occurrences of `11200`/`10800`; 7 blob-tile `translate(0 k*1080)` groups k=0..6; CSS contains all three img-slide rules incl. `border-radius:14px` and `box-shadow:0 30px 80px rgba(0,0,0,.5)` and does NOT contain `.ticker`; each `src` base64 spot-decodes (`atob` of first 100 chars); alt for fixture `pic "one" & <two>.png` is entity-escaped and the file parses (load it, count imgs).
9. **Generated deck runs:** write captured HTML to scratchpad, `page.goto(file://…)` → no pageerrors; `__sbsGoTo(2)` → `__sbsCur()===2`, `#sbsDeck.scrollTop === 2*clientHeight`; `#sbsWorld` has a nonzero translate; ArrowDown advances.
10. **Blank-only deck:** no uploads → download works, N=2, two empty sections, deck loads and scrolls.
11. **EXIF fixture:** orientation-6 JPEG (100×80 tagged portrait) → decoded img in the output deck has `naturalHeight>naturalWidth`.
12. **HEIC rejection:** `x.heic` → error line appears, zero cards, no pageerror; mixed batch `x.heic + 1.png` still adds `1.png`.
13. **Document-drop guard:** dispatch cancelable synthetic `dragover`/`drop` on `document.body` → `defaultPrevented === true`, URL and list unchanged; drop on the zone with a file → card added (fallback if DataTransfer injection is fiddly: assert the listeners preventDefault).
14. **Alt editing:** type into `#altInput`, download → escaped text in output.
15. **Design-tab regression:** `#deckDownloadBtn` gone; `#gotoCollateBtn` switches to Collate; snippet copy still works (blank-only, N=2) and contains no `data:image`.
16. **File hygiene:** `cmp index.html "background generator.html"` exits 0; script-block grep for `=>`, backticks, `\blet\b`, `\bconst\b`, raw `</script>` in string literals → zero hits (the real closing tag at EOF excepted; opening `<script>` literals are NOT flagged); grep whole file for `10800`, `11200`, `N=10`, `10-slide` → zero hits anywhere, comments included (matches Step 8).
17. **Settings JSON purity:** copy settings with images loaded → JSON parses and contains no `data:image`.

**Manual checks**
18. Real DnD of 8 phone JPEGs from a file manager: highlight on hover, sorted add, crisp thumbs, memory sane (< a few hundred MB in Task Manager).
19. Generated 8-image deck in Chrome, Firefox, Safari: one slide per wheel notch, smooth glide, background continuous across every slide boundary (inspect blob-layer joints specifically), touch swipe on a phone, rounded images with soft shadow, ~10% background margin all around, portrait and panorama fixtures contained correctly.
20. 30-slide deck: generation < ~10 s; scroll ~60 fps (DevTools trace, no >50 ms frames while settling).
21. Drop a folder, a `.txt`, an `.svg`: three clear error outcomes, nothing added, no crash.
22. Refresh with images loaded → browser's leave-confirmation dialog appears (generic text — custom strings are not shown by modern browsers).
23. Tab-switch soak: bounce 10×, tweak sliders in between → preview updates on activation, order/thumbs intact, no runaway rAF (CPU check — drift/orb loops must be dead while Collate is visible and alive again on Design when the state predicates want them).
24. Safari-specific: card thumbnails render the background raster (verifies the intrinsic-size fix on the snapshot SVG wrappers, §3.4 step 2).

---

## 7. Out of scope for v1

1. **No persistence** — no IndexedDB/localStorage of images or order; refresh loses work (`beforeunload` prompt is the only mitigation). No "save project" format. No collate state in settings JSON/presets.
2. **No captions rendered on slides** — alt text is metadata only; no visible overlays; slide types are exactly `blank` and `img` (no lorem/text templates in collate decks).
3. **No non-poly deck worlds** — deck stays poly-FSS + blob regardless of `state.style` (hint only, no orbs/grid world builders); `state.aspect` not honored in decks (16:9 fixed).
4. **No image editing** — no crop/rotate/filters/per-image radius/shadow controls; frame CSS is the reference values verbatim, not configurable.
5. **No HEIC conversion, no animated-GIF re-encode guarantees, no SVG input, no video slides** — clear rejection messaging is the feature.
6. **No fancy reorder UX** — chips/keyboard are the contract; pointer-drag is optional, no animation/auto-scroll polish, no multi-select, no undo/redo.
7. **No export formats beyond the one HTML deck** — no PNG/PDF/PPTX/ZIP/print stylesheet.
8. **No mobile authoring** — the Collate UI targets desktop; generated decks must still play on mobile (existing touch controller, tested).
9. **No workers/streaming** — sequential per-file canvas processing with skeleton cards is acceptable at ≤ ~30 images.
10. **No studio refactor** — tab-1 behavior/markup changes only where §2.2, §2.1's rAF-pause flag, and N-parameterization require; everything else byte-stable, held by the boot-regression test.
11. **No i18n, no new theming** beyond the existing CSS vars and control vocabulary.

---

## 8. Open questions for the user — ANSWERED

> **All five are answered (2026-08-30). Questions 1, 3, 4 and 5: the recommended default is confirmed — build exactly as written below. Question 2: the ALTERNATIVE was chosen, which changes the design; §9 is the authoritative amendment and supersedes any text above that conflicts with it.**

1. **Design tab's deck download.** This plan removes `#deckDownloadBtn` from Design and deletes the lorem sample deck, replacing it with "Assemble deck in Collate →" (download lives in Collate; blank-only decks cover the old sample use case). **Default: proceed with the move.** Alternative: keep a legacy 10-slide sample button on Design too.
2. **Quality changes and already-added images.** **ANSWERED — alternative chosen: keep originals and re-encode on change, plus a live memory-usage readout at the bottom left of the page so the cost stays visible. See §9.**
3. **`state.blob.enabled` in decks.** Today the deck always bakes the corner-blob layer even when the toggle is off. **Default: honor the toggle** so the Collate preview and the download match. Alternative: preserve the legacy always-baked behavior.
4. **Snippet slide count.** "Copy deck snippet" (background-only, for pasting behind your own slides) will size its world to the current Collate slide count. **Default: N = Collate count, noted in the hint.** Alternative: keep it fixed at 10.
5. **Add-before-first-reorder behavior.** Until the user manually reorders, each new batch triggers a full natural re-sort of all images (so multiple picker rounds interleave 1,2,3,3a,4 correctly); after any manual change, batches only append sorted-among-themselves before the trailing blank. **Default: this two-phase rule.** Alternative: always append batches, never interleave.
---

## 9. Amendments from the user's answers (AUTHORITATIVE — supersede §1–§8 wherever they conflict)

Answers received 2026-08-30. Q1, Q3, Q4, Q5 = confirmed defaults, no change to the plan. **Q2 = alternative chosen**, specified in full here.

### 9.1 What changed, in one line

Originals are **kept**, so switching Bake quality **re-encodes every image already in the deck**; and a **live memory readout sits fixed at the bottom left of the page** so the cost of keeping them is always visible.

### 9.2 Keep originals — retain the `File` handle, not a second copy

**The mechanism.** Each image item retains its original `File` object (`it.file`) plus `it.origBytes = file.size`. This is deliberately NOT "keep the original base64 in memory": a `File`/`Blob` is a *reference to disk-backed storage*, so holding it costs approximately nothing on the JS heap, while giving full re-encode capability from pristine source. Keeping base64 originals instead would roughly double heap for zero benefit. Every re-encode reads from `it.file` — **never** from the previous `dataURL` — so quality changes never accumulate generation loss (High → Medium → High returns to true High quality, not a re-compressed approximation).

**`reprocessAll()`** — runs when the quality pill changes:

- Re-encodes every `kind:"image"` item **in place**, preserving `id`, position, `name`, `sortKey`, `alt`, and selection. Only `dataURL`, `bytes`, `thumbURL`, `w`, `h`, `type` are replaced.
- Sequential, reusing the same index-driven `next()` chain as `addFiles` — exactly one decoded bitmap alive at any moment (§3.2 memory discipline is unchanged and applies here too).
- Each item in flight gets the `.loading` skeleton treatment on its card (card keeps its slot; the strip never reorders during a re-encode).
- `#collateDownloadBtn` is disabled while running, label "Re-encoding images…"; `#deckSizeVal` reads "—" until the run completes.
- Toasts: on start "Re-encoding 12 images at Medium…"; on completion "Re-encoded 12 images — deck now ≈ 4.1 MB".
- **Re-entrancy:** a `collate.procGen` counter increments on every quality change; the `next()` chain checks its captured generation at each step and abandons itself if superseded. Rapid pill-clicking must never interleave two chains or double-write an item.
- **GIFs are exempt** — they always pass through as original bytes at every quality setting (canvas re-encode would kill the animation, §3.2 step 2). A re-encode run skips them without marking them `.loading`.
- **Unreadable original** (file moved/deleted since it was added — Chrome throws `NotReadableError` at *read* time, not when the handle is created): keep that item's existing payload untouched, add an `#uploadErrs` line "NAME — original no longer readable, keeping current quality", continue the run. Never drop the slide, never abort the batch.
- Quality changing with zero image items is a no-op (no toast).

### 9.3 Memory meter — `#memMeter`, fixed bottom-left, both tabs

**Placement.** Appended as the last child of `<body>` (outside both view containers, so it shows on Design and Collate alike): `<div id="memMeter" title="…"><span class="memDot"></span><span id="memText"></span></div>`.

**Styling.** `position:fixed; left:12px; bottom:12px; z-index:` above `.app` but below `#toast`; background `--panel`, 1px `--line`, `border-radius:999px`, padding 6px 12px, `font:11px "ui-monospace",monospace` with `font-variant-numeric:tabular-nums`, color `--muted`, subtle shadow. `.memDot` is a 7px circle, `margin-right:8px`. Non-interactive except for its `title` tooltip (no `pointer-events:none` — the tooltip must work). It must never overlap the strip's horizontal scrollbar; if it would, the Collate stage gets `padding-bottom:34px`.

**Content.** Two or three segments, `·`-separated:
- `Images 42.1 MB` — always shown. This is the true heap cost of what Collate is holding: `Σ (dataURL.length + thumbURL.length) × 2` bytes, because JS strings are UTF-16 (two bytes per base64 character). Note this is deliberately **about double** the "Est. size" in the Deck group, which counts the same payloads as they will be written to the file (one byte per character) — the tooltip explains the difference so the two numbers never look like a bug.
- `Heap 310 / 2048 MB` — only when `performance.memory` exists (Chromium only): `usedJSHeapSize` / `jsHeapSizeLimit`. Absent in Firefox and Safari; never assume it.
- `Device 8 GB` — only when `navigator.deviceMemory` exists **and** `performance.memory` does not (a fallback signal, so the meter still says something useful in Firefox/Safari).
- With no images and no `performance.memory`, it reads `Images 0 B`. The meter is always visible; it never hides.

**Tiers** (`.memDot` background + text color): OK `#3fb950`; **warn** amber `--amber`-ish `#e0aa4e` when heap used > 60% of limit OR image payload > 120 MB; **danger** `--danger` when heap > 80% OR payload > 300 MB, with the text extended to `… — try Medium quality`. Tier is the worst of the two signals.

**Update triggers.** `updateMemMeter()` (guard-wrapped, must never throw when the APIs are missing) is called after: every add, remove, reorder, insert, reset, quality change, each `reprocessAll()` step, and deck download — plus a `setInterval` every 2000 ms, since heap moves on its own (GC). The interval handler must be cheap: no DOM writes when the rendered string is unchanged.

**`title` tooltip** (exact copy): "Images = memory held by the processed image data (base64 in memory is ~2× the size it takes in the downloaded file). Heap = this tab's total JavaScript memory, reported by Chrome only. Originals stay on disk — they're re-read when you change quality."

### 9.4 Consequential edits to earlier sections

- **§2.4** quality bullet and hint: rewritten above — quality is retroactive.
- **§3.1** item shape: `file` + `origBytes` added. **§3.1 memory rule** and **§5 pitfall 3**: amended in place.
- **§3.2**: the pipeline keeps `it.file` after processing; everything else (sequential decode, ObjectURL revoke, dropping the `<img>`, GIF/orig passthrough, keep-the-shorter encode rules) is unchanged. `reprocessAll()` reuses this pipeline rather than duplicating it — factor the per-file work into one `processFile(item, gen, done)` used by both paths.
- **§4 Step 3** additionally implements `it.file` retention, `reprocessAll()`, `collate.procGen`, and `updateMemMeter()` + `#memMeter` markup/CSS/interval. **Step 7** wires the meter into the remaining refresh points.
- **§7 out-of-scope item 1** stands unchanged: originals live in memory only, nothing is persisted, a refresh still loses everything.

### 9.5 Additional tests (append to §6)

25. **Quality is retroactive:** add 3 images at High, note `#deckSizeVal`; click Medium; after processing settles, size is strictly smaller, slide order/count unchanged, `alt` text preserved, all three cards still show thumbnails, `#errBox` empty.
26. **No generation loss:** High → Medium → High returns `#deckSizeVal` to within a few percent of the first High reading (proves re-encode reads `it.file`, not the degraded payload).
27. **Re-entrancy:** click Medium then Original within ~100 ms → exactly one chain finishes, final payloads all match the last-clicked setting, no duplicate cards, no error.
28. **GIF exemption:** a GIF item's `bytes` is identical before and after a quality change.
29. **Meter present and sane:** `#memMeter` is visible on both tabs, its text matches `/^Images /`, the number rises after an add and falls after switching to Medium; with `performance.memory` stubbed to 90% of limit the dot carries the danger class; deleting `performance.memory` in the page context still renders the meter without throwing.
