import type { RunState } from '@ai-pm/shared';

export const STATE_LABEL: Record<RunState, string> = {
  intake: 'Intake',
  awaiting_answers: 'Waiting for answers',
  eliciting: 'Reviewing answers',
  analyzing: 'Analyzing',
  estimating: 'Estimating',
  documenting: 'Writing documents',
  presenting: 'Preparing presentation',
  awaiting_decision: 'Waiting for decision',
  backlog: 'Creating backlog',
  completed: 'Completed',
  declined: 'Declined',
  failed: 'Failed',
};
