# BPMN process models

BPMN 2.0 models of the AI PM pipeline: what happens when a client brings a new feature idea for the endless-runner game. The project runs Scrum.

| File | Process |
|---|---|
| [00-end-to-end-overview.bpmn](00-end-to-end-overview.bpmn) | Full flow from the client's idea to stories that are Ready for Sprint Planning. Call activities point to the detailed models. |
| [01-intake-and-elicitation.bpmn](01-intake-and-elicitation.bpmn) | Feature intake, draft Epic, discovery questionnaire (10 fixed questions in five areas + up to 2 feature questions), Discovery Completeness Report, one clarification round, and the client's choice of a preliminary assessment or stop |
| [02-requirements-analysis-and-impact.bpmn](02-requirements-analysis-and-impact.bpmn) | FR/NFR categorization, MoSCoW and MVP slice, conflicts, assumptions and constraints, component impact and dependencies, change magnitude (UI skin vs core engine) |
| [03-estimation-value-and-risk.bpmn](03-estimation-value-and-risk.bpmn) | Story map and three-point estimates, Monte Carlo release forecast, resources and budget, risks (P×I, EMV), ROI/NPV/WSJF, feasibility verdict |
| [04-documentation-and-confluence.bpmn](04-documentation-and-confluence.bpmn) | "Generate documents" (or "Skip for now", any verdict), one writer call, validation against the DB, previews, and on to the presentation; "Publish to Confluence" (once, needed to approve) creates the Feature Brief, Requirements Specification, Estimation & Release Forecast, a Roadmap Update Proposal when needed, and the feature's block on the Risk Register and Assumption Log |
| [05-client-presentation-and-decision.bpmn](05-client-presentation-and-decision.bpmn) | Three-slide client proposal (business opportunity, solution & scope, delivery feasibility & recommendation), PPTX attached to and embedded in the Feature Brief, and the client's decision gate (approve or decline; a decline closes the draft Epic and the chat) |
| [06-backlog-generation-and-refinement.bpmn](06-backlog-generation-and-refinement.bpmn) | After approval: coverage and DoR gates, the Epic and one story per story-map item in Jira as an AI draft (ai-draft, To Do, no sprint, Story Points empty, proposed priority, Gherkin AC, Blocks links), the Initial Product Backlog block, then PO review and the manual Backlog Refinement |

**Notation used.** Every pipeline pool is split into two kinds of lane:

- The **Pipeline engine** lane holds deterministic TypeScript: orchestration, validation, calculations and all writes to Jira and Confluence.
- **Agent** lanes hold Claude calls that load skills and return schema-validated JSON.

Atlassian Cloud is drawn as a collapsed pool, reached through its REST API. The models are documentation (`isExecutable="false"`). The runtime is the pipeline engine's state machine described in [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md).

## Viewing

- Open [viewer.html](viewer.html) in a browser. It loads bpmn-js from unpkg and has the models embedded, with one tab per model.
- Or open any `.bpmn` file in [Camunda Modeler](https://camunda.com/download/modeler/) or at <https://demo.bpmn.io>.

## Editing

The files are generated from [generator/processes.mjs](generator/processes.mjs), a grid-based description, by [generator/build.mjs](generator/build.mjs):

```bash
node docs/bpmn/generator/build.mjs
```

Change the model in `processes.mjs` and regenerate. If you edit a `.bpmn` file by hand in Camunda Modeler, stop regenerating that file, or the next build will overwrite your edits.
