# OncoGenik

A pipeline that turns a patient-facing oncology video idea into a script, a talking-points outline, and an HTML slide deck. Three agents share this repo. You review in a web UI, Claude writes, Hermes researches forums and literature and generates images. GitHub is the queue and the store.

| Read this | For |
|---|---|
| `docs/ENGINE_DESIGN.md` | Architecture, lifecycle, decisions, build status |
| `docs/DEPLOY.md` | Order of operations to bring it live |
| `docs/HERMES_CONTRACT.md`, `hermes/` | What Hermes polls for and writes |
| `docs/ROUTINE.md`, `routine/PROMPT.md` | How Claude runs as a Routine on your subscription |
| `docs/ACTIONS.md` | Opt-in GitHub Actions fallback |
| `docs/UI.md`, `docs/AUTH.md` | The web app, its API, and passkey login |
| `docs/DECK_TOOL.md`, `slides/studio/` | The deck builder and Slide Background Studio |
| `docs/DEMO_RUN.md` | One project run end to end, with the friction found |

## Working locally

```bash
npm ci
npm test                                   # state machine checks
node tools/test-auth.js && node tools/test-ui.js && node tools/test-routine.js && node tools/test-deck.js
node tools/project.js                      # CLI usage
node tools/project.js status               # every project and what it waits on
```

A project lives in `projects/<slug>/`. Claude's stage skills are in `.claude/skills/` and take the slug as their argument. `Basic outline.drawio.html` is the original flow diagram.
