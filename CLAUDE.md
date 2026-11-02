# CLAUDE.md

AI pipeline that does PM work for a Scrum game project (endless runner). A client describes a feature in a chat UI. The pipeline asks a short questionnaire, analyzes requirements, estimates effort, budget, value and risk, publishes PM documents to Confluence, presents the result to the client, and creates the Epic and user stories in Jira.

Design documents live **outside this repository**, in `../docs/`: BPMN models (`../docs/bpmn/viewer.html`) and `../docs/IMPLEMENTATION_PLAN.md`, which holds the phased delivery plan. Read the plan before starting a new phase.

## Layout

- `apps/server`: Node.js 24 + TypeScript (Fastify, Drizzle/PostgreSQL). `src/harness` (Phase 2+) orchestrates; `src/integrations` talks to Atlassian, Claude and SMTP; `src/api` exposes REST + SSE.
- `apps/web`: React + Vite UI.
- `packages/shared`: zod schemas and types used by both server and web.
- `agents/`: agent definitions (`*.agent.md`). `skills/`: knowledge packages (`<name>/SKILL.md`). `config/`: YAML settings (cadence, rates, rules).

## Rules

- **The harness owns the flow.** Stages run in deterministic TypeScript. Agents return JSON validated with zod and have no side effects.
- **No arithmetic in prompts.** Estimates, forecasts, budgets, ROI and verdicts are computed in code; agents supply judgements.
- **Atlassian writes only through `AtlassianGateway`**, idempotent, and honour `ATLASSIAN_WRITE_MODE=dry-run`. Agents get read-only tools scoped to the configured project and space.
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
docker compose up --build  # full stack: http://localhost:3000, Mailpit http://localhost:8025
```

## Status

Phase 0 (foundations) is done: workspaces, Docker Compose, config, database migrations, and the `/api/health` check for Postgres, Jira, Confluence, the Claude Code CLI login and SMTP. Next is Phase 1: the Atlassian gateway and the baseline seed.
