---
type: game_design_document
title: Game Design Document
---

## Concept

{{value:pitch}}

**Design pillars:** instant fun in the first 30 seconds, fair challenge, a stylish neon city, and short sessions that respect the player's time.

## Core loop

1. Start a run from the main menu.
2. Run, dodge and collect coins and power-ups until the first crash.
3. Revive once (gems or a rewarded ad) or end the run.
4. See the results, earn coins and XP, progress missions.
5. Spend coins on skins and upgrades, then start the next run.

## Controls

- **Swipe left or right:** switch between the three lanes.
- **Swipe up:** jump over low obstacles and gaps.
- **Swipe down:** slide under barriers.

## World and obstacles

The track is built from hand-made chunks assembled procedurally: rooftops, cranes, billboards, drones and moving trains. Speed rises over the run; new obstacle types unlock with distance.

## Power-ups

- **Coin magnet:** pulls coins from all lanes for 10 seconds.
- **Shield:** absorbs one crash.
- **Double coins:** doubles coins for 15 seconds.
- **Jetpack:** flies above the track and collects coins for 8 seconds.

Power-up duration can be upgraded with coins.

## Economy

- **Coins (soft currency):** earned in runs, missions and rewarded ads; spent on upgrades and common skins.
- **Gems (hard currency):** bought with real money or earned rarely; spent on revives and premium skins.
- No pay-to-win: purchases speed up progress and unlock cosmetics, but never make obstacles easier.

## Meta progression

Character skins, daily missions, player levels with rewards and power-up upgrades. Season events and leaderboards follow in R3.

## Monetization

- Gem packs and a one-time starter pack (in-app purchases).
- Rewarded ads for revives and double coins.
- Interstitial ads only after the third run of a session, at most one every 3 minutes.

## Art and audio

Stylized low-poly city with neon lighting and a dusk sky. Synthwave soundtrack with adaptive intensity, and short, punchy sound effects.

## Technical constraints

- {{value:engine}}; iOS 15+ and Android 9+.
- Performance budget: see the Architecture Overview page.
- Works offline; online is needed only for purchases, cloud features and events.
- All player-facing text is localizable; 8 languages at global launch.

## Analytics

Every run, purchase, ad view, mission and screen view sends an event. Funnels: install → first run → day-1 return → first purchase.
