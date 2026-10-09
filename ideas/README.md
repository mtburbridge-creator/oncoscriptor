# Ideas

One markdown file per video idea, named `<slug>.md`, written either by you or by Hermes's `ideas.scan` cron job. The UI's Ideas page lists these files by their header and offers "start a project", which runs `node tools/project.js new <slug> --title "..." --idea ideas/<slug>.md`, copies the file into `projects/<slug>/idea.md`, and opens the project in the `research` phase. An idea file is a suggestion, not a brief: the research phase decides what the video actually covers. Keep ideas to topics a patient would search for, and never include anything about a specific person.

## File format

Plain text with a short header so the UI can list it (from `docs/HERMES_CONTRACT.md`):

```
title: What to expect from immunotherapy side effects
source: hermes
found: 2026-10-09
status: new

One paragraph on why this topic now, and what patients seem to be asking.
```

- `title`: the working title, usually a question patients ask.
- `source`: `hermes` or `human`.
- `found`: the date the idea was written, `YYYY-MM-DD`.
- `status`: `new`, or `started` once a project exists for it.
- Body: one paragraph. Hermes may add a short list of URLs it saw the topic discussed at, without usernames or quotes.
