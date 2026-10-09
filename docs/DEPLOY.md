# Bringing OncoGenik live

Order of operations. Each step has its own doc with the details.

## 1. Merge to main

The Actions runner only fires on `main`, so the pull request has to land first. CI runs the state machine, auth, UI, and deck tests on every push.

## 2. The Claude worker, a Routine on your subscription

- Create the routine at claude.ai/code/routines with the prompt in `routine/PROMPT.md`, this repo, the Default environment, and an API trigger. Copy the fire URL and token. Full steps in `docs/ROUTINE.md`.
- No API key is involved. Runs draw from your Pro usage.
- Confirm the repo is private. Settings, General, Danger Zone shows visibility.

## 3. Vercel project

- Import this repo. Framework preset Other. The root `vercel.json` sets the build command and `dist` as the output.
- Create a fine-grained GitHub token with Contents read and write on this one repo. That token is the UI's only write path.
- Environment variables, scoped to Production:

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | the fine-grained token |
| `GITHUB_REPO` | `mtburbridge-creator/oncoscriptor` |
| `GITHUB_BRANCH` | `main` |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `RP_ID` | the hostname you will sign in at |
| `SETUP_TOKEN` | `openssl rand -hex 24`, temporary |
| `ROUTINE_FIRE_URL` | the routine's fire URL |
| `ROUTINE_FIRE_TOKEN` | the routine's bearer token |

- Deploy. Nobody can sign in yet because no passkey is enrolled.

## 4. Enroll the passkey

Open `/login?setup=1`, paste the setup token, approve the passkey prompt on your device, copy the JSON the page shows into a new `PASSKEY_CREDENTIAL` variable, delete `SETUP_TOKEN`, redeploy. Sign in at `/login`. Full walkthrough in `docs/AUTH.md`.

## 5. Hermes

Clone the repo on the Hermes machine with its own fine-grained token, copy `hermes/oncogenik-poll.py` into `~/.hermes/scripts/`, set `ROUTINE_FIRE_URL` and `ROUTINE_FIRE_TOKEN` in the environment the cron job sees, and create the cron job from `hermes/README.md`. The per-task runbook is `hermes/run-task.md`. This is the part marked draft; expect to tune it with Hermes.

## 6. Studio cutover

The Studio is served at `/backgenapp` on the new deployment. Repoint the markburbridge.com proxy to it, confirm it loads, then shutter the old background-generator project on Vercel.

## 7. First real project

Start one from the Ideas page. Watch the dashboard: the start commit fires the routine, and a new session appears at claude.ai/code/routines within a minute, and to "Hermes is working" for the forum and literature tasks once the cron job is live. The demo project in `projects/immunotherapy-side-effects/` shows what a finished one looks like.

## Daily use

- Start, review, approve, and decide in the UI. Every click is a commit.
- A failed task shows its error on the dashboard with a Retry button.
- Guideline proposals appear after a project finishes. Accept or reject them in the Guidelines area.
- To change the deck background, open `/backgenapp`, design it, use Copy settings, and paste the JSON into `guidelines/slideshow.settings.json` through the Guidelines editor or a commit.
