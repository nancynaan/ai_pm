import {
  type AnsweredQuestionnaire,
  type Answers,
  type DiscoveryReport,
  NOT_SURE,
  type Question,
  type Questionnaire,
} from '@ai-pm/shared';
import type { DiscoveryReview } from '../agents/schemas.js';
import type { ConfigQuestion, DiscoveryConfig, DiscoveryRule } from './discovery-config.js';

/**
 * The discovery completeness check (BPMN 01). Rules in code decide what is known, what the client
 * only believes, what is missing and what contradicts; the discovery-review agent adds what rules
 * cannot see (the description, comments, feature questions). The result decides whether the
 * pipeline may go on to the assessment.
 */

export const CLARIFY_PREFIX = 'clarify_';
export const FEATURE_PREFIX = 'feature_';
const NOT_SURE_OPTION = { value: NOT_SURE, label: 'Not sure' };

/** Details are keyed by question and option: "constraints:fixed_deadline". */
export const detailKey = (questionId: string, value: string) => `${questionId}:${value}`;

export class InvalidSubmission extends Error {
  override name = 'InvalidSubmission';
}

/** Checks the client's answers against the questionnaire; returns what to store and lines for the chat. */
export function validateSubmission(questionnaire: Questionnaire, submission: Answers) {
  const answers: Record<string, string[]> = {};
  const details: Record<string, string> = {};
  const lines: string[] = [];
  for (const question of questionnaire.questions) {
    const values = [...new Set(submission.answers[question.id] ?? [])];
    if (!values.length) throw new InvalidSubmission(`Please answer: ${question.text}`);
    if (question.kind === 'single' && values.length !== 1) {
      throw new InvalidSubmission(`Choose one answer for: ${question.text}`);
    }
    if (question.maxSelections && values.length > question.maxSelections) {
      throw new InvalidSubmission(`Choose at most ${question.maxSelections} answers for: ${question.text}`);
    }
    const options = values.map((value) => {
      const option = question.options.find((o) => o.value === value);
      if (!option) throw new InvalidSubmission(`Unknown answer "${value}" for: ${question.text}`);
      return option;
    });
    if (options.length > 1) {
      const exclusive = options.find((o) => o.exclusive || o.value === NOT_SURE);
      if (exclusive) {
        throw new InvalidSubmission(
          `"${exclusive.label}" cannot be combined with other answers: ${question.text}`,
        );
      }
      for (const option of options) {
        const clash = options.find((o) => option.excludes?.includes(o.value));
        if (clash)
          throw new InvalidSubmission(`"${option.label}" and "${clash.label}" cannot both be chosen`);
      }
    }
    const labels = options.map((option) => {
      const key = detailKey(question.id, option.value);
      const detail = option.detail ? submission.details?.[key]?.trim() : undefined;
      if (detail) details[key] = detail;
      return detail ? `${option.label} (${detail})` : option.label;
    });
    answers[question.id] = values;
    lines.push(`- ${question.text} **${labels.join('; ')}**`);
  }
  return { answers, details, lines };
}

// ---- evaluation ----------------------------------------------------------------------------

type Status = 'known' | 'partial' | 'unknown';
type Finding = DiscoveryReport['findings'][number];
type Gap = DiscoveryReport['gaps'][number];
type Contradiction = DiscoveryReport['contradictions'][number];
export type AssumptionKind = 'client_hypothesis' | 'ai_hypothesis' | 'default' | 'open_issue';
export interface DiscoveryAssumption {
  text: string;
  reason: string;
  kind: AssumptionKind;
}
export type Evidence = 'strong' | 'weak' | 'none' | 'unknown';

interface CoreAnswer {
  question: ConfigQuestion;
  values: string[];
  details: Record<string, string>;
}

export interface Evaluation {
  coverage: DiscoveryReport['coverage'];
  findings: Finding[];
  gaps: Gap[];
  contradictions: Contradiction[];
  /** Clarification questions for blocking rule contradictions not asked yet. */
  clarifications: Question[];
  assumptions: DiscoveryAssumption[];
  evidence: Evidence;
  readiness: DiscoveryReport['readiness'];
  notSure: number;
}

function collect(config: DiscoveryConfig, answered: AnsweredQuestionnaire[]) {
  const byId = new Map(config.questions.map((q) => [q.id, q]));
  const core = new Map<string, CoreAnswer>();
  const clarify = new Map<string, { values: string[]; details: Record<string, string> }>();
  let notSure = 0;
  for (const questionnaire of answered) {
    for (const question of questionnaire.questions) {
      const values = questionnaire.answers[question.id] ?? [];
      if (values.includes(NOT_SURE)) notSure++;
      const prefix = `${question.id}:`;
      const details = Object.fromEntries(
        Object.entries(questionnaire.details ?? {})
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, text]) => [key.slice(prefix.length), text]),
      );
      const configQuestion = byId.get(question.id);
      if (configQuestion) core.set(question.id, { question: configQuestion, values, details });
      else if (question.id.startsWith(CLARIFY_PREFIX)) clarify.set(question.id, { values, details });
    }
  }
  // A clarification detail can answer a core detail: "There is a firm date (1 July)" → the critical date.
  for (const rule of config.rules) {
    const answer = clarify.get(`${CLARIFY_PREFIX}${rule.id}`);
    for (const option of rule.clarify?.options ?? []) {
      const detail = answer?.values.includes(option.value) ? answer.details[option.value] : undefined;
      if (!detail || !option.fillsDetail) continue;
      const [questionId, value] = option.fillsDetail.split(':') as [string, string];
      const target = core.get(questionId);
      if (target?.values.includes(value) && !target.details[value]) target.details[value] = detail;
    }
  }
  return { core, clarify, notSure };
}

const optionsOf = (a: CoreAnswer) =>
  a.values.flatMap((v) => a.question.options.find((o) => o.value === v) ?? []);

function statusOf(a: CoreAnswer | undefined): { status: Status; missingDetails: string[] } {
  if (!a || !a.values.length) return { status: 'unknown', missingDetails: [] };
  const options = optionsOf(a);
  const missingDetails = options
    .filter((o) => o.detailRequired && !a.details[o.value])
    .map((o) => `${o.label}: ${o.detail ?? 'details'}`);
  // "Other" without a description says nothing.
  const informative = options.filter((o) => !o.unknown && !(o.value === 'other' && !a.details[o.value]));
  if (!informative.length) {
    return {
      status: options.some((o) => o.unknown && a.details[o.value]) ? 'partial' : 'unknown',
      missingDetails,
    };
  }
  return { status: missingDetails.length ? 'partial' : 'known', missingDetails };
}

const answerText = (a: CoreAnswer) =>
  optionsOf(a)
    .map((o) => (a.details[o.value] ? `${o.label} (${a.details[o.value]})` : o.label))
    .join('; ');

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function matches(rule: DiscoveryRule, core: Map<string, CoreAnswer>) {
  return rule.when.every((c) => {
    const values = core.get(c.question)?.values;
    if (!values?.length) return false;
    return (
      (!c.anyOf || c.anyOf.some((v) => values.includes(v))) &&
      (!c.noneOf || !c.noneOf.some((v) => values.includes(v)))
    );
  });
}

/** The clarification question of a blocking rule, as the client sees it. */
export function clarificationQuestion(rule: DiscoveryRule): Question {
  return {
    id: `${CLARIFY_PREFIX}${rule.id}`,
    text: rule.clarify!.text,
    kind: 'single',
    section: 'clarification',
    why: rule.message,
    options: [
      ...rule.clarify!.options.map(({ value, label, detail }) => ({
        value,
        label,
        ...(detail ? { detail } : {}),
      })),
      NOT_SURE_OPTION,
    ],
  };
}

const READINESS_NOTE: Record<string, string> = {
  full: 'The client can approve the scope, budget and timeline.',
  scope_only:
    'The client can approve the scope; budget and timeline need another approver before the decision.',
  requirements_only: 'Another stakeholder makes the final decision; they must take part in the decision.',
  initial_idea:
    'The feature is an initial idea without formal approval; the assessment supports a go/no-go decision.',
  exploring:
    'The client wants a feasibility assessment before deciding; the result is input for that decision.',
};

/** Applies the questionnaire rules to every answered round. */
export function evaluateAnswers(config: DiscoveryConfig, answered: AnsweredQuestionnaire[]): Evaluation {
  const { core, clarify, notSure } = collect(config, answered);
  const findings: Finding[] = [];
  const gaps: Gap[] = [];
  const assumptions: DiscoveryAssumption[] = [];

  // Evidence behind the request: strong data, weak belief, or nothing.
  const evidenceAnswer = core.get('evidence');
  const levels = evidenceAnswer ? optionsOf(evidenceAnswer).map((o) => o.evidence) : [];
  const evidence: Evidence = levels.includes('strong')
    ? 'strong'
    : levels.includes('weak')
      ? 'weak'
      : levels.includes('none')
        ? 'none'
        : 'unknown';
  const evidenceLabels = evidenceAnswer ? answerText(evidenceAnswer) : 'nothing';

  const statuses = new Map<string, Status>();
  for (const question of config.questions) {
    const answer = core.get(question.id);
    const { status, missingDetails } = statusOf(answer);
    statuses.set(question.id, status);
    if (status === 'unknown') {
      const gapText = question.whenUnknown?.gap ?? `${question.label} is not answered.`;
      findings.push({ kind: 'missing', area: question.section, text: gapText, source: question.id });
      gaps.push({ area: question.section, text: gapText, critical: false });
      if (question.whenUnknown) {
        assumptions.push({
          text: question.whenUnknown.assumption,
          reason: `The client answered "${answer ? answerText(answer) : 'nothing'}" to: ${question.text}`,
          kind: 'default',
        });
      }
      continue;
    }
    const text = `${question.label}: ${answerText(answer!)}`;
    if (question.infoKind === 'client_assumption') {
      const qualifier =
        evidence === 'strong'
          ? `client expectation, backed by: ${evidenceLabels}`
          : evidence === 'weak'
            ? `client hypothesis, backed only by: ${evidenceLabels}`
            : 'unvalidated client hypothesis: no supporting evidence';
      findings.push({
        kind: 'client_assumption',
        area: question.section,
        text: `${text} (${qualifier})`,
        source: question.id,
      });
      if (evidence === 'weak' || evidence === 'none') {
        assumptions.push({
          text: `Unvalidated business hypothesis: ${lower(question.label)} is "${answerText(answer!)}".`,
          reason:
            evidence === 'none'
              ? 'The client has no supporting evidence yet; validate it (analytics, a soft-launch or an A/B test) before relying on it.'
              : `It rests only on ${lower(evidenceLabels)}; validate it before relying on it.`,
          kind: 'client_hypothesis',
        });
      }
    } else {
      findings.push({ kind: 'confirmed', area: question.section, text, source: question.id });
    }
    for (const missing of missingDetails) {
      gaps.push({
        area: question.section,
        text: `${question.label}: "${missing}" is not answered.`,
        critical: false,
      });
    }
  }

  // Coverage per area; an area marked criticalWhenMissing with nothing known is a critical gap.
  const coverage = config.sections.map((section) => {
    const questions = config.questions.filter((q) => q.section === section.id);
    const canBeUnknown = questions.filter((q) => q.options.some((o) => o.unknown) || !core.has(q.id));
    const open = questions.filter((q) => statuses.get(q.id) !== 'known');
    const status: 'covered' | 'partial' | 'missing' =
      canBeUnknown.length > 0 && canBeUnknown.every((q) => statuses.get(q.id) === 'unknown')
        ? 'missing'
        : open.length
          ? 'partial'
          : 'covered';
    if (status === 'missing' && section.criticalWhenMissing) {
      for (const gap of gaps) if (gap.area === section.id) gap.critical = true;
    }
    const note =
      status === 'covered'
        ? 'Answered.'
        : `${status === 'missing' ? 'Not answered' : 'Open'}: ${open.map((q) => q.label).join(', ')}.`;
    return { area: section.id, status, note };
  });

  // Contradictions from the rules; a blocking one is resolved by a definite clarification answer.
  const contradictions: Contradiction[] = [];
  const clarifications: Question[] = [];
  for (const rule of config.rules.filter((r) => matches(r, core))) {
    const id = `${CLARIFY_PREFIX}${rule.id}`;
    const answer = clarify.get(id);
    const resolved =
      rule.severity === 'blocking' && !!answer?.values.length && !answer.values.includes(NOT_SURE);
    contradictions.push({ id: rule.id, text: rule.message, severity: rule.severity, resolved });
    if (rule.severity === 'blocking' && !answer) clarifications.push(clarificationQuestion(rule));
    if (resolved) {
      const question = clarificationQuestion(rule);
      const labels = answer.values.map((v) => {
        const label = question.options.find((o) => o.value === v)?.label ?? v;
        const detail = answer.details[v];
        return detail ? `${label} (${detail})` : label;
      });
      findings.push({
        kind: 'confirmed',
        area: 'feasibility',
        text: `Clarified: ${question.text} ${labels.join('; ')}`,
        source: id,
      });
    }
  }

  const approval = core.get('approval');
  const approvalOption = approval ? optionsOf(approval)[0] : undefined;
  const decider = approval?.details[approvalOption?.value ?? ''];
  const readiness: DiscoveryReport['readiness'] = {
    canApprove: approvalOption?.approval ?? 'none',
    note: approvalOption
      ? `${READINESS_NOTE[approvalOption.value] ?? approvalOption.label}${decider ? ` Final decision: ${decider}.` : ''}`
      : 'Approval status is unknown.',
  };

  return {
    coverage,
    findings,
    gaps,
    contradictions,
    clarifications,
    assumptions,
    evidence,
    readiness,
    notSure,
  };
}

// ---- report ----------------------------------------------------------------------------------

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Agent questions → clarification questions with stable ids and a "not sure" option. */
function agentClarifications(review: DiscoveryReview, round: number): Question[] {
  return review.clarificationQuestions.map((q, i) => ({
    id: `${CLARIFY_PREFIX}ai_${round}_${i + 1}`,
    text: q.text,
    kind: q.kind,
    section: 'clarification',
    why: q.why,
    options: [...q.options.filter((o) => o.value !== NOT_SURE), NOT_SURE_OPTION],
  }));
}

/**
 * Merges the rule evaluation with the agent's review and decides the result. Blocking
 * contradictions and critical gaps never pass: they become clarification questions while rounds
 * are left, and a client decision after the last round.
 */
export function buildReport(input: {
  config: DiscoveryConfig;
  round: number;
  evaluation: Evaluation;
  review: DiscoveryReview;
}): { report: DiscoveryReport; clarifications: Question[]; assumptions: DiscoveryAssumption[] } {
  const { config, round, evaluation, review } = input;
  const gaps = [...evaluation.gaps, ...review.gaps];
  const contradictions: Contradiction[] = [
    ...evaluation.contradictions,
    ...review.contradictions.map((c, i) => ({
      id: `ai_${i + 1}`,
      text: c.text,
      severity: c.severity,
      resolved: false,
    })),
  ];
  const findings = [...evaluation.findings, ...review.findings];
  const coverage = evaluation.coverage.map((c) => {
    const extra = review.gaps.filter((g) => g.area === c.area);
    if (!extra.length) return c;
    return {
      area: c.area,
      status: c.status === 'covered' ? ('partial' as const) : c.status,
      note: `${c.status === 'covered' ? '' : `${c.note} `}${extra.map((g) => g.text).join(' ')}`.trim(),
    };
  });

  const blocking = contradictions.filter((c) => c.severity === 'blocking' && !c.resolved);
  const critical = gaps.filter((g) => g.critical);
  const open = gaps.filter((g) => !g.critical);
  const warnings = contradictions.filter((c) => c.severity === 'warning');
  const clientAssumptions = [...evaluation.assumptions, ...review.assumptions].filter(
    (a) => a.kind === 'client_hypothesis' || a.kind === 'default',
  );
  const canAsk = round < config.maxRounds;
  const clarifications = canAsk
    ? [...evaluation.clarifications, ...agentClarifications(review, round)].slice(0, config.maxClarifications)
    : [];

  const result: DiscoveryReport['result'] =
    blocking.length || critical.length
      ? clarifications.length
        ? 'needs_clarification'
        : 'insufficient'
      : open.length || warnings.length || clientAssumptions.length || evaluation.notSure
        ? 'complete_with_assumptions'
        : 'complete';

  const drivers = [
    ...(blocking.length ? [`${plural(blocking.length, 'unresolved contradiction')}`] : []),
    ...(critical.length ? [`${plural(critical.length, 'critical gap')}`] : []),
    ...(open.length ? [`${plural(open.length, 'open point')}`] : []),
    ...(warnings.length ? [`${plural(warnings.length, 'warning')}`] : []),
    ...(evaluation.evidence === 'none'
      ? ['no supporting evidence for the expected outcome']
      : evaluation.evidence === 'weak'
        ? ['the expected outcome rests on intuition or strategy, not data']
        : []),
    ...(evaluation.notSure ? [`${plural(evaluation.notSure, '"not sure" answer')}`] : []),
  ];
  const justification = coverage.find((c) => c.area === 'business_justification')?.status;
  const confidence: DiscoveryReport['confidence'] =
    blocking.length ||
    critical.length ||
    gaps.length >= 4 ||
    (evaluation.evidence === 'none' && justification !== 'covered')
      ? 'low'
      : drivers.length
        ? 'medium'
        : 'high';

  const readinessNote = evaluation.readiness.canApprove === 'full' ? '' : ` ${evaluation.readiness.note}`;
  const nextAction: DiscoveryReport['nextAction'] =
    result === 'complete'
      ? {
          action: 'proceed',
          text: `Proceed to the assessment: business value, requirements, risks and estimates.${readinessNote}`,
        }
      : result === 'complete_with_assumptions'
        ? {
            action: 'proceed_with_assumptions',
            text: `Proceed to the assessment. ${plural(open.length + clientAssumptions.length, 'open point')} are recorded as assumptions, and results that depend on them are marked preliminary.${readinessNote}`,
          }
        : result === 'needs_clarification'
          ? {
              action: 'clarify',
              text: `Answer ${plural(clarifications.length, 'clarification question')}. The assessment waits until the blocking issues are resolved.`,
            }
          : {
              action: 'client_decision',
              text: 'Blocking issues remain after the clarification round. Decide whether to continue with a preliminary assessment based on the documented assumptions, or to stop and come back with more information.',
            };

  const assumptions: DiscoveryAssumption[] = [
    ...evaluation.assumptions,
    ...review.assumptions,
    ...(result === 'insufficient'
      ? [
          ...blocking.map((c) => ({
            text: c.text,
            reason: 'Unresolved contradiction accepted for a preliminary assessment',
            kind: 'open_issue' as const,
          })),
          ...critical.map((g) => ({
            text: g.text,
            reason: 'Critical gap accepted for a preliminary assessment',
            kind: 'open_issue' as const,
          })),
        ]
      : []),
  ];

  return {
    report: {
      round,
      result,
      confidence,
      confidenceReason: drivers.length
        ? `${drivers.join('; ')}.`.replace(/^./, (c) => c.toUpperCase())
        : 'All discovery areas are answered, consistent and backed by evidence.',
      summary: review.summary,
      coverage,
      findings,
      gaps,
      contradictions,
      readiness: evaluation.readiness,
      nextAction,
    },
    clarifications,
    assumptions,
  };
}

/** What the rules found, for the discovery-review agent: it adds to this and must not repeat it. */
export function evaluationForPrompt(evaluation: Evaluation): string {
  const lines = (items: string[]) => (items.length ? items.map((t) => `- ${t}`).join('\n') : '- (none)');
  return [
    `## Classified answers\n${lines(evaluation.findings.map((f) => `[${f.kind}] ${f.text}`))}`,
    `## Gaps\n${lines(evaluation.gaps.map((g) => `${g.critical ? '[critical] ' : ''}${g.text}`))}`,
    `## Contradictions\n${lines(evaluation.contradictions.map((c) => `[${c.severity}${c.resolved ? ', resolved' : ''}] ${c.text}`))}`,
    `## Evidence behind the request\n- ${evaluation.evidence}`,
    `## Decision readiness\n- ${evaluation.readiness.note}`,
  ].join('\n\n');
}

/** The report as plain text for the analysts' prompts. */
export function reportForPrompt(report: DiscoveryReport): string {
  const list = (kind: Finding['kind']) =>
    report.findings
      .filter((f) => f.kind === kind)
      .map((f) => `- ${f.text}`)
      .join('\n') || '- (none)';
  const contradictions = report.contradictions
    .map((c) => `- [${c.severity}${c.resolved ? ', resolved' : ''}] ${c.text}`)
    .join('\n');
  return [
    `Result: ${report.result}; confidence ${report.confidence} (${report.confidenceReason})`,
    `## Confirmed by the client\n${list('confirmed')}`,
    `## Client assumptions (expectations, not facts)\n${list('client_assumption')}`,
    `## AI hypotheses (to be validated)\n${list('ai_hypothesis')}`,
    `## Missing information\n${list('missing')}`,
    ...(contradictions ? [`## Contradictions\n${contradictions}`] : []),
    `## Decision readiness\n${report.readiness.note}`,
  ].join('\n\n');
}
