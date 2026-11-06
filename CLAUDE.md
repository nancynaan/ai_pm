# CLAUDE.md

AI pipeline that does PM work for a Scrum game project (endless runner). A client describes a feature in a chat UI. The pipeline asks a discovery questionnaire, analyzes requirements, estimates effort, budget, value and risk, publishes PM documents to Confluence, presents the result to the client, and creates the Epic and user stories in Jira.

Design documents live **outside this repository**, in `../docs/`: the delivery plan (`IMPLEMENTATION_PLAN.md`, read it before a new phase), the phase history (`PROJECT_STATUS.md`) and the BPMN models (`bpmn/viewer.html`).

Folders with their own `CLAUDE.md` (loaded when you work there): `apps/server/src/pipeline-engine`, `apps/web`, `agents`, `skills`, `config`.

## Layout

- `apps/server`: Node.js 24 + TypeScript (Fastify, Drizzle/PostgreSQL).
  - `src/pipeline-engine`: the pipeline (state machine, engine, stages, discovery, assessment, calculators).
  - `src/agents`: runs agents through `claude -p` (`runner.ts`) and loads their definitions (`registry.ts`, `schemas.ts`).
  - `src/integrations` (Atlassian REST, Claude CLI, SMTP), `src/render` (Markdown → Confluence storage and Jira ADF), `src/sync` (idempotent publisher, sync log), `src/baseline` (demo project seed and digest), `src/api` (REST + SSE), `src/evals` (eval and demo CLIs).
- `apps/web`: React + Vite UI. `packages/shared`: zod schemas and types for server and web.
- `seed/baseline`: the demo project (Comet Run): YAML data and Markdown pages. Numbers live only in the YAML.
- `agents/`, `skills/`: the product's runtime AI roles and their knowledge. `config/`: YAML settings. `evals/features.yaml`: sample features with client answer profiles.
- `.claude/`: the development harness for Claude Code (not the product): permissions, hooks (format on edit; quality gate at the end of a turn; session status at start) and slash commands. Personal overrides go in `.claude/settings.local.json` (git-ignored). Start Claude Code in this folder so it loads.

## Rules

- **The pipeline engine owns the flow.** Stages run in deterministic TypeScript; agents return JSON validated with zod and have no side effects.
- **No arithmetic in prompts.** Estimates, forecasts, budgets, ROI and verdicts are computed in code; agents supply judgements.
- **Assess only a verified discovery.** Blocking contradictions and critical gaps stop the pipeline; missing or unproven information never becomes a fact; estimates stay preliminary until the development team validates them.
- **Atlassian writes only through the publisher** (`src/sync/publisher.ts`): idempotent, nothing written in dry-run (the gateway is then `readOnly` too). Live writes only after a dry-run and the user's go-ahead.
- **Secrets stay in `.env`.** Never read, log or commit it.
- **Claude runs through the Claude Code CLI on the user's subscription; no Anthropic API key, no `@anthropic-ai/sdk`.** Agent calls run `claude -p` with `--tools ""`, `--json-schema`, `--output-format json`, `--model claude-opus-5-5`. A usage-limit answer is a pause, not a failure.
- **Commit and push once per phase**, after verification and the user's OK.

## Conventions

- ESM everywhere; relative imports end in `.js`. TypeScript strict, `verbatimModuleSyntax` (use `import type`). Kebab-case file names.
- Validate external data (env, HTTP responses, LLM output, YAML) with zod at the boundary.
- Tests sit next to the code as `*.test.ts` (Vitest). Inject `fetch`, clocks and clients instead of mocking modules.

## Commands

```bash
npm test                   # Vitest
npm run typecheck          # tsc -b over all projects
npm run lint               # ESLint
npm run build              # shared → server → web
npm run dev                # server + web (Vite :5173); needs: docker compose up -d postgres mailpit
npm run db:generate        # migration after editing apps/server/src/db/schema.ts
npm run seed               # seed the demo project (dry-run; -- --live writes, -- --sync-only re-reads)
docker compose up --build  # full stack: app :3000, Mailpit :8025, pgAdmin :5050
```

Slash commands: `/rebuild` (build, restart, health), `/eval` (in-memory eval, default `rewarded-menu-chest`), `/demo` (saved demo run through the API), `/phase` (start the next phase from the plan).

## Status

Phases 0–6 are done (Phase 6: three-slide client deck, PPTX on the Feature Brief, decision gate with the Decision Log; demo run deck v1.1 live). Next is Phase 7: backlog in Jira. One-agent evals (one Claude call each): `node apps/server/dist/evals/writer-cli.js --run <id>` (writer) and `… --presenter` (presenter). History and demo details: `../docs/PROJECT_STATUS.md`. Evals: run only `rewarded-menu-chest` by default; keep `double-jump` in the eval set without running it; others only on request (each feature costs ~7 Claude calls and 150–230k tokens).
