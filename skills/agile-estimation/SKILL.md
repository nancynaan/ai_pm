---
name: agile-estimation
description: "How to build a story map for a feature and size its items with three-point estimates in story points, relative to the team's reference stories, so the pipeline engine can forecast the release with Monte Carlo."
---

## Story map

- **Backbone:** 3–7 activities in the player's or operator's order (for example "Enter the tournament", "Play a tournament run", "See the ranking", "Get the reward", "Operate the event").
- **Items** under each activity, small enough for one sprint (at most 13 points most likely; split anything bigger):
  - `story`: player- or operator-visible behaviour (INVEST).
  - `enabler`: technical groundwork with no visible behaviour (a save field, a server endpoint, telemetry).
  - `spike`: a timeboxed investigation that answers one question; size it by its timebox.
  - `nfr`: work that exists only for a quality requirement (performance on the low-end device, store compliance, localization, accessibility).
- **Release slice:** `mvp` items deliver the smallest version that meets the Must requirements and can be validated; `later` holds Should/Could items. Won't items get no item.
- Every Must requirement maps to at least one MVP item. Cite REQ codes.

## Sizing

- Scale: 0, 1, 2, 3, 5, 8, 13, 20, 40 (Planning Poker). Size **relative to a done reference story** from the backlog extract and name its key. Never translate to hours or days.
- **Three points per item:** optimistic (everything goes right), most likely (normal), pessimistic (realistic bad case, not a disaster). Typical spread: O one step below M, P one or two steps above.
- **Widen the range** (P two or more steps above M) when the item depends on: an unvalidated assumption or AI hypothesis, an unresolved conflict, a core component rated medium or high, a dependency outside the team, or an unfamiliar technology.
- **Narrow ranges** (O = M = P) only for work the team has done many times.

## Size what was asked, nothing more

- The MVP is the client's stated first-release scope at its smallest valid size. Do not add features, variants, screens or polish the client did not ask for (no gold-plating); list ideas as `later` items only when a requirement asks for them.
- Keep supporting work in proportion: a two-sprint feature gets a QA pass and an analytics event, not a test campaign and a dashboard project.
- Use facts the client or the baseline states (for example "colours come from one shared stylesheet") instead of planning for the worst case; propose a spike only when the impact analysis does.

## Disciplines

Give each item the discipline that does most of it, as this team works:

| Discipline | Who                   | Typical work                                                                                                  |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `gameplay` | 2 gameplay developers | All Unity client code: mechanics, UI screens and HUD implementation, theming, store screens, analytics events |
| `backend`  | 1 backend developer   | Server endpoints, leaderboards, remote config, receipts, cloud save                                           |
| `ui_art`   | 1 UI/UX & 2D artist   | Design, mock-ups, colour palettes, icons, 2D art and skins (not UI code)                                      |
| `qa`       | 0.5 QA engineer       | Test passes, regression, device testing                                                                       |
| `other`    | everyone              | Shared work, e.g. a spike the whole team joins                                                                |

Split an item when design and implementation are both large (for example "Design the neon palette" as `ui_art`, "Apply the theme to menus and HUD" as `gameplay`).

## Work people forget

| Area            | Typical item                                                                   |
| --------------- | ------------------------------------------------------------------------------ |
| Core components | Regression testing of movement, game loop or level generation when they change |
| Quality         | QA pass on the low-end reference device; crash-free check                      |
| Data            | Analytics events and a dashboard for the success KPI                           |
| Platform        | Store review requirements, age rating, privacy labels                          |
| Content         | Localization of new texts into the shipped languages                           |
| Operations      | Remote config, a kill switch, live-ops tooling                                 |
| Discovery       | The proposed spike, and validation work for unvalidated hypotheses             |

## Costs outside the team

Only real external costs: outsourced or licensed art and audio, third-party services, server and storage costs (monthly). Give the basis ("2 skins × $1,500 outsourced, as in the GDD's art plan"). Team time is never a non-labour cost.
