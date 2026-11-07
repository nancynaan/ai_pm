---
description: Rebuild and restart the app container, then check its health
---

Rebuild and verify the running app:

1. Run `docker compose up -d --build app` from the repository root.
2. Wait until `http://localhost:3000/api/health/live` answers (retry for up to two minutes).
3. Read `http://localhost:3000/api/health` and report each check (database, jira, jira_project, confluence, claude) with its status. Report anything that is not `ok`, with its detail.
4. If the app does not come up, show the last 30 lines of `docker compose logs app`.

Do not run evals or demo runs as part of this.
