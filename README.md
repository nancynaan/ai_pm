# AI PM pipeline

An AI pipeline that does project-management work for a Scrum game project (an endless runner). A client describes a new feature in a chat UI, and the pipeline:

1. asks a short questionnaire with predefined answers;
2. analyzes and categorizes the requirements, conflicts, dependencies, assumptions and constraints;
3. estimates effort, release forecast, budget, business value/ROI and risks;
4. publishes the PM documents to Confluence;
5. shows the client a short presentation with charts;
6. after approval, creates the Epic, user stories, acceptance criteria and dependencies in Jira as a draft for Product Owner review.

Everything runs locally with Docker Compose, and all data is kept in PostgreSQL.

> **Status:** all phases are done (0–8). Every stage, from intake to the backlog in Jira, runs with real Claude agents; CI runs the whole pipeline end to end on recorded Claude answers. To walk through it as the client, follow the [demo script](DEMO.md).

## Prerequisites

- Docker Desktop
- Node.js 24 (only for development outside Docker)
- An Atlassian Cloud site (the free plan is fine) with:
  - a **company-managed Scrum** Jira project (the project sidebar says "company-managed project"; create one with _Projects → Create project → Scrum → company-managed_ if needed);
  - a Confluence space;
  - a classic **API token** from <https://id.atlassian.com/manage-profile/security/api-tokens> ("Create API token", not "with scopes"). Tokens expire after at most a year.
- A **Claude subscription** (Pro or Max) and [Claude Code](https://code.claude.com) installed on your machine. The pipeline calls Claude through the Claude Code CLI on your subscription; there is no Anthropic API key. Pipeline runs share your subscription's usage limits with anything else you run in Claude Code.

## Quick start

1. Create your configuration:

   ```bash
   cp .env.example .env
   ```

   Fill in the `ATLASSIAN_*` values, `JIRA_PROJECT_KEY`, `CONFLUENCE_SPACE_KEY`, and a `POSTGRES_PASSWORD`. Leave `ATLASSIAN_WRITE_MODE=dry-run` until you want real writes.

   For Claude, create a long-lived login token for the Docker container. It opens a browser to sign in with your Claude account:

   ```bash
   claude setup-token
   ```

   Paste the printed token into `.env` as `CLAUDE_CODE_OAUTH_TOKEN`.

2. Start the stack:

   ```bash
   docker compose up --build -d
   ```

3. Open <http://localhost:3000>. The status page checks PostgreSQL, Jira (sign-in and the Scrum project), Confluence, and the Claude Code CLI login. "Not configured" means a value is missing in `.env`; the detail column says which.

The JSON report is at <http://localhost:3000/api/health>.

To explore the database, open pgAdmin at <http://localhost:5050>. It runs in desktop mode (no pgAdmin login, reachable only from this machine) and has the project database registered as **AI PM (local)**, connected with the user and password from `.env`. The pipeline's progress lives in `pipeline_runs` (current state), `stage_executions` (one row per stage attempt), `run_events` (the chat), `llm_calls`, `questionnaires` and `assessments`. Desktop clients such as DBeaver can connect to `127.0.0.1:5432` instead.

After editing `.env`, recreate the app container so it picks up the new values:

```bash
docker compose up -d app
```

## Seeding the demo project

The pipeline needs an existing project to work on. The seed creates one for a fictional endless runner, **Comet Run**, from the files in [seed/baseline](seed/baseline):

- the custom field **AI estimate (SP)**, placed on the project's screens;
- 14 Jira components (one per game component);
- 5 epics and 22 stories with story points, acceptance criteria and statuses;
- 12 Confluence pages: Business Case, Project Charter, Stakeholder Register, Assumption Log, Game Design Document, Definition of Done, Product Roadmap, Risk Register, Architecture Overview, Team & Velocity and Initial Product Backlog, under a "Comet Run: Project Baseline" page;
- the baseline and a digest for the agents, in the database.

First run it as a dry-run. It only reads from your site and prints what it would create or change:

```bash
docker compose exec app node apps/server/dist/baseline/cli.js
```

Then write it for real:

```bash
docker compose exec app node apps/server/dist/baseline/cli.js --live
```

Running it again is safe. Everything is matched to what exists (by sync log, issue label or page title), so nothing is duplicated, and unchanged content is not rewritten, so edits you make in Jira or Confluence survive. After editing baseline pages in Confluence, re-read them into the database:

```bash
docker compose exec app node apps/server/dist/baseline/cli.js --sync-only
```

The status page lists the baseline documents with links to Confluence.

## Using the chat

Open <http://localhost:3000>, describe a feature as the client and send it. The AI PM:

1. asks a discovery questionnaire (and a clarification round if something is unclear or contradictory);
2. analyzes and assesses the feature; the figures and charts are on the **Analysis** tab;
3. waits for you to press **Generate documents** on the Documents card (or **Skip for now**, for any verdict), shows them with previews and moves on by itself; **Publish to Confluence** works once, at any time, and is needed to approve;
4. shows a three-slide proposal (**Presentation** tab, PPTX download; publishing it to the Feature Brief is optional, once the documents are published);
5. asks for your decision: **Approve** or **Decline**. Approve needs the documents published (the button is locked until then, and the chat says what is missing); Decline does not.

On Approve, the Epic and one story per story-map item go to Jira as an AI draft for the Product Owner: To Do, label `ai-draft`, no sprint, Story Points empty, a proposed priority and an `AI estimate (SP)`. The Initial Product Backlog page gets the feature's block, and a **Backlog** tab appears. On Decline, the decision is recorded on the Feature Brief and the Assumption Log and the draft Epic is closed. Either way the conversation then closes.

Runs survive restarts: a stage that was cut off is retried when the app comes back, and a Claude usage limit pauses the run until it resets. With `ATLASSIAN_WRITE_MODE=live`, intake also creates a draft Epic in Jira (labels `ai-pm`, `ai-pm-draft`). One feature takes about 15–20 minutes of Claude time in total and roughly 10–12 Opus calls on your subscription.

**System status** (the button on the home page) shows the health checks, the project baseline, and the **Run log**: each feature's steps with their duration, outcome and Claude calls (tokens, repairs, usage-limit pauses), from `stage_executions` and `llm_calls`.

To check that Claude works through your subscription, make one small real call:

```bash
docker compose exec app node apps/server/dist/agents/smoke-cli.js
```

## Evals

[evals/features.yaml](evals/features.yaml) holds sample feature requests with a client answer profile and what a good result looks like (change magnitude, discovery result, verdict). The eval runs each one through the real stages up to the backlog builder, writes nothing to Jira or Confluence, and grades the result in code: magnitude, discovery, verdict, the document validator (every figure matches the assessment), requirement coverage by stories (100 %) and an INVEST lint of the stories. There is no LLM judge.

```bash
docker compose exec app node apps/server/dist/evals/cli.js --only rewarded-menu-chest   # ~11 Claude calls
docker compose exec app node apps/server/dist/evals/cli.js --only rewarded-menu-chest --record
docker compose exec app node apps/server/dist/evals/cli.js --only rewarded-menu-chest --replay
```

`--record` keeps Claude's answers in `evals/cassettes/eval-<feature>.json` (only answers not recorded yet are fetched); `--replay` re-runs the stages and graders on them with no Claude call. Cheaper checks of one agent on a saved run: `apps/server/dist/evals/writer-cli.js --run <id>` (pm-writer, `--presenter` for the presenter) and `apps/server/dist/evals/backlog-cli.js --run <id>` (backlog builder and a dry-run of the Jira write).

## Testing and CI

- `npm test` runs the unit tests and, when `E2E_DATABASE_URL` points at a Postgres server, the **end-to-end test** ([apps/server/src/e2e](apps/server/src/e2e)): the whole pipeline as the app wires it, played by the client from `evals/features.yaml`, with Claude's answers replayed from [evals/cassettes/rewarded-menu-chest.json](evals/cassettes) and a fake read-only Atlassian site. One run is approved (documents, deck and an AI-draft backlog planned in dry-run, every requirement covered, INVEST lint clean, one chat block per step), a second is declined; nothing is written and no Claude call is made. It creates and drops its own database.

  ```bash
  docker run -d --rm --name aipm-e2e-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 55432:5432 postgres:17-alpine
  E2E_DATABASE_URL=postgres://e2e:e2e@localhost:55432/postgres npm test
  ```

  After a change to prompts or stages, re-record the cassette (delete it first, then `E2E_RECORD=1`; Claude runs inside the app container, about 11 calls).

- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs lint, typecheck, the tests with the end-to-end test against a Postgres service, the build and a Docker build on every push and pull request to `main`. It needs no secrets: it never talks to Atlassian or Claude.
- **Live smoke test**, read only, against your real site: the health checks, the baseline pages, and a dry-run of every published feature that reports what a re-publish would change in Confluence and Jira. Nothing is written and no Claude call is made.

  ```bash
  docker compose exec app node apps/server/dist/evals/smoke-cli.js
  ```

## Development

```bash
npm install
docker compose up -d postgres   # database only
npm run dev                     # API on :3000 (tsx watch), UI on :5173 (Vite)
```

| Command                           | What it does                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `npm test`                        | Unit tests (Vitest), plus the end-to-end test when `E2E_DATABASE_URL` is set            |
| `npm run smoke`                   | The read-only live smoke test from your machine                                         |
| `npm run typecheck`               | TypeScript across all workspaces                                                        |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                       |
| `npm run build`                   | Build shared, server and web                                                            |
| `npm run db:generate`             | Create a migration after changing `apps/server/src/db/schema.ts`                        |
| `npm run db:migrate`              | Apply migrations without starting the server (the server also applies them at start-up) |
| `npm run seed`                    | Seed the demo project from your machine (add `-- --live` or `-- --sync-only`)           |

## Structure

```text
apps/server       Node.js + TypeScript API, pipeline engine, integrations (Fastify, Drizzle, PostgreSQL)
apps/web          React + Vite UI
packages/shared   zod schemas and types shared by server and web
agents/           agent definitions (one Markdown file per role)
skills/           knowledge packages used by the agents
config/           YAML settings: discovery questionnaire, feasibility rules
seed/baseline/    the demo project's baseline: data (YAML) and page texts (Markdown)
evals/            sample feature requests with client answer profiles; cassettes/ holds recorded
                  Claude answers for the end-to-end test and `--replay` evals
.github/          CI workflow (lint, typecheck, tests with the end-to-end test, build, Docker build)
.claude/          Claude Code development harness: permissions, hooks (session status, format on edit,
                  quality gate) and slash commands (/rebuild, /eval, /demo, /phase)
```

The pipeline itself is in `apps/server/src/pipeline-engine`: `stages.ts` (states and transitions), `engine.ts` (the pipeline engine that runs the stage jobs), `stages/` (one handler per stage) and `calculators/` (estimates, forecast, budget, value, verdict).

## Configuration notes

- **Database.** The app builds its connection from the `POSTGRES_*` values, so the password lives in one place. Inside Docker it reaches the `postgres` service; on your machine it uses `localhost:${POSTGRES_PORT}`.
- **Atlassian.** The pipeline talks to the Jira and Confluence REST APIs with Basic auth (email + API token). With `ATLASSIAN_WRITE_MODE=dry-run`, writes are logged but not sent.
- **Claude.** Each agent call runs `claude -p` (print mode) with no tools enabled and a JSON schema for the answer. The Docker image ships its own pinned copy of Claude Code, signed in with `CLAUDE_CODE_OAUTH_TOKEN`. When you run the server on your machine (`npm run dev`), it uses your existing Claude Code login; set `CLAUDE_CLI_PATH` if `claude` is not on your PATH.

## Security

- **Secrets** live only in `.env`, which is git-ignored, docker-ignored and never baked into the image. The logs redact the auth header, cookies, the Atlassian and Claude tokens, the database password and URL; prompts and answers are never logged (the Run log shows numbers only). The app container runs as the unprivileged `node` user.
- **Agents have no tools and no side effects**: every call runs with `--tools ""` and returns JSON that is validated with zod. Only the pipeline engine writes, through the idempotent publisher; in dry-run the Atlassian gateway also refuses every write.
- **Client text is data.** The client's request, answer details and comments reach the agents only inside `<client_request>` / `<client_text>` tags, and every agent's system prompt says to treat them as data, never as instructions. Numbers never come from the agents: code computes every estimate, date, budget and verdict.
- **Rendering.** Markdown in the UI is rendered as React elements (no raw HTML); chat links are `https://` only; Confluence storage and Jira ADF escape all text.
- **No authentication.** The app is meant for one person on a local machine: the API and UI have no login, so do not expose port 3000 beyond `localhost`.
- **Dependencies.** `npm audit --omit=dev` reports `image-size` (a denial of service on crafted JXL/HEIF/ICNS images) inside `pptxgenjs`. The deck adds no images from clients, so it cannot be reached; the suggested fix is a major-version change of `pptxgenjs`.
