---
name: package
description: Task package.build. Copy the final script, outline, deck, and sources into projects/<slug>/package/ and write package/README.md with the title, date, and length. Argument is the project slug.
---

# package

Argument: `<slug>`. Project dir is `projects/<slug>/`. Task name is `package.build`.

## Ground rules

- Copy, do not edit. The package is exactly what the owner approved.
- No patient data. Only write under `projects/<slug>/package/`.

## Inputs and outputs

| From | To |
|---|---|
| `script/final.md` | `package/script.md` |
| `outline/final.md` | `package/outline.md` |
| `slides/deck.html` | `package/deck.html` |
| `research/sources.md` | `package/sources.md` |

Plus `package/README.md`, written by this skill.

## Steps

1. Read `project.json`. Confirm `tasks["package.build"].status` is `todo` and the phase is `package`.
2. `node tools/project.js start <slug> package.build`
3. Confirm all four inputs exist. If any is missing, fail (see below) before copying anything.
4. Copy:
   ```
   P=projects/<slug>; mkdir -p $P/package
   cp $P/script/final.md $P/package/script.md
   cp $P/outline/final.md $P/package/outline.md
   cp $P/slides/deck.html $P/package/deck.html
   cp $P/research/sources.md $P/package/sources.md
   ```
5. Compute the length: `wc -w` on `script.md` excluding its `## Sources` section, divided by 140, rounded to the nearest half minute. Count slides in `deck.html` from `slides/order.json`.
6. Write `package/README.md`:
   ```markdown
   # <title>

   - Date: <YYYY-MM-DD, today>
   - Target length: <target_minutes> minutes
   - Estimated spoken length: <N> minutes (<W> words at 140 wpm)
   - Script version: v<script_version>, outline v<outline_version>
   - Slides: <count>

   ## Contents
   - script.md: the approved script, read aloud on camera
   - outline.md: talking points with time marks
   - deck.html: the slide deck, open in any browser, no network needed
   - sources.md: every source the script cites, by key

   This video is general education, not medical advice. Viewers should talk with their own oncologist before acting on anything in it.
   ```
7. `node tools/project.js done <slug> package.build` (the project moves to `done` and queues `learn`).

## Quality bar

- The four copied files are byte-identical to their sources (`cmp`).
- README numbers match the files (word count, slide count, versions from `project.json`).

## When something is missing

- Any input missing: `node tools/project.js fail <slug> package.build "<path> missing"` naming the first missing file. Typical causes: outline not approved (`outline/final.md`), deck build failed (`slides/deck.html`).
