# OncoGenik engine design (v1)

OncoGenik turns a patient-facing oncology video idea into three deliverables.

| Deliverable | Format | Produced by |
|---|---|---|
| Script | Markdown | Research, draft, physician review loop |
| Talking-points outline | Markdown | Derived from the approved script |
| Slide deck | Single HTML file | Approved images baked into a Slide Background Studio deck |

Fixed decisions, from your answers on 2026-10-09.

| Decision | Value |
|---|---|
| Audience | Patients, always |
| Length | 8 to 15 minutes, roughly 1,100 to 2,200 spoken words |
| Images per project | 12 generated, you pick any subset |
| Idea scanning | Hermes |
| Forum and reddit research | Hermes, through its own APIs |
| Deep literature search | Hermes, through its medical search APIs |
| Trusted-source and news research | Claude |
| Image generation | Hermes, calling OpenAI |
| Slide template | Slide Background Studio, merged at `slides/studio/` |
| UI | Web app, login-gated, no patient data, GitHub as the shared store |
| Projects | Many at once, each at its own phase, dashboard shows what waits on you |

## Three agents, one repo

GitHub is the queue, the store, and the audit trail. Each project is a folder. Each agent reads the project's state file, does the task assigned to it, writes files to fixed paths, and commits. Nobody talks to anybody directly.

| Agent | Runs where | Holds which secrets | Does |
|---|---|---|---|
| You | Browser, OncoGenik UI | Login passphrase only | Pick ideas, review, approve, choose images, order slides |
| Claude | GitHub Actions, Claude Code | Anthropic key, in Actions secrets | Trusted-source research, news, synthesis, draft, revise, outline, image prompts, deck build, package, guideline proposals |
| Hermes | Your home machine | OpenAI key, forum APIs, medical search APIs, a GitHub token for this repo | Idea scanning, forum research, literature search, image generation |

Secrets never share a location. The browser holds none. The UI's serverless side holds one GitHub token. Claude's key lives in Actions. Hermes keeps its own on your machine. Losing any one place leaks one set.

## Project lifecycle

A project moves through phases. Each phase has an owner. The dashboard groups projects by who they wait on.

| # | Phase | Owner | Produces |
|---|---|---|---|
| 1 | idea | You | `projects/<slug>/project.json` created from an idea file |
| 2 | research | Hermes and Claude in parallel | `research/forums.md`, `research/literature.md` from Hermes. `research/sources.md`, `research/news.md` from Claude |
| 3 | synthesis | Claude | `research/notes.md`, written only after both research halves land |
| 4 | draft | Claude | `script/v1.md` |
| 5 | script review | You | Approve, or feedback in `script/feedback-vN.md` |
| 6 | revise | Claude | `script/vN+1.md`, back to phase 5 |
| 7 | outline and prompts | Claude | `outline/v1.md`, `images/prompts.json` with 12 entries |
| 8 | image generation | Hermes | `images/generated/<id>.png` |
| 9 | outline review and image review | You | `outline/feedback-vN.md`, `images/decisions.json` |
| 10 | iterate | Claude then Hermes | Revised outline, revised prompts for any image marked iterate, regenerated images |
| 11 | slides | Claude | `slides/order.json` from your picks, `slides/deck.html` built by the deck tool |
| 12 | package | Claude | `package/` with `script.md`, `outline.md`, `deck.html`, `sources.md` |
| 13 | learn | Claude proposes, you accept | Edits to `guidelines/` |

Phases 5 and 6 loop until you approve. Phase 9 loops through 10 until every image is approved or rejected and the outline is approved.

### project.json

```json
{
  "slug": "immunotherapy-side-effects",
  "title": "What to expect from immunotherapy side effects",
  "audience": "patient",
  "target_minutes": 10,
  "phase": "research",
  "created": "2026-10-09",
  "tasks": {
    "research.forums":     { "owner": "hermes", "status": "running" },
    "research.literature": { "owner": "hermes", "status": "todo" },
    "research.sources":    { "owner": "claude", "status": "done" },
    "research.news":       { "owner": "claude", "status": "done" },
    "synthesis":           { "owner": "claude", "status": "blocked", "needs": ["research.forums", "research.literature"] }
  },
  "script_version": 0,
  "approved": { "script": false, "outline": false }
}
```

Status values are `todo`, `running`, `done`, `blocked`, and `failed`. A task with `needs` stays blocked until every named task is done. The UI computes "waiting on you" from the phase owner. Each agent only edits its own task entries, which keeps commits from colliding.

## Repo layout

```
app/                       OncoGenik web UI, static pages plus serverless functions
.github/workflows/         Claude stage runners
.claude/skills/            one skill per Claude task
hermes/                    contract and JSON schemas Hermes reads
ideas/                     one markdown file per idea, from you or Hermes
guidelines/
  script.md                patient-explainer script template and voice rules
  images.md                image style rules
  outline.md               outline rules
  slideshow.settings.json  Studio settings preset exported from the Design tab
exemplars/                 approved scripts, outlines, prompts for drafts to read
projects/<slug>/           one folder per project, layout above
slides/studio/             Slide Background Studio, merged subtree
tools/
  build-deck.js            drives the Studio headlessly to produce deck.html
  validate.js              checks project.json and citation keys
docs/
```

## Research, split by trust

Claude reads what a patient could find and verify. Hermes reads what needs your API keys.

| Source class | Agent | Examples |
|---|---|---|
| Trusted patient sources | Claude | NCI, American Cancer Society, NCCN patient guidelines, FDA labels, major cancer centers |
| Popular news | Claude | General news coverage patients will have seen |
| Forums | Hermes | Reddit, patient forums, the questions and misconceptions people actually post |
| Literature | Hermes | PubMed and whatever medical search engines its APIs reach |

Synthesis lands in `research/notes.md` and every claim that reaches the script carries a citation key resolving in `research/sources.md`. Research records the date it ran.

## Patient-facing content rules

Baked into `guidelines/script.md` and checked at draft time.

- Plain language, about an eighth-grade reading level. Every medical term defined on first use.
- No individual medical advice. Framing sends decisions back to the patient's own oncologist.
- No absolute claims about outcomes. Probabilities stated as ranges with the source.
- Forum research informs what to address. Forum posts are never cited as medical fact.
- Standard disclaimer in the script's opening and the package.
- No patient data anywhere in the repo, ever.

## Images

Claude writes twelve prompts into `images/prompts.json`. Each entry has an id, the script section it illustrates, the prompt text, and a one-line purpose. Hermes generates each through OpenAI and commits the PNGs. The UI shows a review grid. For each image you choose approve, reject, or iterate with a note. Iterate sends the note to Claude, which rewrites that prompt only. Hermes regenerates only those ids. Twelve is the pool. The deck uses whatever subset you approve, in the order you set.

## Slides

The Studio stays as shipped under `slides/studio/`, including its three byte-identical copies and its own tests. Its `vercel.json` sits inside that folder, so it does not affect the OncoGenik deployment.

The deck tool does not fork the app. The Studio's deck builder already assembles the whole deck from strings, and it serializes and applies settings as JSON. So `tools/build-deck.js` opens `slides/studio/index.html` in headless Chromium through Playwright, applies `guidelines/slideshow.settings.json`, loads the approved images in `slides/order.json` order, calls the same export path the Collate tab uses, and writes `projects/<slug>/slides/deck.html`. The Studio's Collate tests already use this pattern, so it is proven on this app. You choose the background once in the Design tab and export its settings to the guidelines file. Change it there and every later deck follows.

## The UI

A small web app, hosted on Vercel where the Studio already lives. Static pages plus serverless functions.

| Area | Shows | Actions |
|---|---|---|
| Dashboard | Every project, grouped by waiting-on-you, Claude, Hermes, done | Open a project, start one from an idea |
| Ideas | Idea files with source and status | Add an idea, start a project |
| Project | One panel per phase, with the current files | Approve, leave feedback, review images, set slide order, download the package |
| Guidelines | Templates and pending learning proposals | Edit, accept, or reject |

Every action is a commit. Approving a script copies the current version to `script/final.md` and flips the phase. Leaving feedback writes a feedback file and hands the project to Claude. The UI never runs an agent. It changes state, and the agents respond to state.

### Login and secrets

- One passphrase, stored as a hash in the serverless environment. A correct login sets a signed HttpOnly cookie. Every API call checks it. Failed attempts are rate limited.
- The serverless side holds a fine-grained GitHub token scoped to this one repo. The browser never sees it.
- The repo stays private.
- Option for later. GitHub login restricted to your account, if you want to drop the passphrase.

## How the agents get triggered

| Agent | Trigger |
|---|---|
| Claude | A GitHub Actions workflow runs on push. It finds projects whose current tasks are owned by Claude with status `todo`, runs the matching skill with Claude Code, commits, and pushes. |
| Hermes | Polls the repo every few minutes, or receives a webhook from the UI if you prefer. Finds tasks owned by Hermes with status `todo`. Contract in `docs/HERMES_CONTRACT.md`. |
| Idea scanning | Hermes, on its own schedule, writes to `ideas/`. |
| Learn | Runs when a project reaches done. |

## Learning loops

"AI training" in the diagram means guideline refinement. After a project finishes, Claude diffs `script/v1.md` against `script/final.md`, reads your feedback files, and proposes concrete edits to `guidelines/script.md`. The same happens for outlines and for image prompts, using approve and reject decisions. Proposals appear in the UI's Guidelines area. You accept or reject each. Approved finals also land in `exemplars/` for the next draft to read. Nothing is fine-tuned.

## Build order

Each step ends with something you can use.

1. **Skeleton.** Repo layout, `project.json` schema, validator, guideline files, one Claude skill per task. Run one project end to end from Claude Code by hand, with you playing Hermes by committing files.
2. **Hermes contract.** Schemas and polling rules. Hermes runs forum research and image generation for real.
3. **Deck tool.** Headless Studio driver. First real deck from approved images.
4. **Actions runner.** Claude runs on push without anyone opening a terminal.
5. **UI.** Dashboard, project view, image review, login.
6. **Learn.** Guideline proposals and the Guidelines area.

## Still open

1. Hosting on Vercel, next to the Studio, or somewhere else.
2. Passphrase login, or GitHub login restricted to your account.
3. Which medical search APIs Hermes has, so the literature file format matches what they return.
4. Whether Hermes can poll GitHub on a schedule, or wants a webhook.
5. Whether to keep deploying the Studio from its old repo, or move that deployment here once this repo is the home for it.
