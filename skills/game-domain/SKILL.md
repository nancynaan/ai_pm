---
name: game-domain
description: Endless-runner and mobile free-to-play basics — core loop, KPIs, monetization and the non-functional requirements every feature must respect.
---

## Endless runners

- **Core loop:** run → dodge and collect → crash → revive or end → results and rewards → spend on meta progression → run again. Sessions are short (5–10 minutes).
- **Typical features:** cosmetic skins, power-ups and upgrades, missions and daily rewards, events and seasons, leaderboards, friends and social challenges, new run modes, new worlds.
- **What makes a change risky:** anything that changes how the runner moves or collides, how runs are generated, or what is saved. Players notice small changes in feel immediately.

## Mobile free-to-play KPIs

- **DAU:** daily active users. **ARPDAU:** average revenue per daily active user.
- **Retention D1 / D7 / D30:** share of a day's new players who return after 1, 7 and 30 days.
- **Payer conversion:** share of players who ever pay. **LTV:** lifetime value per player.
- Value drivers: retention keeps DAU up; conversion and ARPDAU turn DAU into revenue; rewarded ads monetize non-payers.

## Monetization rules of thumb

- No pay-to-win: purchases speed up progress or unlock cosmetics.
- Rewarded ads are opt-in and give fair value; interstitials are rare and never in the first runs.
- Starter packs and season passes convert best when they appear after the player understands the game.

## Non-functional requirements that always apply

- Frame-time budget on low-end Android devices; memory and install size limits.
- Offline play for the core loop; online only where needed (purchases, events, social).
- Save data must stay compatible or be migrated safely.
- Privacy: consent for new personal data; special rules for players under 13.
- Localization of every player-facing text; analytics events for every new flow.
- Store policies (Apple, Google) for purchases, ads and user-generated content.
