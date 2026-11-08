# Demo script: one feature, from request to Jira

A walk through the whole pipeline as the client, against your real Jira and Confluence. It takes about 25–35 minutes, most of it waiting for Claude (roughly 10–12 Opus calls on your subscription). Every write goes through the idempotent publisher, so pressing a button twice never duplicates a page or an issue.

> **Live writes.** With `ATLASSIAN_WRITE_MODE=live` the demo creates real content: a draft Epic at intake, a new Feature Assessment (FA-2, …) with its pages, blocks on the shared Risk Register, Assumption Log and Initial Product Backlog, the PPTX attachment, and on Approve the stories. With `dry-run`, everything runs the same way and the cards show what _would_ be written.

## 0. Before you start (2 minutes)

1. The stack is up: `docker compose up -d`, then open <http://localhost:3000>.
2. **System status** shows every check as OK (database, Jira sign-in, Jira Scrum project, Confluence, Claude) and the 12 baseline documents as published.
3. Optional: the read-only smoke test confirms Jira and Confluence match what the pipeline wrote and writes nothing:

   ```bash
   docker compose exec app node apps/server/dist/evals/smoke-cli.js
   ```

## 1. Describe the feature (intake, ~1 minute)

On the home page, write the request as the client would. Any feature of the endless runner works; this one is a good fit for the demo (a feature extension with weak evidence, so discovery records assumptions):

> Add a 7-day login calendar: every day you open the game you get a coin reward that grows each day, and on day 7 a few gems. Missing a day starts it over.

**Expect:** the chat restates the request, the feature gets a short name, and (live) a draft Epic appears in Jira with labels `ai-pm`, `ai-pm-draft`. The step bar at the top shows Intake in progress, then the questionnaire.

## 2. Answer the discovery questionnaire (~2 minutes + ~1 minute)

Ten fixed questions in five areas (business justification, product context, scope, feasibility, decision readiness), plus up to two about this feature. Answer as you like. For the login calendar, a typical client:

| Question                   | Answer                                                        |
| -------------------------- | ------------------------------------------------------------- |
| Problem or opportunity     | Low player retention                                          |
| Expected outcome           | Improve Day 1 / Day 7 retention; Increase DAU                 |
| Basis for the request      | Business intuition or a hypothesis                            |
| Target audience            | Casual players                                                |
| First-release expectations | Core, UI, rewards/economy, notifications                      |
| Success definition         | A specific KPI target (e.g. "D7 retention from 12 % to 14 %") |
| Priority                   | High                                                          |
| Constraints                | Flexible budget                                               |
| Dependencies               | I need the PM team to identify dependencies                   |
| Approval                   | I can approve the feature scope, budget and timeline          |

"Not sure" is always allowed and becomes an open question, never a fact.

**Expect:** the Discovery Completeness Report card: what is confirmed, what is a client assumption, what is an AI hypothesis, and what is missing, with a confidence level. Contradictions or critical gaps start a clarification round (up to two questions); if something still blocks, you choose between a preliminary assessment and stopping.

## 3. Analysis and assessment (~5–6 minutes)

Nothing to do: the requirements, impact, estimate, value and risk agents run one after another (the step bar moves through Analyzing and Estimating).

**Expect:** an assessment card in the chat with the verdict (Go, Go with conditions or No-Go) and a link to the **Analysis** tab. There: the story map, the release forecast (P50/P85 dates), budget, business value scenarios and ROI, risks and the change magnitude, each with a chart and a table. Every number is computed in code; the agents only give judgements. On a phone, the wide tables scroll sideways with the first column pinned.

## 4. Publish the documents (~3–4 minutes)

On the Documents card under the assessment, press **Generate and publish to Confluence**.

**Expect:** one writer call, then the table fills in: Feature Brief, Requirements Specification, Estimation & Release Forecast, the feature's blocks on the Risk Register and Assumption Log, and a Roadmap Update Proposal only if the roadmap changes. Each row has **Open in Confluence** and **Preview**. In Confluence: a new FA-n page tree under Feature Assessments.

Pressing the button again rewrites the same pages (no duplicates) and makes no Claude call while the assessment is unchanged.

## 5. The proposal (~1 minute)

**Expect:** a Proposal card and the **Presentation** tab with exactly three slides (business opportunity; solution & scope; delivery feasibility & recommendation). There are no story points, only date and money ranges marked preliminary and "not a delivery commitment". The PPTX downloads from the tab and is attached to the Feature Brief and embedded in it.

Then the question "Here is the assessment summary…" and the decision card.

## 6. Decide (~1 minute, or ~2 minutes with Approve)

**Approve:**

- One backlog-builder call, then the Epic and one story per story-map item go to Jira as an **AI draft**: To Do, label `ai-draft`, no sprint, Story Points empty, a proposed priority "pending PO review", an `AI estimate (SP)`, Gherkin acceptance criteria and `Blocks` links.
- The Backlog card gives the Epic link and every story with its key. A **Backlog** tab appears.
- The Initial Product Backlog page gets the feature's block, and the Feature Brief title gets the Epic key.
- The step bar turns all green and the status reads **Approved**; the conversation closes.

**Decline:**

- The decision is recorded on the Feature Brief and the Assumption Log, and the draft Epic is closed.
- The Backlog step turns red and the status reads **Declined**; the conversation closes. Nothing goes to the backlog.

## 7. Check the result (~3 minutes)

- **Jira:** filter `labels = ai-draft ORDER BY created DESC`: the Epic and its stories, none in a sprint, Story Points empty.
- **Confluence:** the FA-n Feature Brief (decision, Epic link, embedded deck), the shared pages with the new blocks.
- **System status → Run log:** the feature's steps with time, Claude calls, tokens and repairs.
- **Documents tab:** the Publish button is locked after the decision; hovering it says why.
- Optional: run the smoke test again. Everything should be `unchanged`.
