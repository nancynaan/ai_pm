# Handoff: end-user documentation and README visuals

Written 2026-11-09 at the end of the build session, for a fresh Claude Code session (possibly on another Claude account). Read this first, then `source/CLAUDE.md` (loaded automatically) and `source/README.md`.

## State of the project

- **The app is complete.** All phases (0–8) and the demo fixes are committed and pushed; `main` matches `origin/main` (last commits `e4833d1` demo fixes, `1611e65` plain verdict tags). Do not change app code or behaviour in this task unless the user asks.
- Stack runs locally: `docker compose up -d` → app on <http://localhost:3000>, pgAdmin on :5050. Health: <http://localhost:3000/api/health> (all checks OK at handoff).
- **Write mode is live** (`ATLASSIAN_WRITE_MODE=live`): any publish, Approve or Decline writes to the real Jira project `AIPM` and Confluence space `AIPMconf`. For screenshots, only look; never press Generate, Publish, Skip, Approve or Decline without the user's explicit go-ahead. Never read `.env`.
- Feature runs in the database (good screenshot material):

| Run id | Title | State | Notes |
|---|---|---|---|
| `4b5ea878-fb47-48da-859a-73e8c2a1530c` | Add a free gift chest to the main menu | completed (Approved) | Verdict Go. Documents and deck published (FA-1), Epic AIPM-28 + 13 stories in Jira, Backlog tab present. Best for the full happy path. |
| `9e19b096-f19a-4db4-827c-1709d1f13068` | Add a 7-day login reward calendar | declined | Verdict No-Go. Shows the red Backlog step and the Declined banner. |
| `362d3840-f542-434f-a782-f0e3254977d4` | Show a daily login coin calendar on main menu | awaiting_decision | Verdict Go with conditions; documents generated, not published; Approve is locked ("Publish the documents to proceed."). The user is testing this run by hand: do not act on it. |

## Task 1: end-user guide

Write a guide for the person who uses the app as the client (a product owner or feature sponsor, not a developer): what the app does, at a high level, and the steps they take. Suggested file: `source/USER_GUIDE.md`, linked from the top of the README. Keep it non-technical: no Docker, no code, no internals unless as one "for administrators" pointer to the README.

Content to cover (all verified in the app at handoff):

1. **What it is:** an AI project manager for the game project Comet Run. You describe a feature in plain words; it asks questions, assesses the feature (effort, delivery dates, budget, value, risks, a Go / Go with conditions / No-Go verdict), writes the PM documents, shows a three-slide proposal, and on approval puts an Epic and user stories into Jira as a draft for the Product Owner. Every number is calculated by the app; the AI supplies judgements and text. Estimates are preliminary until the team re-estimates them.
2. **Home page:** new feature request box; recent requests; System status button.
3. **The steps, as the client** (the step bar at the top of each feature shows where you are: Intake, Discovery, Analysis, Estimation, Documents, Presentation, Backlog):
   - Describe the feature (one or two short paragraphs; evidence and constraints help).
   - Answer the discovery questionnaire: 10 fixed questions in five areas plus up to 2 about the feature; predefined options, some with a detail field; "Not sure" is allowed and becomes an open question, never a fact. A clarification round may follow for gaps or contradictions; if something still blocks, choose between a preliminary assessment and stopping.
   - Read the Discovery Completeness Report (confirmed / client assumption / AI hypothesis / missing; confidence).
   - Wait while the analysis and the assessment run: a "please wait" card shows what is happening. The **Assessment ready** card links to the **Analysis** tab (story map, release forecast at P50/P85, resources, budget, business value scenarios and ROI, risks, change magnitude; each with a chart and a table).
   - **Documents:** press **Generate documents** (Feature Brief, Requirements Specification, Estimation & Release Forecast, Risk Register and Assumption Log entries, a Roadmap Update Proposal only when the roadmap changes); preview each one. **Publish to Confluence** works once, at any time, and is required only to approve. **Skip for now** goes straight to the proposal (any verdict). Each button disappears once its step is done.
   - **Proposal:** three slides (business opportunity; solution & scope; delivery feasibility & recommendation), no story points, every slide marked preliminary. View slides, Download PPTX; **Publish to Confluence** (optional, once, after the documents are published) attaches the deck to the Feature Brief.
   - **Decide:** Approve or Decline, with an optional comment. Approve needs the documents published (the button is locked with a hint, and the chat says what to do); Decline does not.
   - **After Approve:** the Epic and one story per backlog item go to Jira as an AI draft (To Do, label `ai-draft`, no sprint, Story Points empty, proposed priority and an AI estimate pending the Product Owner's review, Gherkin acceptance criteria); the Initial Product Backlog page lists them; a **Backlog** tab appears; the conversation closes (status Approved, every step green).
   - **After Decline:** the decision is recorded on the published documents (if any), the draft Epic is closed, the Backlog step turns red, status Declined.
4. **Tabs on a feature:** Chat, Analysis, Documents (with previews), Presentation (slide viewer), Backlog (after approval).
5. **System status:** health of the database, Jira, Confluence and Claude; the project baseline documents; the Run log (each feature's steps, time, Claude calls and tokens).
6. **Good to know:** runs survive restarts; a Claude usage limit pauses a step until it resets; documents and deck are published once (no re-publish); what the AI does and does not decide.
7. Optional: a short glossary (Epic, story, P50/P85, ROI, verdicts, preliminary).

`source/DEMO.md` is the step-by-step demo script with expected results per step; reuse its facts, but the guide is for end users, not a test script. Write in plain English (short sentences, active voice, no jargon without explanation).

## Task 2: screenshots / GIF for the README

Goal: a hero image or short GIF at the top of `source/README.md`, plus screenshots in the user guide.

- Suggested location: `source/docs/images/` (create it), PNG for screenshots, GIF under ~5 MB. Reference them with relative paths.
- Good shots (all read-only, from the runs above): the home page; the chat of the approved run (step bar all green, Backlog card); the Analysis tab of the approved run (charts); the Documents card; the slide viewer; the locked Approve with its hint on run `362d3840…` (hover only, do not click).
- How to capture: the user can take them (Windows: Win+Shift+S for screenshots; a free recorder such as ScreenToGif for a GIF) and save them into the folder; Claude then crops nothing and just wires them into the docs. Claude's own browser pane screenshots are not saved as project files, so do not rely on them for the README. If automating is preferred, ask the user before installing anything (e.g. Playwright via npx downloads a browser).
- Nothing sensitive is expected in the UI, but check images for e-mail addresses or tokens before committing (the Atlassian site name `nancynaan.atlassian.net` appears in links; ask the user whether that is fine).

## Rules that still apply

- Commit and push only after the user's OK; end commit messages with the co-author line the session's system prompt gives.
- Keep Claude calls at zero for this task: documentation needs no agent runs.
- Keep `CLAUDE.md` Status/Current Focus up to date when done, and add a line to `./docs/PROJECT_STATUS.md`.

## Note on the app's own Claude login

The app's agents run on the Claude account whose token is in `.env` (`CLAUDE_CODE_OAUTH_TOKEN`, set with `claude setup-token`). Switching the account you chat with in Claude Code does not change that. This documentation task makes no agent calls, so nothing needs changing. If the user later wants new feature runs billed to the other account, they run `claude setup-token` with it, put the token in `.env` themselves and recreate the app container (`docker compose up -d app`).
