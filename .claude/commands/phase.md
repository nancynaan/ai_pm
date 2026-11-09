---
description: Start the next delivery phase from the implementation plan
argument-hint: '[phase number]'
---

Start phase `$ARGUMENTS` (if empty: the next phase named in the Status section of `CLAUDE.md`).

1. Read `./docs/IMPLEMENTATION_PLAN.md` (the phase's row in "Delivery plan" and every section it refers to) and `./docs/PROJECT_STATUS.md`.
2. Read the code the phase builds on, then describe the plan to the user: what will be built, which stages, agents, skills, config and UI parts change, what the "done when" criteria are, and any decision the user must make. Wait for the user's go-ahead before writing code.
3. Build it with tests next to the code. Numbers come from calculators in code, never from prompts. Keep Atlassian writes in dry-run.
4. Verify: typecheck, lint, tests, rebuild (`/rebuild`), and a check in the browser for UI work. Run `/eval` only when prompts, skills or rules changed, and only with the default feature.
5. Update `CLAUDE.md` (Status line), the relevant scoped `CLAUDE.md`, `./docs/PROJECT_STATUS.md` and the plan if the design changed. Then ask before committing and pushing: one commit per phase.
