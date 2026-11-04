import type { ElicitationResult } from '../../agents/schemas.js';
import type { StageHandler } from '../orchestrator.js';
import type { StageServices } from '../services.js';
import { clientRequest, section, toQuestions } from './prompts.js';

/**
 * BPMN 01, first half: understand the idea, draft the Epic on the PO's behalf, and send the
 * client a short questionnaire with predefined answers.
 */
export function intakeStage(services: StageServices): StageHandler {
  return async (ctx) => {
    const result = await services.ask<ElicitationResult>(
      ctx,
      'elicitation',
      [
        section('Feature request from the client', clientRequest(ctx.run.description)),
        section(
          'Task',
          'Restate the idea, list candidate requirements and gaps, and choose the questionnaire (at most 8 questions).',
        ),
      ].join('\n\n'),
    );

    const epic = await services.createDraftEpic(ctx.run, result.epicSummary, result.summary);
    const questions = toQuestions(result.questions);
    await ctx.emit({
      type: 'message',
      role: 'ai',
      text: `Thanks! Here is how I understand your idea:\n\n${result.summary}\n\n${epic.note}\n\nBefore I assess it, please answer ${questions.length} quick questions.`,
    });
    const questionnaire = await ctx.repo.saveQuestionnaire(ctx.run.id, 1, questions);
    await ctx.emit({ type: 'questionnaire', questionnaire });
    return { next: 'awaiting_answers', output: { elicitation: result, epic } };
  };
}
