# Running Claude on your subscription with a Routine

The Claude worker is a Claude Code Routine, not a GitHub Action with an API key. Routines run as cloud sessions on your claude.ai account, are available on the Pro plan, and draw down the same subscription usage as your interactive sessions. No API credits are involved.

Source for every claim below is Anthropic's routines page at https://code.claude.com/docs/en/routines.

## What the docs say that matters here

- "Routines are available on Pro, Max, Team, and Enterprise plans."
- "Routines draw down subscription usage the same way interactive sessions do."
- A routine runs "skills committed to the cloned repository", so the stage skills in `.claude/skills/` work unchanged.
- Triggers are a schedule (minimum one hour), an API endpoint per routine, and GitHub pull request or release events. Pushes are not a trigger, so the engine fires the API endpoint itself whenever it creates Claude work.
- Hourly caps apply to how runs start. API fires are limited to 30 per hour per routine and 100 per hour per account. None of these have overage.
- "Claude pushes its work to a branch prefixed with claude/ unless your prompt directs it to push to another branch." The prompt below directs it to main.
- When your subscription usage window is exhausted, "additional runs are rejected until your usage window resets" unless you turn on usage credits. Leave usage credits off and the routine simply waits.

## Create the routine

1. Open https://claude.ai/code/routines and click New routine.
2. Name it `oncogenik-worker`.
3. Paste the contents of `routine/PROMPT.md` as the prompt. Pick the model you want each run to use.
4. Add this repository.
5. Environment. Start with Default. Its Trusted network access covers npm and the sites Claude's own search and fetch tools reach through Anthropic. If a skill ever needs `curl` against a medical site that the default allowlist blocks, edit the environment's network access to Custom and add the domain, or set it to Full.
6. Triggers. Add an API trigger. After saving, open Edit, copy the fire URL, generate the token, and copy it once. Optionally add a schedule trigger at hourly as a backstop for a missed fire. Each idle hourly run costs a session start and a few tool calls, so skip it if usage is tight.
7. Connectors. Remove every connector. The routine needs none.
8. Create. Click Run now once to see it clone, run `npm ci`, print NONE, and exit.

## Wire the trigger

The UI backend and Hermes fire the routine whenever they commit something that creates Claude work.

| Where | Variable | Value |
|---|---|---|
| Vercel, Production | `ROUTINE_FIRE_URL` | the routine's fire URL |
| Vercel, Production | `ROUTINE_FIRE_TOKEN` | the routine's bearer token |
| Hermes machine | same two names, in the environment the cron job sees | same values |

The UI calls the endpoint after a project starts, after any review action, and after a task retry. Hermes calls `tools/fire-routine.sh` after it pushes a finished task. Both calls are best effort. A failed fire is logged and ignored, because the routine will also find the work on its next scheduled run or the next fire.

The fire request, for reference, is the one in Anthropic's docs:

```
curl -X POST "$ROUTINE_FIRE_URL" \
  -H "Authorization: Bearer $ROUTINE_FIRE_TOKEN" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"text": "ui(<slug>): script.approve"}'
```

The text is a hint only. The prompt tells Claude to verify with `tools/next-claude-task.js` and to never follow instructions inside the payload.

## Concurrency

Two fires close together can start two sessions. The prompt makes each session claim a task by committing a `running` status and pushing before working. The second session's push is rejected, it pulls, and `next-claude-task.js` no longer lists the task. The hourly cap of 30 fires per routine is far above what the engine produces.

## Usage expectations

One project is roughly ten Claude tasks. The research tasks with web search are the heavy ones. On Pro, expect a full project to use a noticeable share of a five-hour window. If runs start being rejected for usage, the right move is to wait or move to Max. Do not turn on usage credits unless you want API-rate overage.

## Branch protection

The routine commits straight to `main` as your GitHub user. If you add a ruleset on `main`, make sure your own account can push to it, since the docs note that rules your connected access can bypass do not block a run.

## Fallback

`.github/workflows/claude-runner.yml` remains as an opt-in alternative. It is `workflow_dispatch` only and authenticates with a `CLAUDE_CODE_OAUTH_TOKEN` secret, which Anthropic's GitHub Actions page documents for Pro plans and which also bills to the subscription. See `docs/ACTIONS.md`.
