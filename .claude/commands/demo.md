---
description: Create a saved demo run of a sample feature through the app's API
argument-hint: '<feature id>'
---

Create a saved demo run for: `$ARGUMENTS` (required; ask which feature if empty).

1. Check the database first (`GET http://localhost:3000/api/runs`): if a run for this feature already exists, say so and ask before creating another one.
2. A demo run makes real Claude calls (about 7 calls, 6–8 minutes, ~200k tokens). Confirm the app image is current.
3. Run in the background: `docker compose exec app node apps/server/dist/evals/demo-cli.js --only $ARGUMENTS`. It plays the client from `evals/features.yaml` and stops at the client's decision step.
4. Report the run id, the verdict and the key figures from `GET /api/runs/<id>/assessment`, and the links `http://localhost:3000/#/runs/<id>` and `http://localhost:3000/#/analysis/<id>`.
