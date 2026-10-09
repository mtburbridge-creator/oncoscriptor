# Hermes contract (draft)

What Hermes reads, what it writes, and how it commits. Hermes needs a GitHub token with contents write on this repo and nothing else.

## Finding work

Poll the default branch every few minutes. Read every `projects/*/project.json`. A task is Hermes's when `tasks.<name>.owner` is `hermes` and `status` is `todo`. Before starting, set the status to `running` and commit, so a second poll does not start it twice.

## Tasks

| Task | Reads | Writes |
|---|---|---|
| `research.forums` | `project.json`, `idea.md` | `research/forums.md` |
| `research.literature` | `project.json`, `idea.md` | `research/literature.md` |
| `images.generate` | `images/prompts.json` | `images/generated/<id>.png`, one per prompt whose `status` is `todo` |
| `ideas.scan` | Nothing in a project. Runs on Hermes's own schedule | `ideas/<slug>.md` |

### research/forums.md

```markdown
# Forum research: <title>
Run: 2026-10-09  Sources: reddit r/cancer, r/breastcancer, <forum>

## Questions people ask
- ...

## Misconceptions seen
- ...

## Emotional themes
- ...

## Representative posts
- [r/cancer, 2026-08-02] "..." (paraphrased, no usernames)
```

No usernames, no quotes long enough to identify a poster.

### research/literature.md

```markdown
# Literature: <title>
Run: 2026-10-09  Engines: PubMed, <other>

## Key findings
- Finding. (PMID 12345678) (DOI 10.xxxx/yyyy)

## Guidelines consulted
- NCCN Patient Guidelines, <topic>, <version>

## Sources
PMID 12345678 | Title | Journal, year
```

Every finding carries a PMID or DOI. Claude's synthesis will refuse a finding without one.

### images/prompts.json

Written by Claude. Hermes reads it.

```json
{
  "version": 2,
  "model": "openai",
  "size": "1792x1024",
  "prompts": [
    { "id": "01", "section": "intro", "purpose": "Set a calm tone", "prompt": "...", "status": "todo" },
    { "id": "02", "section": "how-it-works", "purpose": "...", "prompt": "...", "status": "done" }
  ]
}
```

Hermes generates every prompt with status `todo`, writes `images/generated/<id>.png`, sets that prompt's status to `done`, and commits. On an iterate round Claude resets only the revised ids to `todo`.

### ideas/<slug>.md

```markdown
---
title: What to expect from immunotherapy side effects
source: hermes
found: 2026-10-09
status: new
signals: [reddit r/cancer 14 posts last 30 days, ASCO news 2026-10-01]
---
One paragraph on why this topic now, and what patients seem to be asking.
```

## Committing

- Pull before every push. Retry once on a non-fast-forward.
- One commit per task. Message format `hermes(<slug>): <task>`.
- On completion set the task's status to `done`. On an error set `failed` and write the reason to `tasks.<name>.error`.
- Never edit a task entry owned by someone else. Never edit files outside the task's own outputs and `project.json`.
