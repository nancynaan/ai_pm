---
name: risk-management
description: 'How to identify and rate project risks for a game feature: cause-event-effect statements, 1–5 probability and impact scales with definitions, response strategies, owners, triggers and cost impact.'
---

## Statement

**Because of** <cause, a fact or condition>, **<event>** may happen, **which would lead to** <effect on schedule, cost, value or quality>. One event per risk. A risk is uncertain; a certain problem is an issue (write it as a blocking conflict instead).

## Scales

| Value | Probability (in the feature's life) | Impact                                                                              |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| 1     | Rare: below 10 %                    | Negligible: absorbed within a sprint, no client-visible effect                      |
| 2     | Unlikely: 10–30 %                   | Minor: up to 1 sprint or 10 % of the feature budget; small KPI shortfall            |
| 3     | Possible: 30–50 %                   | Moderate: 1–2 sprints or 10–25 % of budget; the value case weakens                  |
| 4     | Likely: 50–70 %                     | Major: a missed release date, more than 25 % over budget, or store or review damage |
| 5     | Almost certain: above 70 %          | Severe: the feature fails its purpose, a launch slips, data loss, a store ban       |

The harness scores P × I (high ≥ 15, critical ≥ 20) and prices the risk with your cost impact.

## Strategies

- **Avoid:** change the plan so the risk cannot occur (cut the item, choose another design).
- **Mitigate:** lower probability or impact (spike, prototype, tests, feature flag, staged rollout).
- **Transfer:** move it to a party better able to carry it (vendor, platform service).
- **Accept:** only for low risks, or with a contingency plan stated in the response. A critical risk is never accepted without mitigation.

## Typical risks of this game

| Area           | Example                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Core engine    | Changing movement or the game loop breaks determinism, collisions or difficulty                    |
| Performance    | New effects push the low-end Android device under 30 FPS or past the memory or install-size budget |
| Backend        | Leaderboards, rewards or sync need server capacity, anti-cheat or new infrastructure               |
| Economy        | New rewards inflate the currency; paid advantages break the no-pay-to-win rule                     |
| Product        | The value hypothesis has no evidence; players ignore the feature                                   |
| Schedule       | The current release (global launch) loses capacity; dependencies on other epics                    |
| Compliance     | Store rules for purchases, loot boxes, age ratings, personal data                                  |
| Organizational | No approver for budget or timeline; external partners late                                         |

## Cost impact

Give what it costs **if it happens**: extra story points of rework, extra sprints of delay (the whole feature team waiting or redoing), and direct cost (refunds, external fixes, lost spend). Use 0 where a part does not apply. The harness turns this into money and the expected value (EMV), which forms the contingency.

## Existing Register

Before adding a risk, check the Risk Register. If an entry (R-xx) covers the same event, reference it and describe how this feature changes its probability or impact.
