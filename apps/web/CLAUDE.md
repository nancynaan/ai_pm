# Web UI

Loaded when working in `apps/web`. React 19 + Vite; served by the server from `apps/web/dist` in Docker.

- **Routes** (hash routing in `App.tsx`): `#/` chat home, `#/runs/<id>` a run's chat, `#/analysis` the assessment list, `#/analysis/<id>` one assessment, `#/status` system status.
- **Chat vs Analysis:** the chat shows the conversation, the questionnaire, the discovery report and decision cards. Phase 4 numbers live only on the Analysis tab (`Analysis.tsx`); the chat gets an `assessment_ready` card that links there. Keep later phases' figures on the Analysis tab too.
- **Data:** fetch through `api.ts` and validate every response with the zod schemas from `@ai-pm/shared`. Live updates come from the run's SSE stream (`RunView.tsx`).
- **Chat text** (`RichText.tsx`) supports paragraphs, `- ` lists, `**bold**` and absolute `https://` links only; use an event and a card for in-app links.
- **Charts** (`charts.tsx`): plain SVG, no chart library. Colors only from CSS tokens in `styles.css` (`--series-1..3`, validated as a set for light and dark; `--status-*` for risk levels with a text label). Thin marks, 4px rounded bar tops, 2px lines, a hover tooltip on every chart, a legend for two or more series, and a table next to each chart.
- Styles: one `styles.css` with light and dark tokens; layouts must work at phone width without horizontal scroll.
