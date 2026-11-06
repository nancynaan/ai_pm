import { type Deck, deckSchema } from '@ai-pm/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { presentations } from '../../db/schema.js';

export interface StoredPresentation {
  version: string;
  inputHash: string;
  draft: unknown;
  deck: Deck;
  attachmentStatus: string | null;
  attachmentUrl: string | null;
  updatedAt: Date;
}

/** 1.0 → 1.1: a regenerated deck for a changed assessment. */
export const nextVersion = (previous: string | null) => {
  if (!previous) return '1.0';
  const [major = '1', minor = '0'] = previous.split('.');
  return `${major}.${Number(minor) + 1}`;
};

export function createPresentationRepository(db: Db) {
  return {
    async get(runId: string): Promise<StoredPresentation | null> {
      const [row] = await db.select().from(presentations).where(eq(presentations.runId, runId));
      if (!row) return null;
      return { ...row, deck: deckSchema.parse(row.deck) };
    },

    async save(runId: string, p: { version: string; inputHash: string; draft: unknown; deck: Deck }) {
      const now = new Date();
      await db
        .insert(presentations)
        .values({ runId, ...p })
        .onConflictDoUpdate({ target: presentations.runId, set: { ...p, updatedAt: now } });
    },

    async setAttachment(runId: string, status: string, url: string | null) {
      await db
        .update(presentations)
        .set({ attachmentStatus: status, attachmentUrl: url })
        .where(eq(presentations.runId, runId));
    },
  };
}

export type PresentationRepository = ReturnType<typeof createPresentationRepository>;
