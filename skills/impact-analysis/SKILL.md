---
name: impact-analysis
description: How to map a feature onto the game's components, rate the impact per component, list dependencies, and decide whether a technical spike is needed — the basis for telling a UI skin from a core-engine change.
---

## Component impact

Use exactly the component names from the Architecture Overview. Rate each component the feature touches:

- **none:** not touched (leave such components out unless it is worth saying).
- **low:** configuration, data or a small isolated change; no new behaviour in that component.
- **medium:** new behaviour or a new interface in the component; existing behaviour stays.
- **high:** existing behaviour changes, or the component needs new core capabilities (for example deterministic replay in movement, a new save format, a new networking model).

The component's change sensitivity (core, feature, cosmetic) comes from the Architecture Overview. You rate only the level; the pipeline engine turns levels and sensitivities into the overall change magnitude.

## Calibration examples

Rate what the feature changes in each component, not how important the feature is.

| Change                                                                          | Rating                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| New skins or offers added to the existing catalog and store                     | Characters & Skins medium or high; Economy & Store **low** |
| Time-limited availability using existing remote config or live-ops              | Live-ops **low**                                           |
| A new setting, a streak counter or a few new values stored in the existing save | Save System **low**                                        |
| A calendar, streak or progress track whose state is new fields with defaults    | Save System **low** (no existing data changes)             |
| Existing saved data must be converted or restructured (a real migration)        | Save System medium                                         |
| Cloud save, cross-device sync, a new save format                                | Save System high                                           |
| Granting coins, gems or items through the existing wallet                       | Economy & Store **low**                                    |
| Reading results the game loop already produces (score, distance, coins)         | Game Loop **low**                                          |
| A new rule inside a run (new revive rule, new run modifier)                     | Game Loop medium                                           |
| A new player ability or a changed jump, slide or collision                      | Physics & Movement high                                    |
| Replaying a recorded run inside the level (ghosts)                              | Physics & Movement and Game Loop high                      |
| A new server feature (leaderboards, friends, reward distribution)               | Backend medium or high                                     |
| A new screen, panel, theme or HUD element                                       | UI & HUD medium                                            |

## Typical signals

- **Physics & Movement / Game Loop / Level Generator:** new player abilities, replays or ghosts, changed collisions, new run modes, multiplayer synchronization, determinism.
- **Save System:** medium or high only when persistence itself changes: cloud save, a new format, converting existing data. Adding fields with defaults (counters, dates, claimed flags) is low; the Definition of Done's compatibility check covers it.
- **Backend:** server state, leaderboards, friends, receipts, events, anything shared between players.
- **Rendering & VFX:** new visual effects, shaders, more objects on screen — always check the frame-time budget on low-end devices.
- **UI & HUD / Characters & Skins / Audio:** screens, skins, sounds; cosmetic unless they need new systems.

## Dependencies

- **component:** another component must change first.
- **sdk:** a third-party SDK (ads, analytics, payments, social login).
- **epic:** an existing or planned backlog epic (name its key).
- **team:** a skill the team lacks or capacity it does not have.
- **external:** stores, platform holders, partners, legal review.

Mark a dependency **blocking** when work cannot start or finish without it.

## Performance and spikes

- List concrete performance risks (frame time, memory, install size, network) with the device class they affect.
- Propose a **spike** when a core component is rated medium or high and the solution is uncertain. State the question it must answer and a timebox of 1–10 days.
