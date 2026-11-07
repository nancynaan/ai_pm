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

## Current Focus

Updated 2026-11-07. Read this before starting work in a new chat.

### Where we are

- **Done and pushed:** Phases 0–6 and a separate UI commit (`5cf0dbd` Phase 5, `5383ecd` Phase 6, `71d3899` UI). `main` is in sync with `origin/main`; nothing is uncommitted.
- **Next: Phase 7, backlog in Jira** (plan row 7 in `../docs/IMPLEMENTATION_PLAN.md`). Not started; run `/phase` and agree the plan with the user before writing code.
- **Write mode is live** (`ATLASSIAN_WRITE_MODE=live`, set by the user). Every publish writes to the real Confluence space `AIPMconf` and Jira project `AIPM`. Ask before any action that writes something new.
- **Demo run** `4b5ea878-fb47-48da-859a-73e8c2a1530c` (rewarded-menu-chest, title "Add a free gift chest to the main menu"): verdict Go, documents published live as FA-1 (Feature Brief v2 with the deck embedded, Requirements Specification, Estimation & Release Forecast, Roadmap Update Proposal, blocks on the Risk Register and Assumption Log), deck v1.1 attached to the Brief as `FA-1 Feature Proposal.pptx`. It waits in `awaiting_decision`. **Do not press Approve, Request changes or Decline without the user's OK**: Approve starts Phase 7's backlog stage. Its chat history was cleaned by hand to one block per step; keep it that way.

### Decisions made in Phases 5–6 and the UI work

- **Documents (stage 04):** five Scrum documents, not eleven: Feature Brief (the feature's page), Requirements Specification, Estimation & Release Forecast, a block per feature on the shared Risk Register and Assumption Log, and a Roadmap Update Proposal only when the roadmap changes. Business Value, Impact and Change Impact were folded into these; there is no traceability matrix (RTM) any more, by the user's decision. The client publishes with a button (state `awaiting_documents`); re-publishing rewrites the same pages, never duplicates. One pm-writer call writes all text, cached by its inputs; code renders every table and figure (`{{figure:key}}`).
- **Presentation (stage 05):** exactly three slides (business opportunity; solution & scope; delivery feasibility & recommendation), one presenter call, no story points client-facing, every slide marked preliminary and "not a delivery commitment". PPTX attached to and embedded in the Feature Brief, one versioned file. The documents step always continues to `presenting`, which reuses an unchanged deck.
- **Decision gate:** the question ("Here is the assessment summary…") comes before the decision card; `onDecision` writes the decision to the Brief and the Assumption Log block; a decline closes the draft Epic.
- **Chat:** exactly one block per step. Step events carry a key and a re-run rewrites them in place (see the pipeline engine's `CLAUDE.md`). The Documents card sits under the client's request.
- **Feature names:** the elicitation agent returns a short `title` (4–9 words, verb first) that intake saves as the feature's name; the Epic and Confluence pages keep `epicSummary`.
- **UI:** home page with only System status; feature screens with Chat / Analysis / Documents / Presentation tabs; gradient theme with light neumorphism; pinned chocolate navigation bar. Details in `apps/web/CLAUDE.md`.
- **Evals:** the user wants Claude calls kept low. Prefer one-agent evals (`writer-cli.js --run <id>`, `… --presenter`, one call each) over the full `/eval` (about 8 calls). A record/replay cache for the full eval was proposed but not built.

### What Phase 7 has to settle

- **No RTM:** the user dropped the traceability matrix. Keep the requirement coverage gate (every requirement covered by at least one story, from the story map's REQ codes) and store the Jira keys in the database; nothing is written back to an RTM page.
- **The Epic:** the demo run has no draft Epic (intake ran in dry-run), so the backlog stage must create the Epic if it is missing, not only complete it.
- **Stories:** the Requirements Specification's draft acceptance criteria become Gherkin per story; story-map items become stories and spikes with `AI estimate (SP)` (the team's Story Points stay empty), `Blocks` links, priority and labels; the Initial Product Backlog page gets the new Epic (the user asked for this to happen when stories go to Jira).
- **Chat and docs:** follow the one-block-per-step rule for the backlog cards; update BPMN model 06 (in `../docs/bpmn`, generated from `generator/processes.mjs`) once the design is agreed.

### Open, not urgent

- The full eval was not re-run after Phases 5–6 or the elicitation `title` change.

### Working notes

- The design docs (`../docs`) are outside the repository and are not committed; `PROJECT_STATUS.md` there has the full history.
- Read-only database checks: write the SQL to a file in the scratchpad and pipe it into `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'`; long inline `psql -c` commands are refused by the permission rules, and so is reading `node_modules`.
- In Node edit scripts, `$` in a `String.replace` replacement (`` $` ``, `$&`) is a special pattern and backslashes get lost in heredocs: prefer the Edit tool for code that contains template literals or regexes.
