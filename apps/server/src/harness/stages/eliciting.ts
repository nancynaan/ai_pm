import type { ElicitationResult, ElicitationReview } from '../../agents/schemas.js';
import type { StageHandler } from '../orchestrator.js';
import type { StageServices } from '../services.js';
import { clientRequest, section, toQuestions, transcript } from './prompts.js';

/** Questionnaire rounds per run, including the first. */
export const MAX_ROUNDS = 2;

/**
 * BPMN 01, second half: merge the answers, turn "not sure" into assumptions, and ask one short
 * follow-up round only if a critical gap remains.
 */
export function elicitingStage(services: StageServices): StageHandler {
  return async (ctx) => {
    const answered = await ctx.repo.answeredQuestionnaires(ctx.run.id);
    const intake = (await ctx.repo.latestStageOutput(ctx.run.id, 'intake')) as {
      elicitation?: ElicitationResult;
    } | null;
    const candidates = intake?.elicitation?.candidateRequirements ?? [];

    const review = await services.ask<ElicitationReview>(
      ctx,
      'elicitation-review',
      [
        section('Feature request from the client', clientRequest(ctx.run.description)),
        section(
          'Candidate requirements from intake',
          candidates.map((r) => `- [${r.type}, ${r.source}] ${r.text}`).join('\n') || '(none)',
        ),
        section('Questionnaire answers', transcript(answered)),
        section(
          'Task',
          answered.length >= MAX_ROUNDS
            ? 'Update the requirements, assumptions and gaps. This was the last round: return no follow-up questions.'
            : 'Update the requirements, assumptions and gaps. Ask follow-up questions only for critical gaps.',
        ),
      ].join('\n\n'),
    );

    await services.analysis.replaceElicitationAssumptions(ctx.run.id, review.assumptions);
    const critical = review.remainingGaps.filter((g) => g.critical);
    const followUps = toQuestions(review.followUpQuestions);

    if (answered.length < MAX_ROUNDS && critical.length > 0 && followUps.length > 0) {
      await ctx.emit({
        type: 'message',
        role: 'ai',
        text: `Thanks! One more short round, because I still need this to assess the feature:\n${critical.map((g) => `- ${g.description}`).join('\n')}`,
      });
      const questionnaire = await ctx.repo.saveQuestionnaire(ctx.run.id, answered.length + 1, followUps);
      await ctx.emit({ type: 'questionnaire', questionnaire });
      return { next: 'awaiting_answers', output: review };
    }

    const assumed = review.assumptions.length
      ? `\n\nWhere you weren't sure, I'll work with these assumptions:\n${review.assumptions.map((a) => `- ${a.text}`).join('\n')}`
      : '';
    await ctx.emit({
      type: 'message',
      role: 'ai',
      text: `Thanks, that's enough to work with. I now have ${review.requirements.length} requirements and will analyze them against the project baseline.${assumed}`,
    });
    return { next: 'analyzing', output: review };
  };
}
