# OncoGenik working rules

## Git workflow for development work

- Work on a feature branch, never directly on `main`.
- After every significant completed step, commit, push the branch, open a pull request, and merge it into `main` once CI is green.
- `main` is what Vercel deploys, so unmerged work never reaches https://oncoscriptor.vercel.app.

The Claude routine in `routine/PROMPT.md` is the exception. It commits project state straight to `main` by design, because that state is data, not code.

## Before pushing

Run the fast checks.

```
node tools/test.js && node tools/test-auth.js && node tools/test-ui.js && node tools/test-routine.js && node tools/test-router.js && node tools/project.js validate
```

`node tools/test-deck.js` needs Chromium and takes longer. Run it when touching the deck tool or the Studio.

## Where things are

`README.md` maps the docs. `docs/ENGINE_DESIGN.md` is the architecture and build status. `docs/DEPLOY.md` is the go-live order.

## Vercel limits

The Hobby plan deploys at most 12 serverless functions. All API routes go through `api/router.js`. Add new endpoints as handler modules in an underscore folder and register them in the router's table, never as new files directly under `api/`.
