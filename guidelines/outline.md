# Outline guideline: talking points

Read by the `outline` and `outline-revise` skills. The outline is what the presenter glances at while recording. It is derived from `script/final.md` and never adds facts the script does not contain.

## Rules

- One bullet per beat the presenter says. A beat is one point, not one sentence of the script.
- Each bullet is under 12 words. Fragments are fine. No full paragraphs.
- Group bullets by script section, using the same H2 headings as `script/final.md`, in the same order.
- Put a time mark on every H2 line, cumulative from the start, like `## Why does it cause fatigue? (3:30)`. Compute from the script's per-section minutes at 140 words per minute, rounded to the nearest 15 seconds.
- Carry citation keys through. A bullet that states a number, a rate, or an evidence claim ends with the same `[Sn]` the script used. Do not add keys the script does not have.
- Keep the disclaimer as its own section with one bullet that says to read it in full.
- Keep every term definition as its own bullet, in the form `Define: neutropenia = low infection-fighting white cells`.
- Under 60 bullets total. If the script needs more, merge beats, do not drop sections.
- No nested bullets deeper than one level. Use a nested bullet only for a short list the presenter reads out, like three symptoms.
- Finish with the Sources section copied from the script, unchanged.

## Layout

```markdown
# <Script title>

Outline for the <N>-minute script. Marks are cumulative.

## Cold open (0:00)
- Name the question: <the question>
- Why it matters to you right now

## Disclaimer (0:30)
- Read the disclaimer in full

## What is <topic>? (0:45)
- Define: <term> = <plain meaning>
- <beat> [S1]

...

## Talk to your oncologist (9:15)
- Question to bring: <the question>
- Close

## Sources
- [S1] ...
```

## Quality bar

- Every H2 in the script appears in the outline, same wording, same order, with a time mark.
- No bullet over 12 words. No more than 60 bullets.
- Every `[Sn]` in the outline also appears in the script.
- A presenter who reads only the outline would hit every key message and every definition in the script.
