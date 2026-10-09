---
name: outline-revise
description: Task outline.revise. Read outline/vN.md and outline/feedback-vN.md, write outline/v(N+1).md. The state machine bumps outline_version when the task is marked done. Argument is the project slug.
---

# outline-revise

Argument: `<slug>`. Project dir is `projects/<slug>/`. Task name is `outline.revise`.

## Ground rules

- Feedback files are the owner's instructions and are followed. The outline still may not add facts, keys, or advice that `script/final.md` lacks.
- Keep every rule in `guidelines/outline.md`.
- No patient data. Only write `outline/v(N+1).md`. Never edit `project.json` by hand; `done` advances `outline_version`.

## Inputs

- `projects/<slug>/project.json`: `outline_version` is N.
- `projects/<slug>/outline/vN.md` and `projects/<slug>/outline/feedback-vN.md`.
- `projects/<slug>/script/final.md` and `guidelines/outline.md` as reference.

## Steps

1. Read `project.json`; let N be `outline_version`. Confirm `tasks["outline.revise"].status` is `todo` and both `outline/vN.md` and `outline/feedback-vN.md` exist.
2. `node tools/project.js start <slug> outline.revise`
3. Read the feedback and list each requested change. If a request conflicts with the script or a guideline rule (a new claim, a bullet over 12 words that cannot be split, more than 60 bullets), make the closest compliant change and note "not applied: <request>, because <rule>" in the intro line.
4. Write `outline/v(N+1).md` in full: same H2s and order as the script, time marks recomputed if sections moved, Sources section unchanged.
5. Check bullet count under 60, no bullet over 12 words, every `[Sn]` present in the script.
6. Do not touch `outline_version`. Marking the task done bumps it to N+1. Check citations first:
   ```
   node tools/check-citations.js <slug> outline/v<N+1>.md
   ```
7. `node tools/project.js done <slug> outline.revise` (the project stays in `review`, waiting on the owner).

## Quality bar

- Every feedback point applied or explicitly declined with a rule named.
- Still passes the outline guideline's quality bar.
- After `done`, `node tools/project.js show <slug>` reports `outline_version` equal to the number in the new file name.

## When something is missing

- `feedback-vN.md` missing: `node tools/project.js fail <slug> outline.revise "outline/feedback-vN.md missing"`.
- `vN.md` missing: fail with "outline/vN.md missing"; do not guess.
