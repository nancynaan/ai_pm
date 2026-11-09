import type { RunState } from '@ai-pm/shared';

/** A "please wait" line with a quiet animated indicator; announced to screen readers. */
export function Waiting({ text }: { text: string }) {
  return (
    <p className="waiting" role="status">
      <span className="dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {text}
    </p>
  );
}

/**
 * The placeholder card the chat shows while a step works, so the conversation never looks
 * stalled: it stands where the step's result will appear and gives way to it. The documents
 * step shows its wait on the Documents card itself.
 */
const STEP_WAIT: Partial<Record<RunState, { title: string; text: string }>> = {
  intake: {
    title: 'Reading your request',
    text: 'Please wait, I am reading your request and preparing the questionnaire.',
  },
  eliciting: {
    title: 'Discovery Completeness Report',
    text: 'Please wait, I am checking your answers for gaps and contradictions.',
  },
  analyzing: {
    title: 'Analysis in progress',
    text: 'Please wait, I am analyzing the gathered requirements and their impact on the game.',
  },
  estimating: {
    title: 'Assessment in progress',
    text: 'Please wait, I am estimating effort, the release forecast, budget, value and risks.',
  },
  presenting: {
    title: 'Proposal',
    text: 'Please wait, the presentation is generating.',
  },
  backlog: {
    title: 'Backlog',
    text: 'Please wait, I am writing the Epic and its stories and adding them to Jira.',
  },
};

export function StepWaitingCard({ state, paused }: { state: RunState; paused: string | null }) {
  const wait = STEP_WAIT[state];
  if (!wait) return null;
  return (
    <div className="card pending" aria-busy="true">
      <div className="card-head">
        <h3>{wait.title}</h3>
        <span className="tag neutral">{paused ? 'Paused' : 'In progress'}</span>
      </div>
      <Waiting text={paused ?? wait.text} />
    </div>
  );
}
