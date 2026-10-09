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
| UI | Web app on Vercel, passkey login, no patient data, GitHub as the shared store |
| Projects | Many at once, each at its own phase, dashboard shows what waits on you |

## Three agents, one repo

GitHub is the queue, the store, and the audit trail. Each project is a folder. Each agent reads the project's state file, does the task assigned to it, writes files to fixed paths, and commits. Nobody talks to anybody directly.

| Agent | Runs where | Holds which secrets | Does |
|---|---|---|---|
| You | Browser, OncoGenik UI | A passkey on your devices | Pick ideas, review, approve, choose images, order slides |
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

The Studio now lives here and the old repo's deployment will be shuttered once this one is up. It keeps serving at `/backgenapp` so the markburbridge.com proxy only needs to be repointed to the new deployment. Vercel's build step copies `slides/studio/index.html` into the static output under `backgenapp/`, which means one canonical file in git, no committed duplicates, and nothing else in the repo served statically. The three-copy rule and the Studio's own `vercel.json` go away in build step 3, and its deploy test is updated to match.

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

Passkey only. There is no password, no magic link, and no public route that writes anything.

- Every route, API and page alike, sits behind Vercel middleware that checks a signed session cookie. No cookie means a 401 and a redirect to the login page. The single public exception is the Studio at `/backgenapp`, which holds no secrets and writes nothing.
- Login is WebAuthn through SimpleWebAuthn. The server sends a challenge, your device signs it with the passkey, the server verifies the signature against the stored public key and sets an HttpOnly, SameSite Strict session cookie that expires in 12 hours.
- One user means no database. The registered credential, which is a credential id, a public key, and a counter, lives in a Vercel environment variable. The challenge travels in a signed cookie that expires in two minutes and is consumed once. Synced passkeys from Apple and Google report a counter of zero on every login, which the library tolerates. A hardware key with a real counter would need a small store such as Vercel KV. Add that only if you choose to use one.
- Enrollment happens once through a setup route that only exists while a `SETUP_TOKEN` environment variable is set. You run it, paste the resulting credential into the environment, and delete the token. After that the route is gone.
- Login routes are rate limited. Five failures in ten minutes lock the route for an hour.
- The serverless side holds one fine-grained GitHub token with contents write on this repo only. The browser never sees it.
- The repo stays private.

### Who can write to the repo

Hermes and Claude both act on whatever lands in the repo, so the real security boundary is the set of writers.

| Writer | Path in | Limit |
|---|---|---|
| You | UI after passkey, or your own GitHub account | Full |
| UI backend | Fine-grained token | Contents only, this repo only |
| Claude | Actions token | Contents only, scoped by the workflow |
| Hermes | Its own fine-grained token | Contents only, this repo only |

Nobody else can commit. A bad actor without your passkey reaches a 401 and nothing more.

One residual risk remains and it is prompt injection through research. Hermes reads forums and Claude reads the open web, and a page can contain text written to steer an agent. Three things contain it. Hermes tasks are narrow and each one produces a file, never an action. Claude's skills are told that every file under `research/` is data to summarize and never instructions to follow. And nothing reaches the script, the deck, or the guidelines without you approving it in the UI.

## How the agents get triggered

| Agent | Trigger |
|---|---|
| Claude | A GitHub Actions workflow runs on push. It finds projects whose current tasks are owned by Claude with status `todo`, runs the matching skill with Claude Code, commits, and pushes. |
| Hermes | A Hermes cron job polls the repo every ten minutes. Details below. |
| Idea scanning | A second Hermes cron job, on whatever schedule you like, writes to `ideas/`. |
| Learn | Runs when a project reaches done. |

### Why Hermes polls

A webhook would mean opening a port on your home machine to the internet. Polling needs nothing inbound. Hermes Agent ships a cron system with a pre-run script option, it runs shell and git through its terminal tool, and a job can reply silently when there is nothing to do. So the job is one line to create.

```
hermes cron create "every 10m" "Run the OncoGenik tasks listed in the script output. If the output says NONE, reply [SILENT]." --name oncogenik-poll --script ~/.hermes/scripts/oncogenik-poll.py
```

The script pulls the repo, reads every `projects/*/project.json`, prints the tasks owned by Hermes with status `todo`, and prints NONE when there are none. The exact prompt and script live in `docs/HERMES_CONTRACT.md`.

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

## Decided in round two, 2026-10-09

| Question | Decision |
|---|---|
| Hosting | Vercel |
| Login | Passkey, nothing else, every route gated |
| Hermes file formats | Plain text, no fixed structure |
| Hermes trigger | Cron polling from Hermes, no webhook |
| Studio deployment | Moves here, old repo shuttered after cutover |

Nothing is open. Build step one can start.

