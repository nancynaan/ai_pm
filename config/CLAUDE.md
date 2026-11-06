# Configuration

Loaded when working in `config/`. YAML settings the pipeline engine loads and validates at startup (a broken file stops the app, not a run).

- `discovery.yaml`: the fixed discovery questionnaire (sections, questions, options with `exclusive`, `excludes`, `detail`, `detailRequired`, `unknown`, `evidence`, `approval`), the contradiction rules with their clarification questions, and limits (`maxRounds`, `maxClarifications`, `maxFeatureQuestions`). Schema: `apps/server/src/pipeline-engine/discovery-config.ts`.
- `feasibility-rules.yaml`: forecast trials, risk scales and levels, the contingency cap, the value model (horizon, ramp, elasticities, caps), WSJF job sizes and verdict thresholds. Schema: `apps/server/src/pipeline-engine/assessment-config.ts`.
- **YAML pitfall:** in a flow mapping (`{ value: x, label: … }`) an unquoted comma ends the value. Quote any label or detail that contains a comma or `: `. The schemas are strict, so a split label fails at startup instead of being cut silently.
- After a change: `npm test` (the config tests load the real files), rebuild the app, and run `/eval` when the change affects agents' inputs or verdicts.
