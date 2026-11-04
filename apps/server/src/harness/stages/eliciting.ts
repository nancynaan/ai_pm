import type { DiscoveryReport } from '@ai-pm/shared';
import type { DiscoveryReview, ElicitationResult } from '../../agents/schemas.js';
import { buildReport, evaluateAnswers, evaluationForPrompt } from '../discovery.js';
import type { StageHandler } from '../orchestrator.js';
import type { StageServices } from '../services.js';
import { clientRequest, section, transcript } from './prompts.js';

export interface DiscoveryOutput {
  review: DiscoveryReview;
  report: DiscoveryReport;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * BPMN 01, second half: the discovery completeness check. The rules classify the answers and find
 * contradictions and gaps; the discovery-review agent adds what rules cannot see. Blocking issues
 * lead to a clarification round, and after the last round to a client decision. Only a verified
 * discovery (or the client's explicit go-ahead) reaches the assessment.
 */
export function elicitingStage(services: StageServices): StageHandler {
  return async (ctx) => {
    const config = services.discovery;
    const answered = await ctx.repo.answeredQuestionnaires(ctx.run.id);
    const round = answered.length;
    const canAsk = round < config.maxRounds;
    const intake = (await ctx.repo.latestStageOutput(ctx.run.id, 'intake')) as {
      elicitation?: ElicitationResult;
    } | null;
    const elicitation = intake?.elicitation;
    const evaluation = evaluateAnswers(config, answered);

    const review = await services.ask<DiscoveryReview>(
      ctx,
      'discovery-review',
      [
        section('Feature request from the client', clientRequest(ctx.run.description)),
        section('Your restatement at intake', elicitation?.summary ?? '(none)'),
        section(
          'Candidate requirements from intake',
          elicitation?.candidateRequirements.map((r) => `- [${r.type}, ${r.source}] ${r.text}`).join('\n') ||
            '(none)',
        ),
        section('Questionnaire answers', transcript(answered)),
        section('What the completeness rules already found', evaluationForPrompt(evaluation)),
        section(
          'Task',
          canAsk
            ? 'Review the discovery for completeness and consistency. Add only what the rules did not find. Ask clarification questions only for your own blocking contradictions or critical gaps.'
            : 'Review the discovery for completeness and consistency. Add only what the rules did not find. This was the last round: return no clarification questions.',
        ),
      ].join('\n\n'),
    );

    const { report, clarifications, assumptions } = buildReport({
      config,
      round,
      evaluation,
      review: canAsk ? review : { ...review, clarificationQuestions: [] },
    });
    await services.analysis.replaceElicitationAssumptions(ctx.run.id, assumptions);
    await ctx.emit({ type: 'discovery_report', report });
    const output: DiscoveryOutput = { review, report };

    if (report.result === 'needs_clarification') {
      const blocking = [
        ...report.contradictions.filter((c) => c.severity === 'blocking' && !c.resolved).map((c) => c.text),
        ...report.gaps.filter((g) => g.critical).map((g) => g.text),
      ];
      await ctx.emit({
        type: 'message',
        role: 'ai',
        text: `Thanks! Before I assess the feature, I need you to clarify ${plural(blocking.length, 'point')}:\n${blocking.map((t) => `- ${t}`).join('\n')}\n\nI won't estimate anything until these are settled.`,
      });
      const questionnaire = await ctx.repo.saveQuestionnaire(ctx.run.id, round + 1, clarifications, {
        sections: [{ id: 'clarification', title: 'Clarification' }],
        allowComment: true,
      });
      await ctx.emit({ type: 'questionnaire', questionnaire });
      return { next: 'awaiting_answers', output };
    }

    if (report.result === 'insufficient') {
      await ctx.emit({
        type: 'message',
        role: 'ai',
        text: `Some blocking points are still open, so a reliable assessment isn't possible yet. You can continue with a **preliminary** assessment: the open points will be recorded as assumptions and every figure that depends on them will be marked preliminary. Or you can stop here and come back with more information.`,
      });
      return { next: 'awaiting_confirmation', output };
    }

    await ctx.emit({
      type: 'message',
      role: 'ai',
      text:
        report.result === 'complete'
          ? `Discovery is complete and consistent. I'll now assess business value, requirements, risks and effort.`
          : `Discovery is complete enough to assess the feature. ${plural(
              assumptions.filter((a) => a.kind === 'client_hypothesis' || a.kind === 'default').length,
              'open point',
            )} are recorded as assumptions; anything that depends on them will be marked preliminary. Next: business value, requirements, risks and effort.`,
    });
    return { next: 'analyzing', output };
  };
}
