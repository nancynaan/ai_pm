---
name: requirements-elicitation
description: How the AI PM turns a client's feature idea into candidate requirements, which topics the fixed discovery questionnaire already covers, and how to write the few feature-specific questions it does not.
---

## Goal

Get just enough information to assess a feature (scope, value, effort, risk) while asking the client as little as possible. The client is not technical; questions must be plain and answerable in one click.

## The discovery questionnaire

Every client answers the same ten questions (config/discovery.yaml), grouped in five areas:

- **Business justification:** primary problem or opportunity; expected business outcome (up to two); basis for the request (evidence).
- **Product context:** the player audience that benefits most.
- **Scope:** what the first version should include; how success will be judged (up to two, or a specific KPI target).
- **Feasibility:** priority and timing; budget, timeline, technical and organizational constraints; known dependencies.
- **Decision readiness:** who can approve the scope, budget and timeline.

Plus an optional free-text comment. Never ask about these topics again in a feature question.

## Procedure at intake

1. Restate the idea in two or three sentences, in the client's terms.
2. List candidate requirements. Mark each as **stated** (the client said it) or **inferred** (it follows from the idea or the baseline, for example "works offline" from the GDD). Include non-functional ones (performance, compatibility, compliance) whenever the idea touches them.
3. List feature-specific gaps: unknowns about _this_ feature that change the estimate, the value case or the risk and that the questionnaire does not cover.
4. Add **at most two** feature-specific questions for the gaps with the biggest effect. Add none when nothing important is open.

## Feature-specific topics

Use these when the idea touches them and the baseline does not answer them:

| Topic           | Example question                                      | Example options                                                           |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| gameplay_impact | How should it affect gameplay?                        | Looks only · New content on existing mechanics · New or changed mechanics |
| connectivity    | Must it work offline?                                 | Fully offline · Online is fine · Offline, syncing when online             |
| monetization    | How should the feature make money, if at all?         | Free · Coins · Real-money purchases · Rewarded ads · Season pass          |
| reward_type     | What should players get?                              | Coins · Gems · Cosmetic items · Boosters                                  |
| personal_data   | Does it collect new personal data or target children? | No new data · New data, consent needed · Players under 13                 |
| art_content     | Where does the art and content come from?             | Reuse existing assets · New assets by the team · Outsourced or licensed   |
| live_ops        | Does it need ongoing updates?                         | Ships once · Seasonal updates · Continuous live-ops                       |
| social          | Who do players compete or share with?                 | Friends only · Everyone · Clubs or teams                                  |

Rules for feature questions:

- Use a short snake_case `id` (the topic), 2–6 predefined options, and a one-sentence `why`.
- Do not add a "not sure" option; it is added automatically.
- Never ask the client for effort, cost, story points or uplift numbers: those are the team's job.
