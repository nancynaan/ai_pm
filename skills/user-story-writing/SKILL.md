---
name: user-story-writing
description: 'How to write user stories for a Scrum Product Backlog: INVEST, the Connextra form, Gherkin acceptance criteria (including NFRs), enablers and spikes, and the Definition of Ready.'
---

# User stories for the Product Backlog

The stories are an AI draft. The Product Owner reviews and orders them, and the team refines, splits and estimates them in Backlog Refinement. Write them so that refinement starts from a clear, testable proposal, not a finished plan.

## INVEST

- **Independent:** a story delivers on its own once its blockers are done; dependencies are explicit (`blockedBy`), not hidden in the text.
- **Negotiable:** describe the need and the constraints, not every implementation detail. Name the existing system to reuse when a requirement says so.
- **Valuable:** the "so that" names a benefit for the player, the business or the team (for enablers).
- **Estimable:** the context says enough for the team to size it: which screen or system, which states, which edge cases.
- **Small:** one story per story-map item; if an item looks too big, say so in `openQuestions` instead of splitting it.
- **Testable:** every story has Gherkin scenarios a tester can run.

## Connextra form

"As a <role>, I want <goal>, so that <benefit>."

- Player-facing stories: the role is the player (or a kind of player: a returning player, a non-paying player).
- Enablers and technical work: the role is the team, the backend developer, QA or the Product Owner, and the benefit says what it enables.
- NFR items: the role is whoever cares about the quality (the player for performance, the Product Owner for store compliance, QA for a test pass).

## Gherkin acceptance criteria

- One scenario per behaviour: the happy path first, then the important edge cases from the business rules and user flows (offline, no ad available, limit reached, cooldown running, failure or cancel).
- `Given` sets the state, `When` is one action or event, `Then` is an observable result. Use extra `Given`/`Then` lines instead of "and" inside one line.
- Use the requirement's own values (a 4-hour cooldown, 3 per day, 50 coins). Never invent a threshold; if the requirement gives none, describe the check and add an open question.
- NFR scenarios name the measure and the device or condition from the requirement or the Definition of Done ("on the low-end reference device, the main menu keeps the frame-time budget").
- Start from the Requirements Specification's draft acceptance criteria for the item's REQ codes; cover each of them in at least one scenario of some story.

## Spikes and enablers

- A spike answers a question in a timebox; its scenarios check that the answer is documented and a decision is made, not that a feature works.
- An enabler (data model, integration, configuration) is a story whose benefit is what it unlocks; stories that need it list it in `blockedBy`.

## Definition of Ready (checked by the pipeline engine)

A draft story is ready for refinement when it has a Connextra statement, at least one Gherkin scenario, at least one REQ code, known blockers without cycles, a proposed priority and an AI estimate. The engine adds the last two; you supply the rest.
