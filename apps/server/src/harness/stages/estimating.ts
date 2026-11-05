import type { AnsweredQuestionnaire, Assessment } from '@ai-pm/shared';
import type { EstimationResult, RiskAssessment, ValueAssessment } from '../../agents/schemas.js';
import type { SeedData } from '../../baseline/seed-data.js';
import type { StoredAnalysis } from '../analysis-repository.js';
import { buildAssessment, type Deadline, type PlanningFacts } from '../assessment.js';
import { parseDate, parseMoney } from '../calculators/calendar.js';
import { seedFrom } from '../calculators/random.js';
import { CLARIFY_PREFIX, evaluateAnswers, reportForPrompt } from '../discovery.js';
import type { StageHandler } from '../orchestrator.js';
import type { StageServices } from '../services.js';
import type { DiscoveryOutput } from './eliciting.js';
import { clientRequest, section } from './prompts.js';

const FACT_TYPES = [
  'project_charter',
  'team_velocity',
  'business_case',
  'product_roadmap',
  'initial_backlog',
  'risk_register',
  'stakeholder_register',
  'definition_of_done',
];

/** Clarification answers that make a date firm, or say it can move. */
const FIRM = ['firm_date', 'date_is_firm'];
const SOFT = ['important_flexible', 'date_can_move', 'decision_date'];

/** The deadline and budget limit the client stated, in all rounds. */
export function clientConstraints(answered: AnsweredQuestionnaire[]) {
  const values = new Map<string, string[]>();
  const details: Record<string, string> = {};
  for (const q of answered) {
    for (const [id, v] of Object.entries(q.answers)) values.set(id, v);
    Object.assign(details, q.details ?? {});
  }
  const has = (id: string, value: string) => values.get(id)?.includes(value) ?? false;
  const clarify = [...values.entries()].filter(([id]) => id.startsWith(CLARIFY_PREFIX));
  const firm = clarify.some(([, v]) => v.some((x) => FIRM.includes(x)));
  const soft = clarify.some(([, v]) => v.some((x) => SOFT.includes(x)));
  const clarifiedText = clarify
    .flatMap(([id, v]) => v.filter((x) => FIRM.includes(x)).map((x) => details[`${id}:${x}`]))
    .find(Boolean);
  const text =
    clarifiedText ??
    (has('constraints', 'fixed_deadline') ? details['constraints:fixed_deadline'] : undefined) ??
    (has('priority', 'critical') ? details['priority:critical'] : undefined) ??
    null;
  const hard = !soft && (firm || has('constraints', 'fixed_deadline') || has('priority', 'critical'));
  const budgetText = has('constraints', 'fixed_budget')
    ? (details['constraints:fixed_budget'] ?? null)
    : null;
  return {
    deadline: {
      text,
      date: text ? parseDate(text) : null,
      hard,
      source: (clarifiedText ? 'clarification' : text ? 'answer' : 'none') as Deadline['source'],
    },
    budget: { text: budgetText, amountUsd: budgetText ? parseMoney(budgetText) : null },
  };
}

const requirementLines = (a: StoredAnalysis) =>
  a.requirements
    .map(
      (r) =>
        `- ${r.code} [${r.type}, ${r.moscow}${r.inMvp ? ', MVP' : ''}, ${r.source}] ${r.title}: ${r.description}`,
    )
    .join('\n') || '(none)';

function analysisSection(a: StoredAnalysis) {
  return [
    `Change magnitude: ${a.magnitude}. ${a.magnitudeReason}`,
    `MVP slice: ${a.mvpSummary}`,
    `Component impacts:\n${a.impacts.map((i) => `- ${i.component}: ${i.level} (${i.rationale})`).join('\n') || '- (none)'}`,
    `Dependencies:\n${a.dependencies.map((d) => `- [${d.type}${d.blocking ? ', blocking' : ''}] ${d.target}: ${d.description}`).join('\n') || '- (none)'}`,
    `Conflicts:\n${a.conflicts.map((c) => `- [${c.kind}${c.blocking ? ', blocking' : ''}] with ${c.with}: ${c.description}`).join('\n') || '- (none)'}`,
    `Technical spike: ${a.spike.needed ? `${a.spike.question ?? 'yes'}${a.spike.timeboxDays ? ` (${a.spike.timeboxDays} days)` : ''}` : 'none'}`,
    `Performance risks:\n${a.performanceRisks.map((r) => `- ${r}`).join('\n') || '- (none)'}`,
  ].join('\n\n');
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** The headline figures, for the chat card and the decision gate. */
export function highlights(a: Assessment): string[] {
  const base = a.value.scenarios.find((s) => s.name === 'base');
  return [
    `MVP by ${a.forecast.mvp.dates.p85}, full scope by ${a.forecast.full.dates.p85} (P85; P50 ${a.forecast.full.dates.p50})`,
    `Cost ${usd(a.budget.total.p50)} at P50, ${usd(a.budget.total.p85)} at P85 (${Math.round(a.budget.limitUsage * 100)} % of the budget limit)`,
    `Base case: ROI ${Math.round((base?.roi ?? 0) * 100)} %, NPV ${usd(base?.npvUsd ?? 0)}${base?.paybackMonth ? `, payback in month ${base.paybackMonth}` : ', no payback within the horizon'}`,
    `${a.risks.length} risks (${a.risks.filter((r) => r.level === 'high' || r.level === 'critical').length} high or critical); WSJF ${a.wsjf.score}`,
  ];
}

/**
 * BPMN 03: estimate, forecast, budget, risks, value and verdict. The estimator, risk analyst and
 * value analyst run in parallel; the harness computes every number and saves the assessment for
 * the Analysis tab.
 */
export function estimatingStage(services: StageServices): StageHandler {
  return async (ctx) => {
    const { run } = ctx;
    const [discovery, answered, discoveryDecision, analysis, data] = await Promise.all([
      ctx.repo.latestStageOutput(run.id, 'eliciting') as Promise<Partial<DiscoveryOutput> | null>,
      ctx.repo.answeredQuestionnaires(run.id),
      ctx.repo.latestDecision(run.id, 'discovery'),
      services.analysis.analysisOf(run.id),
      services.context.baselineData(run.projectId, FACT_TYPES),
    ]);
    const charter = data.project_charter as { project: SeedData['project'] } | undefined;
    const facts: PlanningFacts = {
      project: charter?.project as SeedData['project'],
      team: data.team_velocity as SeedData['team'],
      kpis: data.business_case as SeedData['kpis'],
      roadmap: data.product_roadmap as SeedData['roadmap'],
      backlog: data.initial_backlog as SeedData['backlog'],
    };
    if (!facts.project || !facts.team || !facts.kpis || !facts.roadmap || !facts.backlog) {
      throw new Error('The project baseline is incomplete; run the seed (npm run seed) first.');
    }
    const risksData = data.risk_register as SeedData['risks'] | undefined;
    const stakeholders = data.stakeholder_register as SeedData['stakeholders'] | undefined;
    const dod = data.definition_of_done as SeedData['dod'] | undefined;
    const report = discovery?.report ?? null;
    const constraints = clientConstraints(answered);
    const evidence = evaluateAnswers(services.discovery, answered).evidence;

    const common = [
      section('Feature request from the client', clientRequest(run.description)),
      ...(report ? [section('Discovery completeness report', reportForPrompt(report))] : []),
      section('Analyzed requirements', requirementLines(analysis)),
      section('Analysis', analysisSection(analysis)),
    ];
    const needsReading = !!constraints.deadline.text && !constraints.deadline.date;
    const references = facts.backlog.stories
      .filter((s) => s.status === 'done')
      .map((s) => `- ${s.id} (${s.points} points) ${s.summary}: ${s.story}`)
      .join('\n');
    const kpiTable = facts.kpis.metrics
      .map((m) => `- ${m.key}: baseline ${m.baseline}, target ${m.target} (${m.name})`)
      .join('\n');

    const [estimation, risks, value] = await Promise.all([
      services.ask<EstimationResult>(
        ctx,
        'estimator',
        [
          ...common,
          section('Reference stories (done, with Planning Poker points)', references || '(none)'),
          section('Definition of Done', dod?.items.map((i) => `- ${i}`).join('\n') ?? '(not available)'),
          section(
            'Task',
            `Build the story map and size every item. ${
              needsReading
                ? `The client named the deadline "${constraints.deadline.text}" without a date: read it as a date in \`deadline\`, today being ${new Date().toISOString().slice(0, 10)}.`
                : 'Return `deadline: null`.'
            }`,
          ),
        ].join('\n\n'),
      ),
      services.ask<RiskAssessment>(
        ctx,
        'risk-analyst',
        [
          ...common,
          section(
            'Risk Register',
            risksData?.risks
              .map((r) => `- ${r.id} [P${r.probability} I${r.impact}, ${r.strategy}] ${r.title}: ${r.event}`)
              .join('\n') ?? '(not available)',
          ),
          section(
            'Stakeholder Register',
            stakeholders?.stakeholders.map((s) => `- ${s.name}, ${s.role} (${s.organization})`).join('\n') ??
              '(not available)',
          ),
          section(
            'Roadmap',
            facts.roadmap.releases
              .map((r) => `- ${r.id} ${r.name} (${r.window}, ${r.status}): ${r.goals}`)
              .join('\n'),
          ),
          section('Task', 'Identify and rate the risks of this feature.'),
        ].join('\n\n'),
      ),
      services.ask<ValueAssessment>(
        ctx,
        'value-analyst',
        [
          ...common,
          section(
            'KPI baseline and Business Case targets',
            `${kpiTable}\nRevenue split: IAP ${facts.kpis.revenue_split.iap}, ads ${facts.kpis.revenue_split.ads}`,
          ),
          section(
            'Roadmap',
            facts.roadmap.releases
              .map((r) => `- ${r.id} ${r.name} (${r.window}, ${r.status}): ${r.goals}`)
              .join('\n'),
          ),
          section(
            'Task',
            `Set the value scenarios and WSJF inputs. Evidence behind the request: ${evidence}.`,
          ),
        ].join('\n\n'),
      ),
    ]);

    const deadline: Deadline =
      needsReading && estimation.deadline
        ? { ...constraints.deadline, date: estimation.deadline.date, source: 'ai_interpretation' }
        : constraints.deadline;
    const assessment = buildAssessment({
      runId: run.id,
      title: run.title,
      now: new Date(),
      seed: seedFrom(run.id),
      config: services.assessment,
      facts,
      analysis,
      report,
      evidence,
      acceptedOpenIssues: discoveryDecision?.decision === 'proceed',
      deadline,
      budgetLimit: constraints.budget,
      estimation,
      risks,
      value,
    });
    await services.analysis.saveAssessment(assessment);

    const points = highlights(assessment);
    await ctx.emit({
      type: 'assessment_ready',
      decision: assessment.verdict.decision,
      label: assessment.verdict.label,
      highlights: points,
    });
    return {
      next: 'documenting',
      output: {
        decision: assessment.verdict.decision,
        verdict: assessment.verdict.label,
        highlights: points,
      },
    };
  };
}
