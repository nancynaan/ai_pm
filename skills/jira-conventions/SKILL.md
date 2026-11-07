---
name: jira-conventions
description: 'How the AI PM pipeline writes an approved feature into Jira: what the Epic and stories contain, which fields the engine sets, the ai-draft label and what is left to the Product Owner and the team.'
---

# Jira conventions for AI-generated backlog items

## What goes where

- **Epic:** one per feature. High-level only: what the feature is, why it matters and how success is judged. The engine adds the MVP scope (the story list), the verdict, the preliminary forecast and budget ranges, and links to the Feature Brief in Confluence.
- **Story:** one per story-map item, a child of the Epic. Its description holds the user story, the context, the Gherkin acceptance criteria, the requirements it covers, its blockers and open questions. Enablers, NFR items and spikes are also created as stories and carry a label for their kind.

## Fields the pipeline engine sets (do not write them in the text)

- **Status:** To Do. **Sprint:** none. Nothing goes into an active or future sprint; the backlog is a draft in the Product Backlog.
- **Labels:** `ai-draft` (needs Product Owner review), `ai-pm`, `fa-<n>` (the feature assessment), and `enabler`, `nfr` or `spike` for those kinds.
- **Priority:** proposed by rules from MoSCoW and dependencies, and marked "proposed, pending PO review" in the description.
- **AI estimate (SP):** the expected size from the story map. **Story Points** stay empty: the team sets them in Planning Poker, and they are the estimate that counts.
- **Blocks links:** created from `blockedBy`.

## Writing style for Jira

- Summaries: short and specific, no prefix (no "S-3:", no "[AI]"), at most about ten words.
- Text: plain sentences and short lists; no headings inside fields (the engine adds the section headings).
- Refer to existing backlog issues by their key when the analysis names one (for example a frequency-cap story).
