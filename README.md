# AI PM pipeline

An AI pipeline that does project-management work for a Scrum game project (an endless runner). A client describes a new feature in a chat UI, and the pipeline:

1. asks a short questionnaire with predefined answers;
2. analyzes and categorizes the requirements, conflicts, dependencies, assumptions and constraints;
3. estimates effort, release forecast, budget, business value/ROI and risks;
4. publishes the PM documents to Confluence;
5. shows the client a short presentation with charts;
6. after approval, creates the Epic, user stories, acceptance criteria and dependencies in Jira for Product Owner review.

It also emails the team before sprint events. Everything runs locally with Docker Compose, and all data is kept in PostgreSQL.

> **Status:** Phase 2 of 10. The pipeline runs end to end in the chat UI with placeholder stages; the real agents arrive in Phases 3–7.

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

3. Open <http://localhost:3000>. The status page checks PostgreSQL, Jira (sign-in and the Scrum project), Confluence, the Claude Code CLI login and email. "Not configured" means a value is missing in `.env`; the detail column says which.

The JSON report is at <http://localhost:3000/api/health>. Emails sent by the app appear in Mailpit at <http://localhost:8025>.

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

Open <http://localhost:3000>, describe a feature as the client and send it. The AI PM asks a short questionnaire, shows progress through the stages, and asks for your decision (approve, request changes or decline). Runs survive restarts: a stage that was cut off is retried when the app comes back. **System status** is the second tab.

To check that Claude works through your subscription, make one small real call:

```bash
docker compose exec app node apps/server/dist/agents/smoke-cli.js
```

## Development

```bash
npm install
docker compose up -d postgres mailpit   # database and mail inbox only
npm run dev                             # API on :3000 (tsx watch), UI on :5173 (Vite)
```

| Command                           | What it does                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `npm test`                        | Unit tests (Vitest)                                                                     |
| `npm run typecheck`               | TypeScript across all workspaces                                                        |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                       |
| `npm run build`                   | Build shared, server and web                                                            |
| `npm run db:generate`             | Create a migration after changing `apps/server/src/db/schema.ts`                        |
| `npm run db:migrate`              | Apply migrations without starting the server (the server also applies them at start-up) |
| `npm run seed`                    | Seed the demo project from your machine (add `-- --live` or `-- --sync-only`)           |

## Structure

```text
apps/server       Node.js + TypeScript API, harness, integrations (Fastify, Drizzle, PostgreSQL)
apps/web          React + Vite UI
packages/shared   zod schemas and types shared by server and web
agents/           agent definitions (one Markdown file per role)
skills/           knowledge packages used by the agents
config/           YAML settings: sprint cadence, feasibility rules
seed/baseline/    the demo project's baseline: data (YAML) and page texts (Markdown)
```

## Configuration notes

- **Database.** The app builds its connection from the `POSTGRES_*` values, so the password lives in one place. Inside Docker it reaches the `postgres` service; on your machine it uses `localhost:${POSTGRES_PORT}`.
- **Email.** With `SMTP_HOST` empty, every email goes to Mailpit. Set your provider's host, port, user and password to send real email.
- **Atlassian.** The pipeline talks to the Jira and Confluence REST APIs with Basic auth (email + API token). With `ATLASSIAN_WRITE_MODE=dry-run`, writes are logged but not sent.
- **Claude.** Each agent call runs `claude -p` (print mode) with no tools enabled and a JSON schema for the answer. The Docker image ships its own pinned copy of Claude Code, signed in with `CLAUDE_CODE_OAUTH_TOKEN`. When you run the server on your machine (`npm run dev`), it uses your existing Claude Code login; set `CLAUDE_CLI_PATH` if `claude` is not on your PATH.
