# Runtime skills

Loaded when working in `skills/`. Knowledge packages that runtime agents receive in their system prompt (Agent Skills file format, but loaded by the pipeline engine, not by Claude Code).

- **One folder per skill:** `<name>/SKILL.md` with front matter `name` (same as the folder) and `description` (quote it when it contains `: `), then the knowledge. An agent lists the skills it needs in its `skills:` front matter.
- Skills hold reference knowledge: scales and their definitions, checklists, benchmark ranges, calibration tables, domain facts. No step that computes numbers, and nothing that contradicts the baseline (`seed/baseline`).
- Keep facts consistent with the code: when a skill describes a rule the engine applies (caps, thresholds, elasticities), the numbers come from `config/*.yaml`; name the config instead of copying values that could drift.
- A skill change can move every assessment: run the default eval (`/eval`) afterwards.
