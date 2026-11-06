import { EventEmitter } from 'node:events';
import type { RunEvent, StoredRunEvent } from '@ai-pm/shared';
import type { RunRepository } from './repository.js';

/** Stores each run event, then notifies live SSE subscribers in this process. */
export function createEventBus(repo: Pick<RunRepository, 'addEvent'>) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    /** `key`: the step this event belongs to; a second event with the key replaces the first. */
    async publish(runId: string, event: RunEvent, key?: string): Promise<StoredRunEvent> {
      const stored = await repo.addEvent(runId, event, key);
      emitter.emit(runId, stored);
      return stored;
    },
    subscribe(runId: string, listener: (event: StoredRunEvent) => void): () => void {
      emitter.on(runId, listener);
      return () => emitter.off(runId, listener);
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
