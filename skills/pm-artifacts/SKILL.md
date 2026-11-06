---
name: pm-artifacts
description: 'How to write the text of the feature assessment documents (Feature Brief, Requirements Specification, Estimation & Release Forecast, Roadmap Update Proposal) for a Scrum team: what each section says, tone, and how figures are cited.'
---

# PM artifacts for a Scrum feature assessment

The team works in Scrum, so the documents are short and decision-oriented: a Feature Brief per feature (scope, value, impact, recommendation), a Requirements Specification, an Estimation & Release Forecast, and only when the roadmap changes a Roadmap Update Proposal. Risks and assumptions go to the shared Risk Register and Assumption Log; code writes those entries, not you.

The pipeline engine renders every table and figure from its database. You write only the text slots. The templates (in the prompt) show where each slot sits, so do not repeat what the surrounding tables already list; explain, connect and prioritise instead.

## Figures

- Never type a computed number (money, story points, sprints, dates, percentages, ROI, counts). Cite it as `{{figure:key}}` with a key from the figure list in the prompt, for example "the MVP is done by {{figure:forecast.mvp.date.p85}} at P85".
- Numbers that the client or the analysed requirements state (a cooldown of 4 hours, 60 FPS) may be written as they are, because they are requirements, not estimates.
- Identifiers are fine: REQ-FR-001, R-02, D7 retention, P85, Sprint names in figures.
- If a key you need does not exist, describe the point in words instead of inventing a number.

## Feature Brief slots

- **problem**: the problem or opportunity in the client's terms, who has it, and how strong the evidence is (say plainly when the expected outcome is an unvalidated hypothesis).
- **objectives**: what the feature should achieve and how success is judged; link objectives to the primary KPI.
- **expectedValue**: what the three value scenarios say, what drives the base case, payback and break-even, and what must be true for the value to appear. No hype.
- **scope**: the boundaries: the MVP slice, what is deferred to later releases, and what is explicitly out of scope, citing REQ codes for the important items.
- **impact**: the effect on the project baseline: remaining budget, the current release and the launch target, the components that change and how risky that is.
- **recommendation**: the recommendation that follows from the verdict (Go, Go with conditions, No-Go), the conditions that matter most, and the decision the client must take. Never contradict the verdict.

## Requirements Specification slots

- **userFlows**: 1–6 flows from the player's point of view, each a sequence of concrete steps (screen, action, system response), with the REQ codes the flow exercises. Cover the happy path and the important edge cases (offline, no ad available, cooldown running).
- **businessRules**: the rules the system enforces: eligibility, limits and cooldowns, timing, reward rules, what happens on failure. One rule per entry, testable, with REQ codes.
- **acceptanceCriteria**: per requirement, 1–6 testable criteria in plain language ("Given … when … then …" is welcome but not required). Every MVP requirement needs at least one. NFR criteria name the measure the requirement states. These are drafts; Backlog Refinement turns them into Gherkin per story.

## Estimation & Release Forecast slots

- **sequencing**: the order of the work: the spike first if there is one, enablers before the stories that need them, MVP before later scope, blocking dependencies and who must deliver them.
- **confidence**: how far to trust the forecast: preliminary flags, discovery gaps, assumptions and the widest estimate ranges; what would move the forecast most; and that the team re-estimates in Backlog Refinement.

## Roadmap Update Proposal slot

- **roadmap**: only when the prompt says a proposal is needed (otherwise null): which release moves and by how much, whether the launch target is at risk, the options for the Product Owner (accept the delay, add capacity, cut or phase scope) and that nothing changes until the PO accepts it.

## Style

Plain business English for a client and a Product Owner. Short paragraphs or "- " lists; no headings, no tables, no links inside slots. Present tense, active voice, no filler. Information that is missing or unproven stays labelled as an assumption or an open question; never present it as a fact.
