# OncoGenik UI

The web app is static files in `web/` (staged into `dist/` by `tools/stage-static.js`) plus Node serverless functions in `api/`. It runs on Vercel. Every API call needs the passkey session cookie; every write is one git commit on the configured branch, so the agents see UI actions the same way they see each other's commits.

## Environment variables

| Variable | Meaning |
|---|---|
| `GITHUB_TOKEN` | Fine-grained token with Contents read and write on this repo only. The browser never sees it. |
| `GITHUB_REPO` | `owner/name` of this repo. |
| `GITHUB_BRANCH` | Branch the UI reads and writes. Default `main`. |

Session variables (`SESSION_SECRET`, the passkey credential, `SETUP_TOKEN`) belong to the auth layer; see `docs/AUTH.md`.

## Base path

Everything is served under `/oncogenik`, which markburbridge.com forwards to this project. Pages and assets are staged into `dist/oncogenik/`, the API answers at `/oncogenik/api/*`, and `web/app.js` builds every URL from one `BASE` constant.

## One function

Vercel's Hobby plan deploys at most 12 serverless functions. Every `/api/*` URL is rewritten by `vercel.json` to `api/router.js`, the only deployed function, which dispatches to handler modules in underscore folders such as `api/_projects/`. Vercel skips files under underscore paths when counting functions. `tools/test-router.js` fails if a new file under `api/` would become a second function, so new endpoints go into the router's table instead.

## Routes

Static pages: `/` (the app, `web/index.html`), `/login` (auth layer), `/backgenapp` (the Studio, public). Front-end routes are hashes: `#/` dashboard, `#/ideas`, `#/projects/<slug>`, `#/guidelines/<file>`.

All API routes return JSON unless noted, require a session (401 `{error:"unauthorized"}` otherwise, and the page then redirects to `/login`), and report problems as `{error}` with a 4xx or 5xx status. Handlers begin with `requireSession` from `api/_lib/session.js`.

| Method and path | Body | Does | Commit message |
|---|---|---|---|
| `GET /api/projects` | | One recursive tree fetch finds every `projects/*/project.json`; each is read and summarised: `slug, title, phase, updated, waiting` (from `waitingOn`), `open` tasks, `failed` tasks with their `error`. | |
| `POST /api/projects` | `{title, minutes, idea?}` | Creates the project as the CLI does: `project.json` from `createProject`, `idea.md` copied from the idea file (or a generated header), `.gitkeep` in `research, script, outline, images/generated, slides, package`. If an idea file was used its `status:` line becomes `started`. | `ui: start <slug>` |
| `GET /api/projects/:slug` | | `project.json`, `waiting`, and a file index `[{path, size}]` of the project folder from the tree. | |
| `POST /api/projects/:slug/action` | `{action, payload}` | Runs `applyAction` from `tools/state.js`, executes its ops (`write` becomes a file, `copy` reads the source from the repo), writes `project.json`. A state-machine error comes back as 400 with its message. Returns `{project, waiting}`. | `ui(<slug>): <action>` |
| `POST /api/projects/:slug/task` | `{task, status:"todo"}` | Puts a failed task back in the queue through `setTask`. Only `failed` tasks, only to `todo`. | `ui(<slug>): retry <task>` |
| `GET /api/file?path=` | | Text files return `{path, content, sha, size}`. PNG, JPEG, WebP and GIF under `images/generated/` return the bytes with the right `Content-Type` and `Cache-Control: private, max-age=3600`. `&raw=1` returns any file's bytes as an attachment, which the UI uses for downloads. Paths must start with `projects/`, `ideas/`, `guidelines/` or `exemplars/`, contain no `..`, backslash, empty or `.` segments, and use only `[A-Za-z0-9._/-]`. | |
| `GET /api/ideas` | | Lists `ideas/*.md` with the header lines `title, source, found, status` parsed and the body text. | |
| `POST /api/ideas` | `{title, text}` | Writes `ideas/<slug>.md` in the `docs/HERMES_CONTRACT.md` format with `source: human`, `status: new`. | `ui: idea <slug>` |
| `GET /api/guidelines` | | `{files: {script.md, images.md, outline.md}, proposals: [{slug, created, path, proposals: [...]}]}` from `guidelines/proposals/*.json`. | |
| `PUT /api/guidelines` | `{file, content}` | Overwrites one of the three guideline files. | `ui: edit guidelines/<file>` |
| `POST /api/guidelines/proposal` | `{slug, id, decision}` | `accept` replaces `current_excerpt` in the named guideline with `proposed_text` (appends when the excerpt is not found) and marks the proposal `decided: "accept"` with `decided_at`; `reject` only marks it. Already-decided proposals return 409. | `ui: <decision> proposal <slug>#<id>` |

Proposal file shape, written by Claude's learn task:

```json
{ "slug": "<project>", "created": "2026-10-09",
  "proposals": [ { "id": "p1", "file": "script.md", "rationale": "...", "current_excerpt": "...", "proposed_text": "..." } ] }
```

## How the UI maps to `tools/state.js`

The UI never changes task status by hand, apart from the retry. Everything else goes through `applyAction`, which decides what files to write and what phase to enter.

| Screen | Control | Action and payload | What the state machine does |
|---|---|---|---|
| Dashboard | Start project | `POST /api/projects` | `createProject`, enters `research` with five tasks |
| Dashboard, project | Retry on a failed task | `POST .../task {task, status:"todo"}` | `setTask(todo)` then `reconcile` |
| Project, Script | Request changes | `script.feedback {text}` | writes `script/feedback-vN.md`, requeues `script.revise` |
| Project, Script | Approve script | `script.approve` | copies `script/vN.md` to `script/final.md`, enters `outline_images` |
| Project, Outline | Request changes | `outline.feedback {text}` | writes `outline/feedback-vN.md`, requeues `outline.revise` |
| Project, Outline | Approve outline | `outline.approve` | copies to `outline/final.md`, sets `approved.outline` |
| Project, Images | Save decisions | `images.decide {decisions: {id: {decision, note}}}` | merges into `images/decisions.json`; any `iterate` requeues `images.reprompt` and blocks `images.generate` on it |
| Project, Slide order | Save order | `slides.order {order: [ids]}` | checks every id is approved, writes `slides/order.json` |
| Project, Slide order | Finish review | `review.finish` | needs outline approved, no open tasks, every image decided and none iterate, an order set; enters `slides` |

Only changed decisions are sent. The UI enables each control only in the phase where the action is legal and when no conflicting agent task is open, but the server enforces the rules and the UI shows its message.

Dashboard grouping uses `waiting.on`: `human`, or any project with a failed task, under "Waiting on you", `claude` and `hermes` under their headings (a project waiting on both appears under both), `none` or phase `done` under "Done". Research files, versions, prompts, decisions and the package are read through `/api/file`; which ones exist comes from the file index in `GET /api/projects/:slug`.

Markdown renders through `marked` from `/vendor/marked.min.js` and is then stripped of scripts, event handlers and `javascript:` links before insertion. Research files are agent output and may contain text copied from the open web, so they are treated as data here too.

## Commits

`api/_lib/github.js` writes with the Git Data API so one UI action is one atomic commit even when it touches several files:

1. `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` for the head commit sha. Note the singular `ref` on reads and plural `refs` on updates.
2. `GET /repos/{owner}/{repo}/git/commits/{sha}` for the base tree sha.
3. `POST /repos/{owner}/{repo}/git/blobs` with `{content, encoding: "base64"}` per file. Base64 is used for text and binary alike, so PNG copies and markdown go through the same path.
4. `POST /repos/{owner}/{repo}/git/trees` with `base_tree` and one entry per file `{path, mode: "100644", type: "blob", sha}`; a delete is the same entry with `sha: null`.
5. `POST /repos/{owner}/{repo}/git/commits` with `{message, tree, parents: [head]}`.
6. `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` with `{sha, force: false}`.

If step 6 returns 409 or 422 (the branch moved since step 1, which happens when Hermes or Actions push at the same moment), the ref is re-read and steps 4 to 6 run again on the new base; blobs are reused. One retry, then the error surfaces to the UI.

Reads use the Contents API with `?ref=<branch>`. Text comes back base64 in JSON; files over 1 MB come back with an empty content field, so those are read through `GET /git/blobs/{sha}`. Images use the `application/vnd.github.raw+json` media type, which returns bytes directly and works up to 100 MB. The project list and file index use `GET /git/trees/{branch}?recursive=1`, which is capped at 100,000 entries and 7 MB; the response says `truncated` when the cap hits and the API passes that flag through.

## Tests

`node tools/test-ui.js` runs with no network: `commitFiles` against a recorded `fetch` (call sequence, tree entries, base64 blob content, retry on 422, give-up on a second 409), the `api/_file.js` path guard, and every handler against an in-memory GitHub module and a stubbed session.

## Sources

- GitHub REST, Git blobs: https://docs.github.com/en/rest/git/blobs — create takes `content` and `encoding` (`utf-8` or `base64`); get returns base64 up to 100 MB.
- GitHub REST, Git trees: https://docs.github.com/en/rest/git/trees — `base_tree`, entry `mode` values, `sha: null` deletes, `recursive` and `truncated` on get.
- GitHub REST, Git commits: https://docs.github.com/en/rest/git/commits — `message`, `tree`, `parents`.
- GitHub REST, Git references: https://docs.github.com/en/rest/git/refs — `GET git/ref/{ref}`, `PATCH git/refs/{ref}` with `sha` and `force`, 409 and 422 on failure.
- GitHub REST, Repository contents: https://docs.github.com/en/rest/repos/contents — `ref` parameter, `raw` and `object` media types, 1 MB and 100 MB limits.
- Hermes idea file format and `images/prompts.json`: `docs/HERMES_CONTRACT.md`.
