import type { ElicitationReview, ImpactAnalysis, RequirementsAnalysis } from '../../agents/schemas.js';
import { classifyChange, MAGNITUDE_LABEL } from '../magnitude.js';
import type { StageHandler } from '../orchestrator.js';
import type { StageServices } from '../services.js';
import { clientRequest, section, transcript } from './prompts.js';

const BASELINE_FOR_REQUIREMENTS = ['game_design_document', 'definition_of_done', 'product_roadmap'];
const BASELINE_FOR_IMPACT = ['architecture_overview', 'game_design_document'];

/**
 * BPMN 02: requirements analysis and impact analysis run in parallel; the harness then applies
 * the change-magnitude rule and stores everything with stable requirement codes.
 */
export function analyzingStage(services: StageServices): StageHandler {
  return async (ctx) => {
    const { run } = ctx;
    const [review, answered, decision, backlog, components, texts] = await Promise.all([
      ctx.repo.latestStageOutput(run.id, 'eliciting') as Promise<ElicitationReview | null>,
      ctx.repo.answeredQuestionnaires(run.id),
      ctx.repo.latestDecision(run.id),
      services.context.backlog(),
      services.context.components(run.projectId),
      services.context.baselineTexts(run.projectId, [
        ...new Set([...BASELINE_FOR_REQUIREMENTS, ...BASELINE_FOR_IMPACT]),
      ]),
    ]);
    const assumptions = await services.analysis.elicitationAssumptions(run.id);

    const common = [
      section('Feature request from the client', clientRequest(run.description)),
      section('Questionnaire answers', transcript(answered) || '(none)'),
      section(
        'Elicited requirements',
        review?.requirements.map((r) => `- [${r.type}, ${r.source}] ${r.text}`).join('\n') ?? '(none)',
      ),
      section('Assumptions so far', assumptions.map((a) => `- ${a}`).join('\n') || '(none)'),
      ...(decision?.decision === 'changes'
        ? [
            section(
              'Changes the client asked for after the last assessment',
              decision.comment ?? '(no comment)',
            ),
          ]
        : []),
      section('Current Jira backlog', backlog),
    ];
    const baseline = (types: string[]) =>
      types
        .map((t) => texts[t])
        .filter(Boolean)
        .join('\n\n') || '(not available)';

    const [analysis, impact] = await Promise.all([
      services.ask<RequirementsAnalysis>(
        ctx,
        'requirements-analyst',
        [...common, section('Baseline extracts', baseline(BASELINE_FOR_REQUIREMENTS))].join('\n\n'),
      ),
      services.ask<ImpactAnalysis>(
        ctx,
        'impact-analyst',
        [...common, section('Baseline extracts', baseline(BASELINE_FOR_IMPACT))].join('\n\n'),
      ),
    ]);

    // Keep only components the architecture knows, with their canonical names.
    const known = new Map(components.map((c) => [c.name.toLowerCase(), c.name]));
    const componentImpacts = components.length
      ? impact.componentImpacts.flatMap((i) => {
          const name = known.get(i.component.trim().toLowerCase());
          return name ? [{ ...i, component: name }] : [];
        })
      : impact.componentImpacts;
    const { magnitude, reason } = classifyChange(componentImpacts, components);
    await services.analysis.saveAnalysis(run.id, {
      analysis,
      impact: { ...impact, componentImpacts },
      magnitude,
      magnitudeReason: reason,
    });

    const reqs = analysis.requirements;
    const fr = reqs.filter((r) => r.type === 'functional').length;
    const affected = componentImpacts
      .filter((i) => i.level === 'high' || i.level === 'medium')
      .map((i) => `${i.component} (${i.level})`);
    const blockingConflicts = analysis.conflicts.filter((c) => c.blocking);
    const lines = [
      `**${reqs.length} requirements**: ${fr} functional, ${reqs.length - fr} non-functional; ${reqs.filter((r) => r.inMvp).length} in the MVP.`,
      `**${MAGNITUDE_LABEL[magnitude]}.** ${reason}`,
      ...(affected.length ? [`Most affected: ${affected.join(', ')}.`] : []),
      `Dependencies: ${impact.dependencies.length} (${impact.dependencies.filter((d) => d.blocking).length} blocking).`,
      `Conflicts and duplicates: ${analysis.conflicts.length}${blockingConflicts.length ? ` (${blockingConflicts.length} blocking: ${blockingConflicts[0]!.description})` : ''}.`,
      ...(impact.spike.needed && impact.spike.question
        ? [
            `Technical spike proposed: ${impact.spike.question}${impact.spike.timeboxDays ? ` (${impact.spike.timeboxDays} days)` : ''}.`,
          ]
        : []),
    ];
    await ctx.emit({
      type: 'message',
      role: 'ai',
      text: `Analysis done.\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\nMVP: ${analysis.mvpSummary}`,
    });

    return {
      next: 'estimating',
      output: { requirements: reqs.length, magnitude, reason, conflicts: analysis.conflicts.length },
    };
  };
}
