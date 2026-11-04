---
name: requirements-analysis
description: How to categorize feature requirements (functional vs ISO/IEC 25010 non-functional), prioritize them with MoSCoW, define an MVP slice, and find conflicts and duplicates against the baseline and backlog.
---

## Requirements

- Write each requirement as one testable statement: who needs what, and how you would check it. Split compound statements.
- **Aim for 8–20 requirements** for a typical feature. Merge small details (texts, individual edge cases, single analytics events) into the description of the requirement they belong to; they become acceptance criteria later.
- **Functional (FR):** behaviour the player or the business sees. `category` is the functional area (gameplay, economy, UI, social, live-ops, analytics, backend).
- **Non-functional (NFR):** a quality the feature must have. `category` is the ISO/IEC 25010 characteristic: functional suitability, performance efficiency, compatibility, interaction capability (usability, accessibility), reliability, security (including privacy), maintainability, flexibility (portability), safety.
- Always check these NFRs for a mobile game: frame-time budget on low-end devices, memory, install size, offline behaviour, save-data compatibility, privacy and age rules, localization, analytics events.
- `source`: **stated** by the client, from an **answer**, or **inferred** from the idea and the baseline.
- Refs: FR-1, FR-2 … and NFR-1, NFR-2 … in a sensible reading order.

## MoSCoW and the MVP

- **Must:** the feature makes no sense without it. **Should:** important, but the feature works without it. **Could:** nice to have. **Won't (this time):** explicitly out of scope.
- The MVP is the smallest slice that delivers the client's goal and can be measured. All musts are in the MVP; shoulds only if cheap. If the client accepts an MVP (scope-flexibility answer), keep the MVP tight; if they want the full feature, say so in the MVP summary.

## Conflicts and duplicates

Compare every requirement with:

- the **Game Design Document** (pillars, controls, economy rules such as "no pay-to-win", technical constraints);
- the **Definition of Done** (for example the frame-time budget or localization);
- the **current backlog** (by issue key): a duplicate is work that already exists; a conflict is work that contradicts it;
- the **roadmap** (a feature planned for a later release, or a release goal it endangers).

A conflict is **blocking** when the feature cannot be built as asked without changing the baseline. Offer 1–3 concrete resolution options.

## Assumptions and constraints

- Assumptions: what the analysis takes as true without proof. Name an owner role when obvious (Product Owner, client, a developer role).
- Constraints: limits the solution must respect — time (deadline), budget (envelope), platform, technical (engine, SDKs, save format), compliance (privacy, age rating, store policy).
