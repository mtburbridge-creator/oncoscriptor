# Projects

One folder per project, named by its slug, created with `node tools/project.js new <slug> --title "..." [--minutes 10] [--idea ideas/<slug>.md]`. The folder holds `project.json` (the state file every agent reads: phase, tasks with owner and status, `script_version`, `outline_version`, `approved`), `idea.md` (a copy of the idea file the project started from), and one subfolder per deliverable: `research/` (`forums.md` and `literature.md` from Hermes, `sources.md`, `sources-notes.md`, and `news.md` from Claude, then `notes.md` from synthesis), `script/` (`v1.md`, `feedback-vN.md`, `vN+1.md`, and `final.md` once approved), `outline/` (same pattern with `outline_version`), `images/` (`prompts.json` with 12 entries, `decisions.json` from the owner's review, and `generated/<id>.png` from Hermes), `slides/` (`order.json` from the owner's picks and `deck.html` from `tools/build-deck.js`), and `package/` (`script.md`, `outline.md`, `deck.html`, `sources.md`, `README.md`). Phases run `research`, `draft`, `script_review`, `outline_images`, `review`, `slides`, `package`, `done`; see `docs/ENGINE_DESIGN.md` for the full lifecycle and who owns each step. No patient data is ever written anywhere in this tree.

## Idea file format

A project starts from a file in `ideas/`, plain text with a short header the UI can list:

```
title: What to expect from immunotherapy side effects
source: hermes
found: 2026-10-09
status: new

One paragraph on why this topic now, and what patients seem to be asking.
```

`source` is `hermes` or `human`. `status` is `new` until a project is started from it, then `started`.
