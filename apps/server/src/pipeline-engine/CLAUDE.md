# Pipeline engine

Loaded when working in `apps/server/src/pipeline-engine`. The product's pipeline: deterministic TypeScript that runs the stages; agents only give judgements.

## Map

- `stages.ts`: run states and allowed transitions (the state machine). `engine.ts`: `createPipelineEngine` runs each active state as a pg-boss job under a per-run advisory lock, records attempts in `stage_executions`, retries failures (3 attempts with backoff), pauses on the Claude usage limit, and handles client actions (answers, discovery decision, decision, retry). `queue.ts`, `events.ts`, `repository.ts`: jobs, SSE events, database access.
- `stages/`: one handler per stage (`intake`, `eliciting` = discovery, `analyzing`, `estimating`). `placeholder.ts` still covers documents, presentation and backlog until Phases 5–7. `prompts.ts`: shared prompt helpers.
- `discovery.ts` + `discovery-config.ts`: the fixed questionnaire (`config/discovery.yaml`), submission checks, completeness rules and the Discovery Completeness Report.
- `assessment.ts` + `assessment-config.ts` + `calculators/`: the Phase 4 assessment (`config/feasibility-rules.yaml`).
- `services.ts` (what stages may use), `context.ts` (baseline and Jira context), `analysis-repository.ts` (analysis and assessment persistence), `magnitude.ts` (change-magnitude rule).

## Rules

- **A stage handler** gets a `StageContext`, may call agents only through `services.ask` and data only through `services`/`ctx.repo`, emits events with `ctx.emit`, and returns `{ next, output }`. `next` must be an allowed transition in `stages.ts`; add new states there first. Register the handler in `apps/server/src/index.ts`.
- **No arithmetic in prompts.** Every number comes from `calculators/` (pure functions). Agents give story points, ratings and KPI effects; code turns them into dates, money and verdicts. Keep calculators free of I/O and seed every random draw (`seededRng(seedFrom(runId))`).
- **Discovery:** rules in code decide coverage, contradictions, gaps, evidence and readiness; the discovery-review agent only adds what rules cannot see. Information is labelled confirmed, client assumption, AI hypothesis or missing; missing or unproven information never becomes a fact. Confidence is "low" only for blocking issues, critical gaps or 4+ questions the client left open.
- **Assessment:** the forecast never runs faster than the busiest discipline (a "bottleneck" is planning information, not a condition); contingency = Σ risk EMV capped at 30 % of labour P50; a plain Go has no conditions (the team re-estimate is a standard next step); an incomplete discovery makes every verdict preliminary.
- Settings and thresholds belong in `config/*.yaml` (validated by a strict zod schema at startup), not in code.

## Tests

Stage tests use fake repositories and services (see `stages/stages.test.ts`, `stages/estimating.test.ts`); the engine test uses in-memory stand-ins for Postgres, the lock and pg-boss (`engine.test.ts`). Calculators are tested with fixed seeds and hand-checked numbers (`calculators/calculators.test.ts`). A change to prompts, skills or rules is checked with the eval (`/eval`), not only unit tests.
