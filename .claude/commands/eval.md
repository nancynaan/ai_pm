---
description: Run the in-memory eval (default rewarded-menu-chest) and report the results
argument-hint: '[feature ids, comma-separated]'
---

Run the eval for: `$ARGUMENTS` (if empty, use `rewarded-menu-chest`; never add `double-jump` or other features unless named here).

1. The eval runs real Claude calls on the user's subscription (about 7 calls, 5–8 minutes and 150–230k tokens per feature). Say how many features will run before starting.
2. Make sure the app image is current (rebuild with `docker compose up -d --build app` if code, agents, skills or config changed since the last build).
3. Run in the background: `docker compose exec app node apps/server/dist/evals/cli.js --only <ids>`.
4. When it finishes, report per feature: PASS/FAIL, change magnitude vs expected, discovery result and confidence, verdict vs expected, cost at P85, and any conditions. For a FAIL, explain which expectation failed and why, using the printed rationales.
5. If it stops at the Claude usage limit, say so and stop; the user re-runs it after the reset.

The eval saves nothing to the database or Jira.
