import type { RunState } from '@ai-pm/shared';

export const STATE_LABEL: Record<RunState, string> = {
  intake: 'Intake',
  awaiting_answers: 'Waiting for answers',
  eliciting: 'Checking discovery',
  awaiting_confirmation: 'Waiting for your decision',
  analyzing: 'Analyzing',
  estimating: 'Estimating',
  awaiting_documents: 'Waiting to publish documents',
  documenting: 'Writing documents',
  presenting: 'Preparing presentation',
  awaiting_decision: 'Waiting for your decision',
  backlog: 'Creating backlog',
  completed: 'Completed',
  declined: 'Declined',
  failed: 'Failed',
};
