# CLAUDE.md

AI pipeline that does PM work for a Scrum game project (endless runner). A client describes a feature in a chat UI. The pipeline asks a short questionnaire, analyzes requirements, estimates effort, budget, value and risk, publishes PM documents to Confluence, presents the result to the client, and creates the Epic and user stories in Jira.

Design documents live **outside this repository**, in `../docs/`: BPMN models (`../docs/bpmn/viewer.html`) and `../docs/IMPLEMENTATION_PLAN.md`, which holds the phased delivery plan. Read the plan before starting a new phase.

## Layout

- `apps/server`: Node.js 24 + TypeScript (Fastify, Drizzle/PostgreSQL).
  - `src/harness` runs the pipeline: state machine (`states.ts`), orchestrator with per-run advisory locks, retries and usage-limit pauses, pg-boss stage jobs, event bus, and stage handlers (`stages/`, placeholders until Phases 3–7).
  - `src/agents` runs agents: `runner.ts` (claude -p with a JSON schema, repair loop, limit detection), `registry.ts` (agents/_.agent.md and skills/_/SKILL.md).
  - `src/integrations` talks to Atlassian (REST), Claude (CLI) and SMTP.
  - `src/render` turns one Markdown source into Confluence storage format and Jira ADF.
  - `src/sync` holds the idempotent publisher and the sync log.
  - `src/baseline` seeds the demo project and loads the baseline and digest into the database.
  - `src/api` exposes REST + SSE.
- `apps/web`: React + Vite UI.
- `packages/shared`: zod schemas and types used by both server and web.
- `seed/baseline`: the demo project (Comet Run) as YAML data and Markdown pages with `{{value|table|list:name}}` placeholders. Numbers live only in the YAML.
- `agents/`: agent definitions (`*.agent.md`). `skills/`: knowledge packages (`<name>/SKILL.md`). `config/`: YAML settings (cadence, rules).

## Rules

- **The harness owns the flow.** Stages run in deterministic TypeScript. Agents return JSON validated with zod and have no side effects.
- **No arithmetic in prompts.** Estimates, forecasts, budgets, ROI and verdicts are computed in code; agents supply judgements.
- **Atlassian writes only through the publisher** (`src/sync/publisher.ts`): idempotent via the sync log, unchanged payloads skipped, and nothing written in dry-run. In dry-run the gateway is created `readOnly`, which blocks every write request as a second safety net.
- **Secrets stay in `.env`.** Never log tokens or authorization headers, and never commit `.env`.
- **Claude runs through the Claude Code CLI on the user's Claude subscription. There is no Anthropic API key and no `@anthropic-ai/sdk`.** Agent calls spawn `claude -p` with `--tools ""` (no tools), `--json-schema`, `--output-format json` and `--model claude-opus-5-5`. The harness puts all Jira/Confluence context into the prompt, so agents never fetch anything themselves. Runs share the subscription's usage limits, so treat a "limit reached" answer as a pause, not a failure.

## Conventions

- ESM everywhere; relative imports end in `.js`. TypeScript strict, `verbatimModuleSyntax` (use `import type`).
- Validate external data (env, HTTP responses, LLM output) with zod at the boundary.
- Tests sit next to the code as `*.test.ts` (Vitest). Inject `fetch`, clocks and clients instead of mocking modules.

## Commands

```bash
npm install                # install all workspaces
npm run dev                # server (tsx watch) + web (Vite on :5173); needs Postgres: docker compose up -d postgres mailpit
npm test                   # Vitest
npm run typecheck          # tsc -b over all projects
npm run lint               # ESLint
npm run build              # shared → server → web
npm run db:generate        # new Drizzle migration after editing apps/server/src/db/schema.ts
npm run seed               # seed the demo project (dry-run; add -- --live to write, -- --sync-only to re-read)
docker compose up --build  # full stack: http://localhost:3000, Mailpit http://localhost:8025
```

## Status

- Phase 0 (foundations) is done: workspaces, Docker Compose, config, migrations, and `/api/health`.
- Phase 1 (Atlassian gateway and baseline seed) is done and seeded live.
- Phase 2 (harness core) is done: runs go intake → completed with placeholder stages, survive a crash (interrupted attempts are retried), and stream events to the chat UI. `node apps/server/dist/agents/smoke-cli.js` makes one real Claude call.
- Next is Phase 3: intake and analysis with real agents (draft Epic, elicitation and question bank, requirements and impact analysis).
