---
name: business-value-roi
description: 'How to turn a feature into value scenarios for a free-to-play mobile game: value drivers, plausible KPI effect ranges, reach, WSJF scoring, and cheap ways to validate a value hypothesis.'
---

## Value drivers

A feature creates value through one or more drivers. Name the main one as the primary KPI.

| Driver                | KPI                                       | Unit of change    |
| --------------------- | ----------------------------------------- | ----------------- |
| Players come back     | d1_retention, d7_retention, d30_retention | percentage points |
| Players play longer   | session_minutes                           | minutes           |
| More players          | dau                                       | % relative        |
| More payers           | payer_conversion                          | % relative        |
| More ad views         | rewarded_views_per_dau                    | % relative        |
| More spend per player | arpdau                                    | % relative        |

The pipeline engine converts the changes into DAU and ARPDAU effects with elasticities from config/feasibility-rules.yaml, applies them to the KPI baseline (and to the Business Case DAU target after the global launch), ramps them up after release, and computes revenue, ROI, NPV, payback and the break-even point. Do not compute money yourself.

## Plausible ranges (rule of thumb for this project)

Effects of **one** feature on the **whole** game, before reach. Stay inside these unless the evidence says otherwise; the pipeline engine caps larger values and flags them.

| Feature type                                    | Typical base effect                       | Optimistic   |
| ----------------------------------------------- | ----------------------------------------- | ------------ |
| Cosmetic content (skins, themes)                | payer_conversion +2–5 %, arpdau +1–3 %    | arpdau +5 %  |
| Daily habit (login rewards, missions)           | d7_retention +0.3–1 pt, d30 +0.2–0.5 pt   | d7 +1.5 pts  |
| Competition (events, leaderboards, tournaments) | session_minutes +0.2–0.5, d7 +0.3–0.8 pt  | d7 +1.2 pts  |
| Social (friends, ghosts, sharing)               | d7 +0.5–1 pt, dau +1–3 %                  | dau +5 %     |
| Progression or gameplay depth                   | d7 +0.5–1.5 pts, session_minutes +0.3–0.8 | d7 +2 pts    |
| Quality of life (cloud save, performance)       | d30 +0.2–0.5 pt, fewer churn complaints   | d30 +1 pt    |
| Monetization (offers, passes, ad placements)    | arpdau +3–8 %                             | arpdau +12 % |

**Reach** is the share of players who meet the feature: everyone 1.0; daily players about 0.35; payers about 0.02 (use payer_conversion or arpdau changes for payer features instead of tiny reach).

## Scenarios

- **Pessimistic:** what happens if the hypothesis is wrong. With no supporting evidence: no effect (empty kpiChanges). A feature can also have a negative effect (economy inflation, pay-to-win churn).
- **Base:** the most likely effect, inside the typical range, at its lower end when the evidence is weak.
- **Optimistic:** a good but realistic outcome, not the best case imaginable.

## WSJF (Fibonacci 1, 2, 3, 5, 8, 13, 20)

- **Business value:** the size of the base-case effect on the primary KPI and on the Business Case targets.
- **Time criticality:** 1–3 with no date; 8–13 with a hard date or a seasonal window; 20 only when the value disappears after the date.
- **Risk reduction or opportunity enablement:** how much it lowers project risk (for example retention risk R-01) or enables later features.

The pipeline engine divides their sum by the job size from the estimate.

## Validating the hypothesis

Prefer the cheapest test that could prove the hypothesis wrong: analytics on existing behaviour, a fake-door test, a soft-launch cohort, an A/B test with a kill switch, a prototype with playtesters. Name the metric and the threshold that decides.
