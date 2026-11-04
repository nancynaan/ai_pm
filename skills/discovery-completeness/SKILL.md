---
name: discovery-completeness
description: How to verify that a client's discovery answers are complete and consistent before any assessment, how to classify information by how trustworthy it is, and when to stop and ask instead of assuming.
---

## Purpose

The assessment (business value, requirements, risks, estimates, backlog) may only start from a verified discovery. This review produces the Discovery Completeness Report: what is known, what is believed, what is guessed, what is missing, and whether the pipeline may go on.

## Discovery areas

| Area                   | Must answer                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| Business justification | Why the feature matters, which outcome the client expects, the evidence |
| Product context        | Who the feature is for and which problem it solves for them             |
| Scope                  | What the client expects in the first release, how success is judged     |
| Feasibility            | Priority and timing, budget, capacity, dependencies, limitations        |
| Decision readiness     | Whether the client can approve the scope and the investment             |

## Information kinds

Every piece of information has exactly one kind. Never upgrade a kind.

| Kind                | Meaning                                                              | Example                                                            |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `confirmed`         | The client stated a fact about their situation or decision           | "Priority: high, next planned release"                             |
| `client_assumption` | The client expects or believes it, but it is not proven              | "Expected outcome: better D7 retention", "players will love it"    |
| `ai_hypothesis`     | You inferred it; the development team or the client must validate it | "Rewards reuse the existing wallet", "a streak needs a save field" |
| `missing`           | Unknown, and it matters for the assessment                           | "No success criteria", "no budget limit known"                     |

Rules:

- **Missing is not confirmed.** "Not yet determined", "No supporting evidence yet" or an unanswered point never becomes a positive statement. If the client has no evidence, "the feature will increase retention" is an **unvalidated business hypothesis**, recorded as a `client_hypothesis` assumption, never a fact or a requirement.
- Expected outcomes and success effects are always `client_assumption`, even with evidence; evidence makes them credible, not certain.
- Your own inferences are always `ai_hypothesis`, however obvious.
- **The client does not set technical estimates.** Use the client's expectations, constraints and outcomes as inputs; effort, schedule and cost come later from the baseline and the team, and stay preliminary until the development team validates them.

## Contradictions

A contradiction is two statements that cannot both hold, or that make a recommendation impossible:

- urgency vs. flexibility: "critical" priority with a flexible timeline, or a fixed date with a low priority;
- money vs. ambition: a fixed budget and limited capacity with a critical date or a large first release;
- description vs. answers: "just a new skin" but backend changes in scope; "offline" but a live leaderboard;
- outcome vs. success: revenue expected but not measured;
- authority vs. urgency: critical, but nobody can approve it yet.

**Blocking** means no schedule, scope or value recommendation is possible until it is resolved: flag it and ask. Do not resolve it yourself by picking the more convenient answer. **Warning** means the assessment can proceed and will note it.

## Gaps and when to ask

- A gap is **critical** only if the assessment is impossible without it (for example nobody can say what the feature is, or why it should exist). Everything else becomes an assumption with the default the team will use.
- Ask clarification questions only for blocking contradictions and critical gaps: at most three, plain language, predefined answers, one click each. A "not sure" option is added automatically.
- Never re-ask what the client already answered clearly.

## Result

The harness decides the result from the findings:

- `complete`: all areas answered, consistent, backed by evidence;
- `complete_with_assumptions`: nothing blocking; open points are recorded as assumptions and results depending on them are marked preliminary;
- `needs_clarification`: blocking issues; the client gets a clarification round;
- `insufficient`: still blocked after the last round; the client decides whether to continue with a preliminary assessment or stop.
