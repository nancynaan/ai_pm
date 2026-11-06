import { NOT_SURE, type Question, type RunState } from '@ai-pm/shared';
import { setTimeout as sleep } from 'node:timers/promises';
import type { StageContext, StageHandler, StageHandlers } from '../engine.js';

/**
 * Walking skeleton: every stage exists and moves the run along, but does no real work yet. Phases
 * 3–7 replace these one by one with stages that call agents and Atlassian.
 */

const notSure = { value: NOT_SURE, label: 'Not sure, let the team recommend' };

const PLACEHOLDER_QUESTIONS: Question[] = [
  {
    id: 'goal',
    text: 'What is the main business goal of this feature?',
    kind: 'single',
    options: [
      { value: 'retention', label: 'Keep players coming back (retention)' },
      { value: 'iap', label: 'More in-app purchase revenue' },
      { value: 'ads', label: 'More ad revenue' },
      { value: 'acquisition', label: 'Attract new players' },
      notSure,
    ],
    why: 'The goal decides which KPIs the value estimate uses.',
  },
  {
    id: 'deadline',
    text: 'Is there a deadline?',
    kind: 'single',
    options: [
      { value: 'fixed', label: 'Yes, a fixed date (event or season)' },
      { value: 'next_release', label: 'The next planned release' },
      { value: 'flexible', label: 'Flexible, value first' },
      notSure,
    ],
  },
  {
    id: 'platforms',
    text: 'Which platforms need it?',
    kind: 'multi',
    options: [{ value: 'ios', label: 'iOS' }, { value: 'android', label: 'Android' }, notSure],
  },
];

export interface PlaceholderOptions {
  /** Pause per stage, so progress is visible and a restart can be tested mid-run. */
  delayMs: number;
  autoApprove: boolean;
}

export function placeholderStages({ delayMs, autoApprove }: PlaceholderOptions): StageHandlers {
  const say = (ctx: StageContext, text: string) => ctx.emit({ type: 'message', role: 'ai', text });

  const step =
    (next: RunState, text: string): StageHandler =>
    async (ctx) => {
      await sleep(delayMs);
      await say(ctx, text);
      return { next, output: { placeholder: true } };
    };

  return {
    intake: async (ctx) => {
      await sleep(delayMs);
      await say(
        ctx,
        `Thanks, I've recorded the feature "${ctx.run.title}". Before I assess it, please answer a few quick questions.`,
      );
      const questionnaire = await ctx.repo.saveQuestionnaire(ctx.run.id, 1, PLACEHOLDER_QUESTIONS);
      await ctx.emit({ type: 'questionnaire', questionnaire });
      return { next: 'awaiting_answers', output: { questionnaireId: questionnaire.id } };
    },

    eliciting: async (ctx) => {
      await sleep(delayMs);
      const answered = await ctx.repo.answeredQuestionnaires(ctx.run.id);
      const count = answered.reduce((n, q) => n + Object.keys(q.answers).length, 0);
      await say(ctx, `Got it: ${count} answers recorded. I'll analyze the requirements next.`);
      return { next: 'analyzing', output: { answers: count } };
    },

    analyzing: step(
      'estimating',
      'Analysis (placeholder): from Phase 3, requirements are categorized and checked against the baseline here.',
    ),
    estimating: step(
      'awaiting_documents',
      'Estimation (placeholder): from Phase 4, effort, release forecast, budget, value and risk are computed here.',
    ),

    presenting: async (ctx) => {
      await sleep(delayMs);
      // Until the presentation stage (Phase 6) exists, show the assessment's verdict and figures.
      const assessed = (await ctx.repo.latestStageOutput(ctx.run.id, 'estimating')) as {
        verdict?: string;
        highlights?: string[];
      } | null;
      await ctx.emit({
        type: 'decision_requested',
        verdict: assessed?.verdict ?? 'Go (placeholder)',
        highlights: assessed?.highlights?.length
          ? [
              ...assessed.highlights,
              'Full details are on the Analysis tab; slides with charts arrive in Phase 6',
            ]
          : [
              'Business value and ROI arrive in Phase 4',
              'Release forecast and budget arrive in Phase 4',
              'Slides with charts arrive in Phase 6',
            ],
      });
      if (autoApprove) {
        await say(ctx, 'Auto-approve is on, so I am going straight to the backlog.');
        return { next: 'backlog' };
      }
      await say(ctx, 'Here is the assessment summary. Do you want to go ahead with this feature?');
      return { next: 'awaiting_decision' };
    },

    backlog: step(
      'completed',
      'Backlog (placeholder): from Phase 7, the Epic and user stories are created in Jira here. This run is complete.',
    ),
  };
}
