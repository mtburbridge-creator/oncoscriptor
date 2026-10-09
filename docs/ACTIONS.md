# GitHub Actions runner

How Claude's tasks get run without anyone opening a terminal. Two workflows live in `.github/workflows/`.

| Workflow | File | Does |
|---|---|---|
| Claude runner | `claude-runner.yml` | Picks one ready Claude task, runs its skill with Claude Code, commits, pushes, and dispatches the next run if more work is ready |
| CI | `ci.yml` | Tests and validates on every push and pull request |

## How the runner works

One run does one task. The chain, not a loop inside the job, handles the rest.

```
push to main (projects/, ideas/, guidelines/)   schedule every 30 min   workflow_dispatch
                 |                                        |                    |
                 v                                        v                    v
          scout: reconcile,                     worker: pick next task, run skill,
          commit state, dispatch                commit, push, dispatch if more remain
          a worker if a task is ready                      |
                                                           v
                                              workflow_dispatch (hop+1) ... until the queue is empty
```

Steps in order:

1. `actions/checkout` with full history, Node 22, `npm ci`.
2. **Pick task.** With manual `slug` and `task` inputs the run uses those (the skill name comes from the `TASKS` table in `tools/state.js`, and the task must be Claude-owned). Otherwise `node tools/next-claude-task.js` reconciles every project and prints the first `<slug> <task> <skill>` whose owner is `claude` and status is `todo`, lowest slug first, tasks in the order the state machine created them. Exit code 3 means nothing is ready.
3. **Mode.** A `push` run never calls the Claude action. The action's event parser accepts only `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `workflow_dispatch`, `repository_dispatch`, `schedule` and `workflow_run`, and throws `Unsupported event type` for anything else ([src/github/context.ts](https://github.com/anthropics/claude-code-action/blob/main/src/github/context.ts)). So a push run scouts: it reconciles, commits any state change, and dispatches a worker.
4. **Chromium**, only when the skill is `slides`. `npx playwright-core install --with-deps chromium` installs the browser that matches the pinned `playwright-core` devDependency (the `playwright-core` package ships the `install` CLI; `playwright-core install --dry-run chromium` lists what it would fetch). The step then writes `CHROMIUM_PATH` from `require("playwright-core").chromium.executablePath()` both to the job env and into the action's `settings.env`, which is how `tools/build-deck.js` finds the browser.
5. **Run Claude task** with `anthropics/claude-code-action@v1` (see inputs below). The prompt tells Claude to run `/<skill>` for the slug, to stay inside `projects/<slug>/`, `guidelines/`, `exemplars/`, not to commit, and to finish with `node tools/project.js done|fail`. The skill itself calls `start`. This step has `continue-on-error: true` so state is always settled and committed.
6. **Finalize.** `node tools/project.js reconcile`. If the task is still `todo` or `running`, the skill ended without reporting, so the runner marks it `fail` with a reason; the task is then not retried on its own and the dashboard shows it as waiting on you. Then `node tools/project.js validate`.
7. **Commit and push.** Identity `oncogenik-claude[bot] <oncogenik-claude[bot]@users.noreply.github.com>`. Stages `projects/`, `guidelines/`, `exemplars/` only. Message `claude(<slug>): <task>`, or `claude: reconcile project state` for a scout run that only reconciled. Resets the origin URL to the workflow token (the Claude action replaces the checkout credential with its own token, which it revokes when it finishes), then `git pull --rebase origin main && git push origin HEAD:main`, three attempts, ten seconds apart.
8. **Re-dispatch.** Runs `next-claude-task.js --no-reconcile` against the now current tree. If a task is ready and the chain depth is under `MAX_HOPS` (12), `gh workflow run claude-runner.yml --ref main -f hop=<n+1>`. Past the cap the 30-minute schedule continues the work.

Guard on the triggering author: there is none on purpose. The author of the triggering push does not matter; the task list decides. A push by the runner itself cannot trigger the workflow anyway (next section).

### The re-dispatch, and why

Pushes made with `GITHUB_TOKEN` do not start new workflow runs: "events triggered by the `GITHUB_TOKEN` will not create a new workflow run", with the documented exception that "`workflow_dispatch` and `repository_dispatch` events always create workflow runs" ([GitHub Docs, GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)). So after the runner pushes its commit, the `push` trigger does not fire for that commit, and the chain is kept alive with `gh workflow run`, which is a `workflow_dispatch` event ([gh workflow run manual](https://cli.github.com/manual/gh_workflow_run); REST `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`, [GitHub REST docs](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event)). Creating a dispatch with `GITHUB_TOKEN` needs `actions: write` on the job, or the API answers 403 "Resource not accessible by integration" ([community discussion 25702](https://github.com/orgs/community/discussions/25702)). The dispatched run's `github.actor` is `github-actions[bot]`, so the Claude action gets `allowed_bots: "github-actions"`; the action's agent mode checks the actor type and rejects non-User accounts not in that list ([src/github/validation/actor.ts](https://github.com/anthropics/claude-code-action/blob/main/src/github/validation/actor.ts)). Check the first chained run's log if in doubt: the action prints `Actor type:` and either `Verified human actor` or `is in allowed_bots list`.

`workflow_dispatch` only fires when the workflow file exists on the default branch, and scheduled runs always use the latest commit on the default branch ([Events that trigger workflows](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows)). The schedule can be delayed under load and, in public repositories, is disabled after 60 days without activity; this repo is private.

`concurrency: group: claude-runner, cancel-in-progress: false` serializes runs: at most one running, and at most one pending, in the group; a newer pending run replaces an older pending one ([Using concurrency](https://docs.github.com/en/actions/using-jobs/using-concurrency)). That is fine here because every run recomputes the queue from `project.json`, so two pending runs would do the same thing.

## Secrets and permissions

| Name | Where | Why |
|---|---|---|
| `ANTHROPIC_API_KEY` | Repository secret | Passed to the action's `anthropic_api_key` input. Never in the workflow file |
| `GITHUB_TOKEN` | Automatic | Commit, push, dispatch, and the action's GitHub operations |

Job permissions in `claude-runner.yml`:

| Permission | Why |
|---|---|
| `contents: write` | Push the commit |
| `actions: write` | `gh workflow run` |
| `id-token: write` | Not used while `github_token` is passed to the action. Kept so that removing `github_token` to use the Claude GitHub App works without another edit; the App path exchanges an OIDC token and fails without this permission ([FAQ](https://github.com/anthropics/claude-code-action/blob/main/docs/faq.md)) |

The runner passes `github_token: ${{ secrets.GITHUB_TOKEN }}` to the action so no GitHub App install is required. The action's FAQ: "If you wish to not use the GitHub app, you can instead provide a `github_token` input to the action for Claude to operate with." The usage guide says to include `github_token` only with a custom app; here it is a deliberate choice to keep the repo's writers to the four listed in `docs/ENGINE_DESIGN.md`. Remove the line to switch to the App at `https://github.com/apps/claude`.

`ci.yml` runs with `contents: read`.

## claude-code-action v1 inputs used

Input names are from [action.yml](https://github.com/anthropics/claude-code-action/blob/main/action.yml) and [docs/usage.md](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md).

| Input | Value here | Notes |
|---|---|---|
| `anthropic_api_key` | `${{ secrets.ANTHROPIC_API_KEY }}` | Required for the direct API |
| `github_token` | `${{ secrets.GITHUB_TOKEN }}` | Skips the OIDC and App token exchange |
| `allowed_bots` | `github-actions` | Lets a chained (bot-dispatched) run pass the human-actor check. The action strips a `[bot]` suffix when matching |
| `prompt` | Run `/<skill>` for `<slug>` ... | A `prompt` puts the action in automation mode: it executes immediately and creates no tracking comment ([custom-automations.md](https://github.com/anthropics/claude-code-action/blob/main/docs/custom-automations.md)) |
| `claude_args` | `--max-turns 80`, `--allowedTools ...`, `--append-system-prompt ...` | Arguments passed straight to the Claude Code CLI. `--allowedTools` is the v1 way to grant tools; the old `allowed_tools`, `max_turns`, `custom_instructions`, `direct_prompt` inputs are deprecated ([usage.md, Deprecated Inputs](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md)) |
| `settings` | `{"env":{"CHROMIUM_PATH":...}}` or `{}` | Claude Code settings JSON; `env` is how to hand environment variables to the Claude session ([configuration.md](https://github.com/anthropics/claude-code-action/blob/main/docs/configuration.md)) |

Tools allowed: `Read, Write, Edit, MultiEdit, Glob, Grep, LS, Bash, WebSearch, WebFetch, Skill, Task, TodoWrite`. Bash is off by default in the action and must be granted ([FAQ](https://github.com/anthropics/claude-code-action/blob/main/docs/faq.md)); it is granted in full here because skills run `node tools/project.js` and `node tools/build-deck.js`. The skill files under `.claude/skills/` are loaded from the checkout, the action does not need to know about them.

Other things the action does in automation mode that matter here:

- It does not check out the repo; `actions/checkout` must run first (every example in the docs does this).
- It configures `git user.name` and `user.email` for its bot identity and swaps the checkout credential for its own token ([src/modes/agent/index.ts](https://github.com/anthropics/claude-code-action/blob/main/src/modes/agent/index.ts), `configureGitAuth`). The runner's commit step sets its own identity and remote URL afterwards, so Claude's edits are committed by the workflow, not by the action.
- `workflow_dispatch`, `repository_dispatch` and `schedule` actors are not separately checked for write access, since GitHub already requires write access to dispatch and a schedule has no external actor ([security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)).

## Running a task by hand

Actions tab, "Claude runner", "Run workflow", fill `slug` and `task`, leave `hop` at 0. Or:

```
gh workflow run claude-runner.yml --ref main -f slug=immunotherapy-side-effects -f task=research.sources
```

With both fields empty the run takes the next ready task, same as the schedule. A manual run on a `failed` task re-runs it: the skill's `start` moves it to `running`, and `done` or `fail` settles it. The task must be on the project and owned by `claude`; the run stops with an error otherwise.

To re-run everything that is ready without waiting for the schedule, dispatch with no inputs; the chain takes it from there.

## Cost notes

- One task per run. Each run installs Node modules (cached by `setup-node`) and, for `slides`, downloads Chromium once per run. Runner minutes are roughly the Claude session length plus a minute of setup.
- `--max-turns 80` caps a runaway session. Research and synthesis skills use many turns; deck and package skills use few. Lower it in `claude_args` if bills surprise you.
- The 30-minute schedule costs almost nothing when idle: checkout, `npm ci` from cache, one Node script, exit. It never calls the API unless a task is ready.
- Scout runs on push also never call the API.
- `MAX_HOPS` (12) bounds how many tasks a single chain performs; the schedule continues past it. Set it lower to spread spend over time.
- A skill that ends without `done` or `fail` is marked failed by the runner, so a broken skill costs one run, not a loop.

## CI

`ci.yml` runs on every pull request and on pushes to any branch:

1. `npm ci`
2. `node tools/test.js`
3. `node tools/project.js validate`
4. `node tools/test-auth.js` if that file exists
5. Chromium install and `node tools/test-deck.js` if that file exists, with `CHROMIUM_PATH` set the same way the runner sets it

Steps 4 and 5 use `if: hashFiles('tools/<file>') != ''` so CI stays green until those tools land. Commits the runner pushes with `GITHUB_TOKEN` do not trigger CI either, for the reason above; CI covers human pushes and pull requests.

## Sources

- claude-code-action README: https://github.com/anthropics/claude-code-action
- action.yml (input names): https://github.com/anthropics/claude-code-action/blob/main/action.yml
- docs/usage.md (inputs table, deprecated inputs, `--allowedTools`): https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md
- docs/configuration.md (`claude_args`, `settings`, Bash off by default): https://github.com/anthropics/claude-code-action/blob/main/docs/configuration.md
- docs/custom-automations.md (automation mode with `prompt`): https://github.com/anthropics/claude-code-action/blob/main/docs/custom-automations.md
- docs/faq.md (`id-token: write`, `github_token` without the App, bots cannot re-trigger): https://github.com/anthropics/claude-code-action/blob/main/docs/faq.md
- docs/security.md (dispatch and schedule actor handling, App permissions): https://github.com/anthropics/claude-code-action/blob/main/docs/security.md
- docs/setup.md (secrets, App vs custom token): https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md
- docs/solutions.md (schedule + workflow_dispatch example with `fetch-depth: 0`): https://github.com/anthropics/claude-code-action/blob/main/docs/solutions.md
- src/github/context.ts (supported events): https://github.com/anthropics/claude-code-action/blob/main/src/github/context.ts
- src/github/validation/actor.ts (human-actor check, `allowed_bots`): https://github.com/anthropics/claude-code-action/blob/main/src/github/validation/actor.ts
- src/modes/agent/index.ts (git identity and credential handling): https://github.com/anthropics/claude-code-action/blob/main/src/modes/agent/index.ts
- GitHub Docs, GITHUB_TOKEN (events not re-triggered, dispatch exception): https://docs.github.com/en/actions/concepts/security/github_token
- GitHub Docs, events that trigger workflows (`workflow_dispatch`, `schedule`, `push` paths): https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows
- GitHub Docs, concurrency: https://docs.github.com/en/actions/using-jobs/using-concurrency
- GitHub REST, create a workflow dispatch event: https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event
- GitHub community, `actions: write` needed for dispatch with GITHUB_TOKEN: https://github.com/orgs/community/discussions/25702
- gh workflow run: https://cli.github.com/manual/gh_workflow_run
- Playwright browsers (`install --with-deps chromium`, `PLAYWRIGHT_BROWSERS_PATH`): https://playwright.dev/docs/browsers
