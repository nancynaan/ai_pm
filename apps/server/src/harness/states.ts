import type { Decision, RunState } from '@ai-pm/shared';

/** States with a stage to execute; the job worker picks these up. */
export const ACTIVE_STATES: readonly RunState[] = [
  'intake',
  'eliciting',
  'analyzing',
  'estimating',
  'documenting',
  'presenting',
  'backlog',
];

export const isActive = (state: RunState) => ACTIVE_STATES.includes(state);
export const isFinal = (state: RunState) => state === 'completed' || state === 'declined';

/** Allowed moves, mirroring the BPMN models. Any non-final state may also move to `failed`. */
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  intake: ['awaiting_answers'],
  awaiting_answers: ['eliciting'],
  eliciting: ['awaiting_answers', 'analyzing'],
  analyzing: ['estimating'],
  estimating: ['documenting'],
  documenting: ['presenting'],
  presenting: ['awaiting_decision', 'backlog'],
  awaiting_decision: ['backlog', 'analyzing', 'declined'],
  backlog: ['completed'],
  completed: [],
  declined: [],
  // A retry resumes the stage that failed.
  failed: ACTIVE_STATES,
};

export function canTransition(from: RunState, to: RunState): boolean {
  if (to === 'failed') return !isFinal(from) && from !== 'failed';
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransition extends Error {
  override name = 'InvalidTransition';
  constructor(from: RunState, to: RunState) {
    super(`A run cannot move from ${from} to ${to}`);
  }
}

export function assertTransition(from: RunState, to: RunState) {
  if (!canTransition(from, to)) throw new InvalidTransition(from, to);
}

export const stateAfterDecision = (decision: Decision['decision']): RunState =>
  decision === 'approve' ? 'backlog' : decision === 'changes' ? 'analyzing' : 'declined';
