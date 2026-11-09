// Process models for the AI PM pipeline (endless-runner game project, Scrum).
// Each element is placed on a grid: lane id, column `c`, optional row `r` inside the lane.
// Rendered to BPMN 2.0 XML by ./build.mjs.

const node = (t) => (id, lane, c, n, o = {}) => ({ id, t, lane, c, n, ...o });
const start = node('startEvent');
const end = node('endEvent');
const catchEv = node('intermediateCatchEvent');
const task = node('task');
const user = node('userTask');
const manual = node('manualTask');
const service = node('serviceTask');
const script = node('scriptTask');
const send = node('sendTask');
const rule = node('businessRuleTask');
const call = node('callActivity');
const xor = node('exclusiveGateway');
const and = node('parallelGateway');

const CLIENT = { id: 'client', name: 'Client (feature sponsor)' };
const ATL = { id: 'atl', name: 'Atlassian Cloud: Jira & Confluence (REST API)', collapsed: true };

// ---------------------------------------------------------------------------------------
// 00 End-to-end overview
// ---------------------------------------------------------------------------------------
const overview = {
  key: 'D00', file: '00-end-to-end-overview.bpmn', title: '00 Overview',
  summary: 'The whole flow from the client\'s idea to stories that are Ready for Sprint Planning. The pipeline runs automatically up to the Jira backlog. The Product Owner reviews it, and the team refines the stories in a manual Backlog Refinement session.',
  pools: [
    CLIENT,
    {
      id: 'org', name: 'Delivery organization', lanes: [
        { id: 'ai', name: 'AI PM Pipeline (automated)', padTop: 30 },
        { id: 'po', name: 'Product Owner' },
        { id: 'team', name: 'Scrum Team' },
      ],
    },
    ATL,
  ],
  nodes: [
    start('c_start', 'client', 0, 'New feature idea'),
    user('c_describe', 'client', 1, 'Describe the feature in the chat UI'),
    user('c_answer', 'client', 2, 'Answer questionnaire (predefined options)'),
    catchEv('c_receive', 'client', 6, 'Assessment & slides received', { ev: 'message', lp: 't' }),
    user('c_decide', 'client', 7, 'Review presentation and decide'),
    end('c_end', 'client', 8, 'Decision sent'),

    start('a_start', 'ai', 1, 'Feature request received', { ev: 'message' }),
    call('a_intake', 'ai', 2, 'Intake & elicitation', { called: 'Process_D01_ai' }),
    call('a_analysis', 'ai', 3, 'Analysis & impact', { called: 'Process_D02_ai' }),
    call('a_estimate', 'ai', 4, 'Estimation, value & risk', { called: 'Process_D03_ai' }),
    call('a_docs', 'ai', 5, 'Documents: generate (or skip); publish optional', { called: 'Process_D04_ai' }),
    call('a_present', 'ai', 6, 'Client presentation', { called: 'Process_D05_ai' }),
    catchEv('a_decision', 'ai', 7, 'Client decision received', { ev: 'message' }),
    xor('a_gw', 'ai', 8, 'Decision?', { lp: 'tl' }),
    call('a_backlog', 'ai', 9, 'Backlog generation (Jira)', { called: 'Process_D06_org' }),
    end('a_declined', 'ai', 8, 'Feature declined: chat closed', { r: 1 }),

    user('po_review', 'po', 10, 'Review & adjust Epic and stories in Jira'),
    user('po_order', 'po', 11, 'Order the Product Backlog'),
    manual('t_refine', 'team', 12, 'Backlog Refinement: clarify, split, add sub-tasks, estimate'),
    end('t_ready', 'team', 13, 'Stories Ready for Sprint Planning'),
  ],
  annotations: [
    { id: 'n_epic', lane: 'ai', c: 4, r: 1, w: 180, h: 56, attach: 'a_intake', ax: 30, text: 'Draft Epic is created on the PO\'s behalf at intake and completed at backlog generation' },
    { id: 'n_manual', lane: 'team', c: 13, r: 1, w: 200, h: 50, attach: 't_refine', ax: 30, text: 'Human Scrum event: not automated. The pipeline only prepares the input.' },
    { id: 'n_optional', lane: 'ai', c: 5.3, r: 1, w: 260, h: 76, attach: 'a_docs', ax: 30, text: 'Documents can be skipped for any verdict and published once, at any time; the flow never waits for a publish. Approve needs the documents published; the deck stays optional.' },
  ],
  flows: [
    ['c_start', 'c_describe'], ['c_describe', 'c_answer'], ['c_answer', 'c_receive'], ['c_receive', 'c_decide'], ['c_decide', 'c_end'],
    ['a_start', 'a_intake'], ['a_intake', 'a_analysis'], ['a_analysis', 'a_estimate'], ['a_estimate', 'a_docs'],
    ['a_docs', 'a_present'], ['a_present', 'a_decision'], ['a_decision', 'a_gw'],
    ['a_gw', 'a_backlog', 'Approve'],
    ['a_gw', 'a_declined', 'Decline'],
    ['a_backlog', 'po_review'], ['po_review', 'po_order'], ['po_order', 't_refine'], ['t_refine', 't_ready'],
  ],
  messages: [
    { from: 'c_describe', to: 'a_start', n: 'Feature description', lside: 'left' },
    { from: 'a_intake', to: 'c_answer', n: 'Questionnaire', dx: -22, lside: 'left' },
    { from: 'c_answer', to: 'a_intake', n: 'Answers', dx: 22 },
    { from: 'a_present', to: 'c_receive', n: 'Assessment & slides' },
    { from: 'c_decide', to: 'a_decision', n: 'Decision' },
    { from: 'a_intake', to: 'atl', n: 'Draft Epic' },
    { from: 'atl', to: 'a_analysis', n: 'Baseline & backlog' },
    { from: 'a_docs', to: 'atl', n: 'Confluence pages (optional)' },
    { from: 'a_backlog', to: 'atl', n: 'Epic, stories, links' },
    { from: 'po_review', to: 'atl', n: 'Review in Jira' },
    { from: 't_refine', to: 'atl', n: 'Sub-tasks, estimates' },
  ],
};

// ---------------------------------------------------------------------------------------
// 01 Intake & requirements elicitation
// ---------------------------------------------------------------------------------------
const intake = {
  key: 'D01', file: '01-intake-and-elicitation.bpmn', title: '01 Intake & elicitation',
  summary: 'The client\'s free-text idea starts a pipeline run. The Elicitation Agent restates the idea, lists candidate requirements and adds at most 2 feature-specific questions; the pipeline engine creates a draft Epic in Jira on the PO\'s behalf and sends the discovery questionnaire: 10 fixed questions in five areas (business justification, product context, scope, feasibility, decision readiness), the feature questions and an optional comment. Completeness rules classify the answers and find contradictions and gaps; the Discovery Review Agent adds what rules cannot see. The Discovery Completeness Report decides: a complete discovery (or one complete with assumptions) goes to analysis; a blocking contradiction or critical gap gets one clarification round (at most 4 questions); if it is still blocked after the last round, the client continues with a preliminary assessment or stops.',
  pools: [
    CLIENT,
    {
      id: 'ai', name: 'AI PM Pipeline', lanes: [
        { id: 'h', name: 'Pipeline engine (orchestrator, deterministic)', rows: 3, padBottom: 24 },
        { id: 'ag', name: 'Elicitation Agent (Claude + skills)', rows: 2 },
        { id: 'rv', name: 'Discovery Review Agent (Claude + skills)', rows: 2 },
      ],
    },
    ATL,
  ],
  nodes: [
    start('c_start', 'client', 0, 'Feature idea'),
    user('c_describe', 'client', 1, 'Describe the feature in the chat'),
    catchEv('c_q', 'client', 8, 'Questionnaire received', { ev: 'message', lp: 't' }),
    user('c_answer', 'client', 9, 'Answer: single/multi choice, "Not yet determined", comment'),
    end('c_end', 'client', 10, 'Answers submitted'),
    start('c_offer', 'client', 15, 'Preliminary assessment offered', { ev: 'message', r: 1, lp: 't' }),
    user('c_decide', 'client', 16, 'Decide: preliminary assessment or stop', { r: 1 }),
    end('c_decided', 'client', 17, 'Decision sent', { r: 1 }),

    start('h_start', 'h', 1, 'Feature description received', { ev: 'message', r: 1 }),
    service('h_register', 'h', 2, 'Register the request, open a pipeline run, load the baseline digest', { r: 1 }),
    task('g_understand', 'ag', 3, 'Restate the idea; list candidate requirements & feature gaps'),
    task('g_questions', 'ag', 4, 'Add at most 2 feature-specific questions the core set does not cover'),
    service('h_epic', 'h', 5, 'Create draft Epic in Jira on the PO\'s behalf', { r: 1 }),
    service('h_build', 'h', 6, 'Build questionnaire: 10 fixed questions + feature questions + comment', { r: 1 }),
    xor('h_merge', 'h', 7, '', { r: 1 }),
    send('h_send', 'h', 8, 'Send questionnaire to the client chat', { r: 1 }),
    catchEv('h_answers', 'h', 9, 'Answers received', { ev: 'message', r: 1 }),
    service('h_persist', 'h', 10, 'Validate & persist answers (limits, exclusive options, details)', { r: 1 }),
    rule('h_rules', 'h', 11, 'Completeness rules: coverage, contradictions, gaps, evidence, approval', { r: 1 }),
    task('v_review', 'rv', 12, 'Review what rules cannot see; findings by kind, assumptions'),
    service('h_report', 'h', 13, 'Discovery Completeness Report; open points to the Assumption Log', { r: 1 }),
    xor('h_result', 'h', 14, 'Result?', { r: 1, lp: 'tl' }),
    end('h_complete', 'h', 15, 'Discovery verified: go to analysis', { r: 1 }),
    service('h_clarify', 'h', 15, 'Prepare clarification questions (at most 4, predefined answers)', { r: 2 }),
    send('h_offer', 'h', 15, 'Offer a preliminary assessment or stop', { r: 0 }),
    catchEv('h_decision', 'h', 16, 'Client decision received', { ev: 'message', r: 0 }),
    service('h_record', 'h', 17, 'Record the client\'s decision', { r: 0 }),
    xor('h_continue', 'h', 18, 'Continue?', { r: 0 }),
    end('h_preliminary', 'h', 19, 'Preliminary discovery: go to analysis', { r: 0 }),
    end('h_stopped', 'h', 19, 'Stopped by the client: run declined', { r: 1 }),
  ],
  dataStores: [
    { id: 'db1', lane: 'h', c: 2, r: 0, n: 'Pipeline DB (PostgreSQL)', lp: 't' },
    { id: 'db2', lane: 'h', c: 10, r: 0, n: 'Pipeline DB', lp: 't' },
  ],
  data: [['h_register', 'db1'], ['h_persist', 'db2']],
  annotations: [
    {
      id: 'n_core', lane: 'h', c: 6, r: 2, w: 320, h: 118, attach: 'h_build',
      text: 'Core questionnaire (config/discovery.yaml): 10 fixed questions in five areas: business justification, product context, scope, feasibility, decision readiness. Single or multi choice with limits, exclusive options ("Not yet determined"), detail fields. Never asks for effort, cost or uplift.',
    },
    {
      id: 'n_feature', lane: 'ag', c: 4, r: 1, w: 200, h: 56, attach: 'g_questions',
      text: 'Only topics the core questions miss; never technical estimates.',
    },
    {
      id: 'n_review', lane: 'rv', c: 12, r: 1, w: 300, h: 70, attach: 'v_review',
      text: 'Adds only what rules cannot see: description vs. answers, comments, feature answers. Labels each finding confirmed, client assumption, AI hypothesis or missing.',
    },
    {
      id: 'n_result', lane: 'h', c: 13.3, r: 2, w: 210, h: 114, dy: -4, attach: 'h_report',
      text: 'Complete (or with assumptions: open points recorded, results preliminary) → analysis. Needs clarification: blocking contradiction or critical gap, round < 2. Insufficient: still blocked after the last round.',
    },
  ],
  flows: [
    ['c_start', 'c_describe'], ['c_describe', 'c_q'], ['c_q', 'c_answer'], ['c_answer', 'c_end'],
    ['c_offer', 'c_decide'], ['c_decide', 'c_decided'],
    ['h_start', 'h_register'], ['h_register', 'g_understand'], ['g_understand', 'g_questions'], ['g_questions', 'h_epic'],
    ['h_epic', 'h_build'], ['h_build', 'h_merge'], ['h_merge', 'h_send'], ['h_send', 'h_answers'],
    ['h_answers', 'h_persist'], ['h_persist', 'h_rules'], ['h_rules', 'v_review'], ['v_review', 'h_report'],
    ['h_report', 'h_result'],
    ['h_result', 'h_complete', 'Complete'],
    ['h_result', 'h_clarify', 'Needs clarification'],
    ['h_result', 'h_offer', 'Insufficient'],
    ['h_clarify', 'h_merge', null, { via: 'bottom' }],
    ['h_offer', 'h_decision'], ['h_decision', 'h_record'], ['h_record', 'h_continue'],
    ['h_continue', 'h_preliminary', 'Yes: preliminary assessment'],
    ['h_continue', 'h_stopped', 'No: stop'],
  ],
  messages: [
    { from: 'c_describe', to: 'h_start', n: 'Feature description' },
    { from: 'h_epic', to: 'atl', n: 'Create Epic (Draft)' },
    { from: 'h_send', to: 'c_q', n: 'Questionnaire' },
    { from: 'c_answer', to: 'h_answers', n: 'Answers + comment' },
    { from: 'h_report', to: 'client', n: 'Discovery report' },
    { from: 'h_offer', to: 'c_offer', n: 'Preliminary assessment or stop?' },
    { from: 'c_decide', to: 'h_decision', n: 'Decision + comment' },
  ],
};

// ---------------------------------------------------------------------------------------
// 02 Requirements analysis, impact & dependencies
// ---------------------------------------------------------------------------------------
const analysis = {
  key: 'D02', file: '02-requirements-analysis-and-impact.bpmn', title: '02 Analysis & impact',
  summary: 'The Requirements Analyst sorts requirements into functional and non-functional (ISO 25010), sets MoSCoW priorities, defines the MVP slice and checks for conflicts with the GDD, DoD and current backlog. The pipeline engine fetches those pages and issues from Atlassian and puts them into the prompts; the agents have no tools. At the same time, the Impact Agent maps the feature onto the game\'s components and lists dependencies. A business rule then classifies the change as UI/cosmetic, feature extension or core-engine change. A core-engine change, such as physics or netcode, adds a technical spike.',
  pools: [
    {
      id: 'ai', name: 'AI PM Pipeline', lanes: [
        { id: 'h', name: 'Pipeline engine (deterministic)', rows: 2, padTop: 16 },
        { id: 'ra', name: 'Requirements Analyst Agent' },
        { id: 'ia', name: 'Impact & Dependency Agent', rows: 2 },
      ],
    },
    ATL,
  ],
  nodes: [
    start('h_start', 'h', 0, 'Elicited requirements baseline'),
    service('h_ctx', 'h', 1, 'Fetch context for the agents: backlog (JQL), GDD, DoD, architecture'),
    task('ra_cat', 'ra', 2, 'Categorize: functional vs non-functional (ISO 25010)'),
    task('ra_prio', 'ra', 3, 'Prioritize (MoSCoW) and define the MVP slice'),
    task('ra_conf', 'ra', 4, 'Detect conflicts & duplicates vs GDD, DoD, backlog'),
    and('ra_split', 'ra', 5, ''),
    task('ra_assume', 'ra', 6, 'Identify assumptions & constraints (time, budget, platform, compliance)'),
    task('ia_impact', 'ia', 6, 'Map impact on game components & performance budget'),
    task('ia_deps', 'ia', 7, 'Identify dependencies: components, SDKs, other Epics, skills'),
    and('ra_join', 'ra', 8, ''),
    rule('h_classify', 'h', 9, 'Classify change magnitude'),
    xor('h_core', 'h', 10, 'Core engine affected?'),
    task('ia_spike', 'ia', 11, 'Propose technical spike & architecture notes'),
    xor('h_merge', 'h', 12, ''),
    service('h_persist', 'h', 13, 'Validate & persist analysis (REQ IDs, relations, impacts)'),
    end('h_end', 'h', 14, 'Analyzed requirements'),
  ],
  dataStores: [{ id: 'db', lane: 'h', c: 13, r: 1, n: 'Pipeline DB' }],
  data: [['h_persist', 'db']],
  annotations: [
    {
      id: 'n_rule', lane: 'h', c: 9, r: 1, w: 250, h: 76, attach: 'h_classify',
      text: 'UI/cosmetic: new screens, skins, assets only. Feature extension: new mechanics on existing systems. Core engine: physics, movement, netcode, save format or frame budget.',
    },
    {
      id: 'n_components', lane: 'ia', c: 8.7, r: 1, w: 240, h: 66, attach: 'ia_impact', ax: 40,
      text: 'Component map from the Architecture Overview page (in the prompt): physics, rendering, input, level generator, UI/HUD, economy & store, backend, ads & analytics SDKs',
    },
  ],
  flows: [
    ['h_start', 'h_ctx'], ['h_ctx', 'ra_cat'], ['ra_cat', 'ra_prio'], ['ra_prio', 'ra_conf'], ['ra_conf', 'ra_split'],
    ['ra_split', 'ra_assume'], ['ra_split', 'ia_impact'], ['ia_impact', 'ia_deps'],
    ['ra_assume', 'ra_join'], ['ia_deps', 'ra_join'],
    ['ra_join', 'h_classify'], ['h_classify', 'h_core'],
    ['h_core', 'ia_spike', 'Yes'], ['h_core', 'h_merge', 'No'], ['ia_spike', 'h_merge'],
    ['h_merge', 'h_persist'], ['h_persist', 'h_end'],
  ],
  messages: [
    { from: 'atl', to: 'h_ctx', n: 'Backlog, GDD, DoD, architecture' },
  ],
};

// ---------------------------------------------------------------------------------------
// 03 Estimation, business value & risk
// ---------------------------------------------------------------------------------------
const estimation = {
  key: 'D03', file: '03-estimation-value-and-risk.bpmn', title: '03 Estimation, value & risk',
  summary: 'Three agents work in parallel. The Estimator drafts a story map with three-point estimates, the Risk Analyst builds a cause-event-effect risk list with P×I scores, and the Value Analyst estimates value drivers in three scenarios. All arithmetic happens in the pipeline engine, never in the model: PERT roll-up, Monte Carlo release forecast (P50/P85), resources and budget with EMV contingency, ROI/NPV/payback and WSJF. A business rule sets the verdict: Go, Go with conditions or No-Go.',
  pools: [
    ATL,
    {
      id: 'ai', name: 'AI PM Pipeline', lanes: [
        { id: 'h', name: 'Pipeline engine (deterministic calculators)', rows: 2, padTop: 16 },
        { id: 'es', name: 'Estimator Agent' },
        { id: 'rk', name: 'Risk Analyst Agent' },
        { id: 'va', name: 'Value Analyst Agent' },
      ],
    },
  ],
  nodes: [
    start('h_start', 'h', 0, 'Analyzed requirements'),
    and('rk_split', 'rk', 1, ''),
    task('es_map', 'es', 2, 'Draft story map: candidate stories & spikes'),
    task('es_size', 'es', 3, 'Relative sizing + three-point estimates (O / M / P)'),
    service('h_vel', 'h', 4, 'Fetch velocity history & team capacity'),
    script('h_mc', 'h', 5, 'PERT roll-up + Monte Carlo release forecast'),
    task('rk_identify', 'rk', 2, 'Identify risks (cause, event, effect)'),
    task('rk_assess', 'rk', 3, 'Score probability × impact; responses, owners, triggers'),
    task('va_value', 'va', 2, 'Estimate value drivers in 3 scenarios (retention, ARPDAU, ads)'),
    and('rk_join', 'rk', 7, ''),
    script('h_budget', 'h', 8, 'Resources & budget: roles × sprints × rates + EMV contingency'),
    script('h_roi', 'h', 9, 'ROI, NPV, payback & WSJF'),
    rule('h_verdict', 'h', 10, 'Feasibility verdict'),
    service('h_persist', 'h', 11, 'Persist estimates, forecast, budget, risks, value'),
    end('h_end', 'h', 12, 'Assessment data ready'),
  ],
  dataStores: [{ id: 'db', lane: 'h', c: 11, r: 1, n: 'Pipeline DB' }],
  data: [['h_persist', 'db']],
  annotations: [
    {
      id: 'n_mc', lane: 'h', c: 5, r: 1, w: 200, h: 74, attach: 'h_mc',
      text: 'PERT E = (O + 4M + P) / 6. Monte Carlo, 10,000 runs, velocity resampled from past sprints, capacity share for this Epic.',
    },
    {
      id: 'n_roi', lane: 'h', c: 9, r: 1, w: 260, h: 112, attach: 'h_roi',
      text: 'Inputs: KPI baseline from the Business Case (DAU, ARPDAU, retention) and the Value Analyst\'s KPI effects per scenario, within benchmark ranges (not the client\'s hopes; no evidence → no effect in the pessimistic case). WSJF = cost of delay / job size.',
    },
    {
      id: 'n_rule', lane: 'es', c: 10, w: 400, h: 104, attach: 'h_verdict',
      text: 'No-Go if any of: (1) even the MVP misses a hard deadline, at P85 and at P50; (2) the P85 cost is more than 1.25 × the budget limit (the client\'s limit, else the remaining approved budget); (3) a critical risk (score ≥ 20) is accepted without mitigation; (4) even the optimistic value case does not cover the cost. Thresholds: config/feasibility-rules.yaml.',
    },
  ],
  flows: [
    ['h_start', 'rk_split', null, { mode: 'mid' }],
    ['rk_split', 'es_map'], ['rk_split', 'rk_identify'], ['rk_split', 'va_value'],
    ['es_map', 'es_size'], ['es_size', 'h_vel'], ['h_vel', 'h_mc'], ['h_mc', 'rk_join'],
    ['rk_identify', 'rk_assess'], ['rk_assess', 'rk_join'],
    ['va_value', 'rk_join'],
    ['rk_join', 'h_budget', null, { mode: 'mid' }],
    ['h_budget', 'h_roi'], ['h_roi', 'h_verdict'], ['h_verdict', 'h_persist'], ['h_persist', 'h_end'],
  ],
  messages: [
    { from: 'atl', to: 'h_vel', n: 'Closed sprints (velocity)' },
  ],
};

// ---------------------------------------------------------------------------------------
// 04 PM documentation & Confluence publishing
// ---------------------------------------------------------------------------------------
const docs = {
  key: 'D04', file: '04-documentation-and-confluence.bpmn', title: '04 Documents & Confluence',
  summary: 'Once the assessment is ready, the Documents card offers two buttons. "Generate documents" runs the PM Writer: it drafts the text of all documents in one call, from their templates and only from pipeline DB data; the pipeline engine fills in every table and figure and reuses the draft while the assessment is unchanged. The pipeline engine checks each document (template sections, every figure equal to the DB value, known requirement IDs, acceptance criteria for every MVP requirement) and sends flagged sections back for at most two repairs. The documents are saved as generated, with previews on the card and the Documents tab, and the run goes straight on to the presentation: it never waits for a publish. "Publish to Confluence" works once, at any time after generating, and is needed to approve the feature: it creates the Feature Brief, the Requirements Specification, the Estimation & Release Forecast and, only when the roadmap changes, a Roadmap Update Proposal, adds this feature\'s block to the shared Risk Register and Assumption Log, and then reads "Published"; there is no re-publish. For any verdict the client may also "Skip for now" and go straight to the proposal; Decline works without documents, while Approve needs them generated and published, which the client can still do at the decision.',
  pools: [
    { ...CLIENT, lanes: [{ id: 'client', name: 'Client (feature sponsor)', rows: 2 }] },
    {
      id: 'ai', name: 'AI PM Pipeline', lanes: [
        { id: 'h', name: 'Pipeline engine (deterministic)', rows: 2, padTop: 16 },
        { id: 'wr', name: 'PM Writer Agent', rows: 2 },
      ],
    },
    ATL,
  ],
  nodes: [
    start('c_start', 'client', 0, 'Assessment ready'),
    xor('c_gw', 'client', 1, 'Generate or skip?'),
    user('c_generate', 'client', 2, 'Press "Generate documents"'),
    user('c_skip', 'client', 1, '"Skip for now" (any verdict; Approve still needs the documents)', { r: 1 }),
    end('c_skipped', 'client', 2, 'Skipped: on to the proposal', { r: 1 }),
    catchEv('c_ready', 'client', 7, 'Documents ready, with previews', { ev: 'message', lp: 't' }),
    xor('c_pubgw', 'client', 8, 'Publish now?'),
    user('c_publish', 'client', 9, '"Publish to Confluence" (once; needed to approve)'),
    end('c_end', 'client', 10, 'On to the proposal'),

    start('h_start', 'h', 0, 'Assessment data ready'),
    catchEv('h_wait', 'h', 2, 'Client generates the documents', { ev: 'message' }),
    catchEv('h_skip', 'h', 1, 'Client skips the documents', { ev: 'message', r: 1 }),
    end('h_skipped', 'h', 2, 'No documents: on to the presentation', { r: 1 }),
    service('h_ctx', 'h', 3, 'Build document context from the DB (single source of truth)'),
    task('wr_draft', 'wr', 4, 'Draft the text of all documents (one call)'),
    service('h_check', 'h', 5, 'Validate each document: sections, figures = DB, REQ IDs, acceptance criteria', { mi: 'parallel' }),
    xor('h_gw', 'h', 6, 'All documents valid?'),
    task('wr_fix', 'wr', 6, 'Repair flagged sections'),
    service('h_save', 'h', 7, 'Save as generated (nothing in Confluence); previews on the card'),
    end('h_next', 'h', 8, 'Generated: on to the presentation, no wait for a publish'),
    catchEv('h_pub', 'h', 9, 'Client publishes (optional, once)', { ev: 'message', r: 1 }),
    service('h_pages', 'h', 10, 'Create the feature pages in Confluence', { r: 1 }),
    service('h_living', 'h', 11, 'Add the feature block to the Risk Register and Assumption Log', { r: 1 }),
    service('h_links', 'h', 12, 'Store page IDs & links; the button reads "Published"', { r: 1 }),
    end('h_published', 'h', 13, 'Documents published', { r: 1 }),
  ],
  dataStores: [
    { id: 'db1', lane: 'h', c: 3, r: 1, n: 'Pipeline DB' },
    { id: 'db2', lane: 'h', c: 12, r: 0, n: 'Pipeline DB' },
  ],
  data: [['db1', 'h_ctx'], ['h_links', 'db2']],
  annotations: [
    {
      id: 'n_docs', lane: 'wr', c: 4, r: 1, w: 380, h: 116, attach: 'wr_draft', ax: -30,
      text: 'One call writes the text of: Feature Brief (problem, objectives, value, scope, impact, recommendation), Requirements Specification (user flows, business rules, acceptance criteria), Estimation & Release Forecast (sequencing, confidence) and, when needed, the Roadmap Update Proposal. Computed values only as {{figure:key}}. The draft is reused while the assessment is unchanged.',
    },
    {
      id: 'n_tree', lane: 'wr', c: 10, r: 0, w: 300, h: 96, attach: 'h_pages',
      text: 'Space > Feature Assessments > FA-<n> Feature Brief (Epic key) > Requirements Specification, Estimation & Release Forecast, Roadmap Update Proposal (only when the roadmap changes). Published once: no re-publish. Later steps update pages already published (decision, Epic, deck), never a first publish.',
    },
  ],
  flows: [
    ['c_start', 'c_gw'], ['c_gw', 'c_generate', 'Generate'], ['c_gw', 'c_skip', 'Skip'], ['c_skip', 'c_skipped'],
    ['c_generate', 'c_ready'], ['c_ready', 'c_pubgw'], ['c_pubgw', 'c_publish', 'Yes'], ['c_pubgw', 'c_end', 'Later (before Approve) or never', { via: 'bottom' }],
    ['c_publish', 'c_end'],
    ['h_start', 'h_wait'], ['h_start', 'h_skip'], ['h_skip', 'h_skipped'],
    ['h_wait', 'h_ctx'], ['h_ctx', 'wr_draft'], ['wr_draft', 'h_check'], ['h_check', 'h_gw'],
    ['h_gw', 'wr_fix', 'No (max 2 repairs)'], ['wr_fix', 'h_check', null, { via: 'bottom' }],
    ['h_gw', 'h_save', 'Yes'], ['h_save', 'h_next'],
    ['h_pub', 'h_pages'], ['h_pages', 'h_living'], ['h_living', 'h_links'], ['h_links', 'h_published'],
  ],
  messages: [
    { from: 'c_generate', to: 'h_wait', n: 'Generate documents' },
    { from: 'c_skip', to: 'h_skip', n: 'Skip for now' },
    { from: 'h_save', to: 'c_ready', n: 'Previews on the Documents card' },
    { from: 'c_publish', to: 'h_pub', n: 'Publish to Confluence' },
    { from: 'h_pages', to: 'atl', n: 'Create pages' },
    { from: 'h_living', to: 'atl', n: 'Add feature block' },
  ],
};

// ---------------------------------------------------------------------------------------
// 05 Client presentation & decision
// ---------------------------------------------------------------------------------------
const presentation = {
  key: 'D05', file: '05-client-presentation-and-decision.bpmn', title: '05 Presentation & decision',
  summary: 'A three-slide client proposal: business opportunity, proposed solution & scope, and delivery feasibility & recommendation. It follows the documents step whether the documents were generated or skipped; while it is prepared, the chat shows a "please wait" placeholder. The Presenter Agent words the conclusion headings, the player flow, four core capabilities, the scope boundary, the key dependencies and the suggested verdict in one call; the pipeline engine fills in every number (KPI impact range, delivery date range and budget range at P50–P85, never story points) and marks every slide as a preliminary AI assessment, not a commitment. It shows the slides in the chat with a PPTX download, then the assessment summary and the decision buttons right away. Publishing the deck to Confluence is optional and the client\'s own action: possible once the documents are published (the PPTX goes on the Feature Brief, which then embeds it), once only, and the decision never waits for it. Approve needs the documents published: if they are not, the Approve button is locked with a hint, and a click gets a chat message asking to generate and publish them (or only publish, when they are generated); the client does that on the Documents card and approves again. An accepted Approve starts backlog generation, which records the decision on the Feature Brief together with the Epic. Decline records the decision on the Feature Brief and in the Assumption Log (if published), closes the draft Epic and ends the conversation; the Backlog step turns red.',
  pools: [
    { ...CLIENT, lanes: [{ id: 'client', name: 'Client (feature sponsor)', rows: 2 }] },
    {
      id: 'ai', name: 'AI PM Pipeline', lanes: [
        { id: 'h', name: 'Pipeline engine (deterministic)', rows: 3 },
        { id: 'pr', name: 'Presenter Agent', rows: 2 },
      ],
    },
    ATL,
  ],
  nodes: [
    start('c_start', 'client', 4, 'Proposal received', { ev: 'message', lp: 't' }),
    user('c_review', 'client', 5, 'Review the three slides'),
    xor('c_gw', 'client', 6, 'Publish the deck?'),
    user('c_pub', 'client', 6, 'Optional: "Publish to Confluence" (documents published; once)', { r: 1 }),
    user('c_decide', 'client', 9, 'Decide: Approve / Decline'),
    end('c_end', 'client', 10, 'Decision sent'),
    user('c_fix', 'client', 12, 'Generate and publish the documents (Documents card), then approve again', { r: 1 }),

    start('h_start', 'h', 0, 'Documents generated or skipped', { r: 1 }),
    task('pr_insights', 'pr', 1, 'Pick the message: opportunity, solution, feasibility'),
    task('pr_story', 'pr', 2, 'Word the three slides (one call)'),
    service('h_render', 'h', 3, 'Fill in figures & KPI chart; render slides; PPTX download', { r: 1 }),
    send('h_present', 'h', 4, 'Proposal card, question, decision buttons in the chat', { r: 1 }),
    catchEv('h_pub', 'h', 6, 'Client publishes the deck', { ev: 'message', r: 0 }),
    service('h_attach', 'h', 7, 'Attach the PPTX to the Feature Brief; re-render the Brief to embed it', { r: 0 }),
    end('h_pubend', 'h', 8, 'Deck published: the button reads "Published"', { r: 0 }),
    catchEv('h_decision', 'h', 9, 'Decision received', { ev: 'message', r: 1 }),
    xor('h_gw', 'h', 10, 'Decision?', { r: 1, lp: 'tl' }),
    xor('h_docs', 'h', 11, 'Documents published?', { r: 0, lp: 't' }),
    send('h_block', 'h', 12, 'Approve locked: ask to generate and publish the documents', { r: 1 }),
    service('h_log', 'h', 13, 'Save the approval in the DB', { r: 0 }),
    end('h_approved', 'h', 14, 'Approved: start backlog generation', { r: 0 }),
    service('h_decline', 'h', 11, 'Save the decline; record it on the Brief & Assumption Log (if published); close the draft Epic', { r: 2 }),
    end('h_declined', 'h', 12, 'Declined: chat closed, Backlog red', { r: 2 }),
  ],
  dataStores: [{ id: 'db', lane: 'h', c: 13.5, r: 1, n: 'Pipeline DB' }],
  data: [['h_log', 'db']],
  annotations: [
    {
      id: 'n_slides', lane: 'pr', c: 2.3, r: 1, w: 400, h: 112, attach: 'pr_story',
      text: 'Three slides: 1 Business opportunity (objective, target KPI, impact range, audience, value; KPI impact chart). 2 Proposed solution & scope (player flow, four capabilities, counts, one scope boundary). 3 Delivery feasibility & recommendation (date range, budget range, major risks, key dependencies, suggested verdict). No story points; every slide says preliminary, not a commitment.',
    },
    {
      id: 'n_deck', lane: 'pr', c: 6.5, r: 0, w: 300, h: 80, attach: 'h_attach',
      text: 'Optional and once: greyed out until the documents are published, then green, then "Published" with the Confluence link. The decision does not wait for it.',
    },
  ],
  flows: [
    ['c_start', 'c_review'], ['c_review', 'c_gw'], ['c_gw', 'c_pub', 'Yes'], ['c_gw', 'c_decide', 'No'],
    ['c_pub', 'c_decide'], ['c_decide', 'c_end'], ['c_fix', 'c_decide', null, { via: 'top' }],
    ['h_start', 'pr_insights'], ['pr_insights', 'pr_story'], ['pr_story', 'h_render'],
    ['h_render', 'h_present'], ['h_present', 'h_decision'], ['h_decision', 'h_gw'],
    ['h_gw', 'h_docs', 'Approve', { lseg: 1 }], ['h_gw', 'h_decline', 'Decline'],
    ['h_docs', 'h_log', 'Yes'], ['h_docs', 'h_block', 'No'], ['h_block', 'h_decision', null, { via: 'bottom' }],
    ['h_log', 'h_approved'], ['h_decline', 'h_declined'],
    ['h_pub', 'h_attach'], ['h_attach', 'h_pubend'],
  ],
  messages: [
    { from: 'h_present', to: 'c_start', n: 'Slides + summary' },
    { from: 'c_pub', to: 'h_pub', n: 'Publish to Confluence' },
    { from: 'h_attach', to: 'atl', n: 'PPTX attachment, Brief update' },
    { from: 'c_decide', to: 'h_decision', n: 'Decision + comment' },
    { from: 'h_decline', to: 'atl', n: 'Decision on Brief & log; Epic closed' },
    { from: 'h_block', to: 'c_fix', n: 'Generate and publish first' },
  ],
};

// ---------------------------------------------------------------------------------------
// 06 Backlog generation, PO review & Backlog Refinement
// ---------------------------------------------------------------------------------------
const backlog = {
  key: 'D06', file: '06-backlog-generation-and-refinement.bpmn', title: '06 Backlog & refinement',
  summary: "After the client approves, the feature goes to Jira as an AI draft for the Product Owner's review: part of the Product Backlog, not a sprint plan. A coverage gate first checks that every requirement in scope (all but Won't) has a story-map item. The Backlog Builder writes the Epic text and one story per story-map item in one call: a Connextra statement, context, Gherkin acceptance criteria (NFR criteria name their measure), blockers and open questions. A Definition of Ready gate sends problems back for at most two repairs. Code sets the proposed priority (MoSCoW, one step up for starting points that unblock others), the AI estimate (PERT expected points) and the labels. The pipeline engine then creates or completes the Epic and creates the stories under it, all in To Do, with no sprint and with Story Points empty. It adds the Blocks links and the feature's block on the Initial Product Backlog page, re-renders the Feature Brief with the decision and the Epic link if the client published the documents (the pipeline never publishes them on its own), and stores the Jira keys. Every write is idempotent: a second run updates the same issues. The chat gets one backlog card with the Epic link, the conversation closes, and the Backlog tab appears. People take over from there: the PO reviews and orders the backlog, and the Scrum Team refines and estimates it.",
  pools: [
    ATL,
    {
      id: 'org', name: 'Delivery organization', lanes: [
        { id: 'h', name: 'AI PM: Pipeline engine', rows: 2, padTop: 16 },
        { id: 'bb', name: 'AI PM: Backlog Builder Agent', padBottom: 30 },
        { id: 'po', name: 'Product Owner' },
        { id: 'team', name: 'Scrum Team (Developers)', rows: 2 },
      ],
    },
  ],
  nodes: [
    start('h_start', 'h', 0, 'Client approved the feature (documents published)'),
    service('h_cov', 'h', 1, "Coverage gate: every requirement (except Won't) has a story"),
    task('bb_write', 'bb', 2, 'Write the Epic text and one story per item: Connextra, Gherkin AC, blockers (one call)'),
    service('h_gate', 'h', 3, 'DoR gate: one story per item, Connextra, blockers without cycles, no sizes'),
    xor('h_ok', 'h', 4, 'Gate passed?'),
    service('h_plan', 'h', 5, 'Proposed priority, AI estimate (PERT), labels ai-draft & fa-<n>'),
    service('h_epic', 'h', 6, 'Create or complete the Epic; link the Feature Brief'),
    service('h_create', 'h', 7, 'Create or update the stories under the Epic'),
    service('h_links', 'h', 8, 'Create "Blocks" links'),
    service('h_conf', 'h', 9, 'Initial Product Backlog block; re-render the Feature Brief (if published)'),
    service('h_keys', 'h', 10, 'Store the Jira keys in the DB'),
    send('h_card', 'h', 11, 'Backlog card with the Epic link; chat closed; Backlog tab'),
    user('po_review', 'po', 12, 'Review & adjust the AI draft in Jira; remove ai-draft'),
    user('po_order', 'po', 13, 'Order the Product Backlog; mark "Ready for refinement"'),
    manual('t_refine', 'team', 14, 'Backlog Refinement: clarify, split, add sub-tasks'),
    user('t_estimate', 'team', 15, 'Estimate (Planning Poker) & confirm DoR'),
    end('t_end', 'team', 16, 'Stories Ready for Sprint Planning'),
  ],
  dataStores: [{ id: 'db', lane: 'h', c: 10, r: 1, n: 'Pipeline DB' }],
  data: [['h_keys', 'db']],
  annotations: [
    {
      id: 'n_jira', lane: 'h', c: 6.5, r: 1, w: 300, h: 92, attach: 'h_create',
      text: 'Every issue: status To Do, no sprint, label ai-draft (plus ai-pm, fa-<n>, and enabler, nfr or spike), proposed priority "pending PO review", AI-generated description with Gherkin AC, custom field "AI estimate (SP)". Story Points stay empty for the team. Found again by sync log and marker label: no duplicates.',
    },
    { id: 'n_manual', lane: 'team', c: 14, r: 1, w: 210, h: 50, attach: 't_refine', text: 'Human Scrum event: not automated. The pipeline only prepares the input.' },
  ],
  flows: [
    ['h_start', 'h_cov'], ['h_cov', 'bb_write'], ['bb_write', 'h_gate'], ['h_gate', 'h_ok'],
    ['h_ok', 'bb_write', 'No: repair (at most 2)', { via: 'bottom' }],
    ['h_ok', 'h_plan', 'Yes'], ['h_plan', 'h_epic'], ['h_epic', 'h_create'], ['h_create', 'h_links'], ['h_links', 'h_conf'],
    ['h_conf', 'h_keys'], ['h_keys', 'h_card'],
    ['h_card', 'po_review'], ['po_review', 'po_order'], ['po_order', 't_refine'], ['t_refine', 't_estimate'], ['t_estimate', 't_end'],
  ],
  messages: [
    { from: 'h_epic', to: 'atl', n: 'Epic' },
    { from: 'h_create', to: 'atl', n: 'Stories' },
    { from: 'h_links', to: 'atl', n: 'Issue links' },
    { from: 'h_conf', to: 'atl', n: 'Confluence pages' },
    { from: 'po_review', to: 'atl', n: 'Review in Jira' },
    { from: 't_refine', to: 'atl', n: 'Sub-tasks' },
    { from: 't_estimate', to: 'atl', n: 'Story points' },
  ],
};

export const diagrams = [overview, intake, analysis, estimation, docs, presentation, backlog];
