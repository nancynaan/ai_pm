---
type: architecture_overview
title: Architecture Overview
---

The game client is built in {{value:engine}}; the backend is a set of small Node.js services. Each component below is also a Jira component.

**Change sensitivity** tells how risky a change to the component is:

- **core:** engine-level code (movement, physics, game loop, level generation, save format). Changes need a technical spike and regression testing.
- **feature:** new behaviour on existing systems.
- **cosmetic:** looks and content only.

## Components

{{table:components}}

## Performance budget

{{table:performance_budget}}
