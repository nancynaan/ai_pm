# CLAUDE.md

AI pipeline that does PM work for a Scrum game project (endless runner). A client describes a feature in a chat UI. The pipeline asks a discovery questionnaire, analyzes requirements, estimates effort, budget, value and risk, publishes PM documents to Confluence, presents the result to the client, and creates the Epic and user stories in Jira.

Design documents live **inside this repository**, in `./docs/`: the delivery plan (`IMPLEMENTATION_PLAN.md`, read it before a new phase), the phase history (`PROJECT_STATUS.md`) and the BPMN models (`bpmn/viewer.html`).

Folders with their own `CLAUDE.md` (loaded when you work there): `apps/server/src/pipeline-engine`, `apps/web`, `agents`, `skills`, `config`.

## Layout

- `apps/server`: Node.js 24 + TypeScript (Fastify, Drizzle/PostgreSQL).
  - `src/pipeline-engine`: the pipeline (state machine, engine, stages, discovery, assessment, calculators).
  - `src/agents`: runs agents through `claude -p` (`runner.ts`) and loads their definitions (`registry.ts`, `schemas.ts`).
  - `src/integrations` (Atlassian REST, Claude CLI), `src/render` (Markdown → Confluence storage and Jira ADF), `src/sync` (idempotent publisher, sync log), `src/baseline` (demo project seed and digest), `src/api` (REST + SSE), `src/evals` (eval and demo CLIs).
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
npm test                   # Vitest (+ the e2e test when E2E_DATABASE_URL is set)
npm run smoke              # read-only live check of Jira/Confluence (also: docker compose exec app node apps/server/dist/evals/smoke-cli.js)
npm run typecheck          # tsc -b over all projects
npm run lint               # ESLint
npm run build              # shared → server → web
npm run dev                # server + web (Vite :5173); needs: docker compose up -d postgres
npm run db:generate        # migration after editing apps/server/src/db/schema.ts
npm run seed               # seed the demo project (dry-run; -- --live writes, -- --sync-only re-reads)
docker compose up --build  # full stack: app :3000, pgAdmin :5050
```

Slash commands: `/rebuild` (build, restart, health), `/eval` (in-memory eval, default `rewarded-menu-chest`), `/demo` (saved demo run through the API), `/phase` (start the next phase from the plan).

## Status

All phases are done (0–8). Phase 8 (hardening and demo): record/replay of Claude answers (`agents/cassette.ts`, `evals/cassettes/`), an end-to-end test of the whole pipeline in dry-run (`src/e2e`, approve and decline, real Postgres, fake read-only Atlassian), eval v2 graders in code (`evals/graders.ts`: requirement coverage, INVEST lint) with `--record`/`--replay`, the read-only live smoke test (`evals/smoke-cli.ts`), the Run log on System status, client text fenced for every agent (`CLIENT_TEXT_RULE`), wider log redaction, a fix for jobs dropped while the run lock was held, GitHub Actions CI, the README and `DEMO.md`. The wiring of every stage lives in `src/pipeline.ts` (`createPipeline`). One-agent evals (one Claude call each): `node apps/server/dist/evals/writer-cli.js --run <id>` (writer), `… --presenter` (presenter) and `node apps/server/dist/evals/backlog-cli.js --run <id>` (backlog builder plus a dry-run of the Jira write; `--show` prints the Epic and a story, `--fresh` ignores the cached draft). History and demo details: `./docs/PROJECT_STATUS.md`. Evals: run only `rewarded-menu-chest` by default; keep `double-jump` in the eval set without running it; others only on request (each feature costs ~10 Claude calls and ~400k tokens, the backlog builder included).

## Current Focus

Updated 2026-11-08. Read this before starting work in a new chat.

### Where we are

- **Done:** every phase (0–8); check `git log` for the Phase 8 commit. No further phase is planned.
- **Next: end-user documentation** (a user guide and README screenshots/GIF). Read `./docs/HANDOFF-documentation.md` first: scope, the runs to use for screenshots, and the rules (read only in the app; no Claude calls; ask before commits). The app itself is complete; the user tests it by hand ([DEMO.md](DEMO.md)). Both tasks are done (2026-11-09): [USER_GUIDE.md](USER_GUIDE.md), checked against the app and linked from the README, with 18 screenshots in `docs/images/` (13 of the app in the dark theme, 3 of the FA-1 pages in Confluence and 2 of Epic AIPM-28 in Jira, all captured by the user in Chrome; the Analysis tab is the README's hero image). Keep the file names if they are retaken: the guide and README link them. A GIF is optional and not made. `docs/` is in `.prettierignore` (the BPMN viewer is generated).
- **CI** (`.github/workflows/ci.yml`) runs lint, typecheck, tests with the e2e replay against a Postgres service, the build and a Docker build. A change that adds or reorders agent calls breaks the e2e replay: re-record `evals/cassettes/rewarded-menu-chest.json` (delete it, then `E2E_RECORD=1` with `E2E_DATABASE_URL`; Claude runs inside the app container, ~11 calls). Locally: `docker run -d --rm --name aipm-e2e-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 55432:5432 postgres:17-alpine`.
- **Write mode is live** (`ATLASSIAN_WRITE_MODE=live`, set by the user). Every publish writes to the real Confluence space `AIPMconf` and Jira project `AIPM`. Ask before any action that writes something new.
- **Demo run** `4b5ea878-fb47-48da-859a-73e8c2a1530c` (rewarded-menu-chest, title "Add a free gift chest to the main menu"): verdict Go, documents published live as FA-1 (Feature Brief v3 "… (AIPM-28)" with the deck embedded and the approval, Requirements Specification, Estimation & Release Forecast, Roadmap Update Proposal, blocks on the Risk Register, Assumption Log and Initial Product Backlog), deck v1.1 attached to the Brief as `FA-1 Feature Proposal.pptx`. **Approved live on 2026-11-07 and `completed`:** Epic AIPM-28 with Stories AIPM-29…AIPM-41 in Jira as an AI draft. Its chat history is one block per step; keep it that way. Re-running its backlog stage would only update the same issues, but ask first: it writes to Jira.

### Decisions made in Phases 5–6 and the UI work

- **Documents (stage 04):** five Scrum documents, not eleven: Feature Brief (the feature's page), Requirements Specification, Estimation & Release Forecast, a block per feature on the shared Risk Register and Assumption Log, and a Roadmap Update Proposal only when the roadmap changes. Business Value, Impact and Change Impact were folded into these; there is no traceability matrix (RTM) any more, by the user's decision. Since 2026-11-08: the client generates them with "Generate documents" (state `awaiting_documents`; "Skip for now" for any verdict) and the run goes on to the presentation; "Publish to Confluence" once, at any time, needed to approve; no re-publish. One pm-writer call writes all text, cached by its inputs; code renders every table and figure (`{{figure:key}}`).
- **Presentation (stage 05):** exactly three slides (business opportunity; solution & scope; delivery feasibility & recommendation), one presenter call, no story points client-facing, every slide marked preliminary and "not a delivery commitment". Publishing the PPTX to the Feature Brief (attached and embedded) is optional and once, possible after the documents are published; the decision never waits for it.
- **Decision gate:** the question ("Here is the assessment summary…") comes before the decision card; `onDecision` writes the decision to the Brief and the Assumption Log block if they are published; a decline closes the draft Epic.
- **Chat:** exactly one block per step. Step events carry a key and a re-run rewrites them in place (see the pipeline engine's `CLAUDE.md`). The Documents card sits under the client's request.
- **Feature names:** the elicitation agent returns a short `title` (4–9 words, verb first) that intake saves as the feature's name; the Epic and Confluence pages keep `epicSummary`.
- **UI:** home page with only System status; feature screens with Chat / Analysis / Documents / Presentation tabs; rippled blush background with light neumorphism; pinned dark slate navigation bar. Details in `apps/web/CLAUDE.md`.
- **Evals:** the user wants Claude calls kept low. Prefer one-agent evals (`writer-cli.js --run <id>`, `… --presenter`, one call each) over the full `/eval` (about 8 calls). A record/replay cache for the full eval was proposed but not built.

### Decisions made in Phase 7

- **Two decisions only:** Approve or Decline; "Request changes" is gone from code, UI, plan and BPMN. A decline records the decision on the Brief and the Assumption Log, closes the draft Epic and the conversation; the Backlog step turns red and the pill reads Declined. An approval ends in `completed`, shown as Approved with every step green.
- **The backlog is an AI draft, not a sprint plan:** Epic and Stories in To Do, label `ai-draft` (plus `ai-pm`, `fa-<n>`, and `enabler`/`nfr`/`spike`), no sprint, Story Points empty, `AI estimate (SP)` = PERT expected points, priority proposed by code (MoSCoW, +1 for starting points that unblock others) and marked "pending PO review", Gherkin acceptance criteria in the description. One backlog-builder call (cached in `backlog_sets`); code does every number.
- **Idempotent:** sync-log keys plus marker labels; a second run updates the same issues (an unchanged payload is skipped) and `Blocks` links are checked first. The Epic is created when intake left none.
- **Coverage gate:** every requirement except Won't has a story; Jira keys are stored in `backlog_items` (no RTM).
- **Confluence after Jira:** a block per feature on the Initial Product Backlog page; the documents are re-rendered (Epic key in the Brief title, Epic and backlog links, the approval).
- **No email at all:** the PO notification email, the sprint reminders (former Phase 8, BPMN 07) and the Mailpit/SMTP plumbing were removed by the user's decision (2026-11-07).

### Decisions made after the live demo (2026-11-08)

- **Waiting placeholders:** while a step works, the chat shows a "please wait" card where its result will appear (`Waiting.tsx`); the documents step waits on the Documents card itself.
- **Documents:** "Generate documents" (green) and "Publish to Confluence" (grey until generated, then green; a 10 px "Required to approve" under it); each button disappears once its step is done (no re-generation, no re-publish). A Preview column. "Skip for now" for any verdict (no note under the card any more). **Approve needs the documents published:** the Approve button is locked with the hint "Publish the documents to proceed.", and a click gets a chat message (`decision.blocked`) to generate and publish them, or only publish; a client who skipped can still generate them at the decision (`awaiting_decision → documenting → awaiting_decision`, request key `documents.request.late`, the Documents card moves under it). Decline needs no documents.
- **Deck:** "Publish to Confluence" on the Proposal card replaces "Open in Confluence": greyed out until the documents are published, then once, with an "Optional" note; it disappears after the publish and the Confluence link shows. View slides and Download PPTX (both white) stay; the buttons sit on the right. The decision never waits for the deck.
- One publish lock per run (`pipeline-engine/publishing.ts`) serialises every page write.

### Decisions made in Phase 8

- **No scripted live demo:** the user runs the live demo by hand as the client; `DEMO.md` is their script. The smoke test is read only.
- **Evals:** graders in code only, no LLM judge (keeps Claude calls low). The e2e cassette is the one recording CI needs; record eval cassettes only on request.
- **Run log** on the System status page (numbers only: steps, time, calls, tokens, repairs, pauses), from `GET /api/runs/:id/log`.
- **CI** on push and pull requests to `main`; it never talks to Atlassian or Claude and needs no secrets.

### Open, not urgent

- Eval v2 on 2026-11-08: rewarded-menu-chest gave Go with conditions (a roadmap conflict) instead of Go; every other grader passed. The eval reads the live Jira backlog, which now holds the approved chest Epic AIPM-28; the e2e recording against the seed backlog gave Go. Likely a fair call, not a regression; re-run only if prompts change again.

- `npm audit --omit=dev`: `image-size` (high, DoS on crafted images) inside `pptxgenjs`; not reachable (the deck adds no client images), the fix is a major version change. Documented in the README.
- The Epic of FA-1 (AIPM-28) would get one update on a re-run: its description lists the documents by title, and the Brief was renamed "… (AIPM-28)" after the Epic was written. Harmless; the smoke test shows it as one WARN.

### Working notes

- The design docs (`./docs`) are inside the repository and are committed; `PROJECT_STATUS.md` there has the full history.
- Read-only database checks: write the SQL to a file in the scratchpad and pipe it into `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'`; long inline `psql -c` commands are refused by the permission rules, and so is reading `node_modules`.
- In Node edit scripts, `$` in a `String.replace` replacement (`` $` ``, `$&`) is a special pattern and backslashes get lost in heredocs: prefer the Edit tool for code that contains template literals or regexes.
