import type { Questionnaire } from '@ai-pm/shared';
import type { ElicitationResult } from '../../agents/schemas.js';
import { toUiQuestion } from '../discovery-config.js';
import { FEATURE_PREFIX } from '../discovery.js';
import type { StageHandler } from '../engine.js';
import type { StageServices } from '../services.js';
import { clientRequest, section, toQuestions } from './prompts.js';

/**
 * BPMN 01, first half: understand the idea, draft the Epic on the PO's behalf, and send the
 * discovery questionnaire: the fixed core questions plus up to two feature-specific ones.
 */
export function intakeStage(services: StageServices): StageHandler {
  return async (ctx) => {
    const config = services.discovery;
    const result = await services.ask<ElicitationResult>(
      ctx,
      'elicitation',
      [
        section('Feature request from the client', clientRequest(ctx.run.description)),
        section(
          'Discovery questionnaire the client will answer anyway',
          config.questions.map((q) => `- ${q.text}`).join('\n'),
        ),
        section(
          'Task',
          `Restate the idea, list candidate requirements and feature-specific gaps, and add at most ${config.maxFeatureQuestions} feature-specific questions that the questionnaire above does not cover (none if it covers everything).`,
        ),
      ].join('\n\n'),
    );

    const epic = await services.createDraftEpic(ctx.run, result.epicSummary, result.summary);
    const featureQuestions = toQuestions(result.featureQuestions.slice(0, config.maxFeatureQuestions), {
      prefix: FEATURE_PREFIX,
      section: 'feature',
    });
    // Feature questions sit after the scope section.
    const sections: NonNullable<Questionnaire['sections']> = config.sections.flatMap((s) => [
      { id: s.id, title: s.title, ...(s.description ? { description: s.description } : {}) },
      ...(s.id === 'scope' && featureQuestions.length
        ? [{ id: 'feature', title: 'About this feature', description: 'Questions specific to your idea.' }]
        : []),
    ]);
    const order = sections.map((s) => s.id);
    const questions = [...config.questions.map(toUiQuestion), ...featureQuestions].sort(
      (a, b) => order.indexOf(a.section ?? '') - order.indexOf(b.section ?? ''),
    );

    await ctx.emit({
      type: 'message',
      role: 'ai',
      text: [
        `Thanks! Here is how I understand your idea:\n\n${result.summary}`,
        epic.note,
        `Before I assess it, please fill in a short discovery questionnaire (${questions.length} questions, about three minutes). It covers why the feature matters, who it is for, what you expect in the first release, constraints, and who decides.`,
        `Where you don't know something yet, pick **Not yet determined**: I'll record it as open rather than guess.`,
      ].join('\n\n'),
    });
    const questionnaire = await ctx.repo.saveQuestionnaire(ctx.run.id, 1, questions, {
      sections,
      allowComment: true,
    });
    await ctx.emit({ type: 'questionnaire', questionnaire });
    return { next: 'awaiting_answers', output: { elicitation: result, epic } };
  };
}
