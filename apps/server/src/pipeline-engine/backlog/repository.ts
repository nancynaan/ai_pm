import { type Backlog, type BacklogItem, backlogItemTypeSchema, documentStatusSchema } from '@ai-pm/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { backlogItems, backlogSets } from '../../db/schema.js';

export interface StoredBacklogSet {
  inputHash: string;
  draft: unknown;
  writeMode: string | null;
  confluenceUrl: string | null;
  publishedAt: Date | null;
}

/** Database access for the backlog stage and the backlog API. */
export function createBacklogRepository(db: Db) {
  return {
    async setOf(runId: string): Promise<StoredBacklogSet | null> {
      const [row] = await db.select().from(backlogSets).where(eq(backlogSets.runId, runId));
      return row ?? null;
    },

    async saveDraft(runId: string, inputHash: string, draft: unknown) {
      const now = new Date();
      await db
        .insert(backlogSets)
        .values({ runId, inputHash, draft })
        .onConflictDoUpdate({ target: backlogSets.runId, set: { inputHash, draft, updatedAt: now } });
    },

    /** The Jira keys and statuses of the last write, plus the Initial Product Backlog block. */
    async saveWrite(
      runId: string,
      items: BacklogItem[],
      write: { mode: 'dry-run' | 'live'; confluenceUrl: string | null; confluenceStatus: string },
    ) {
      const now = new Date();
      await db.transaction(async (tx) => {
        for (const item of items) {
          await tx
            .insert(backlogItems)
            .values({ runId, ...item })
            .onConflictDoUpdate({
              target: [backlogItems.runId, backlogItems.localId],
              set: { ...item, updatedAt: now },
            });
        }
        await tx
          .update(backlogSets)
          .set({
            writeMode: write.mode,
            confluenceUrl: write.confluenceUrl,
            confluenceStatus: write.confluenceStatus,
            publishedAt: now,
            updatedAt: now,
          })
          .where(eq(backlogSets.runId, runId));
      });
    },

    async backlogOf(runId: string): Promise<Backlog | null> {
      const set = await this.setOf(runId);
      if (!set?.publishedAt) return null;
      const rows = await db
        .select()
        .from(backlogItems)
        .where(eq(backlogItems.runId, runId))
        .orderBy(asc(backlogItems.createdAt));
      const items: BacklogItem[] = rows.map((r) => ({
        localId: r.localId,
        type: backlogItemTypeSchema.parse(r.type),
        summary: r.summary,
        priority: r.priority,
        aiEstimate: r.aiEstimate,
        requirementCodes: r.requirementCodes,
        blockedBy: r.blockedBy,
        jiraKey: r.jiraKey,
        url: r.url,
        status: documentStatusSchema.parse(r.status),
        note: r.note,
      }));
      // Story-map order (S-1, S-2 … S-10), whatever the insert order was.
      const order = (id: string) => Number(id.replace(/\D/g, '')) || 0;
      return {
        runId,
        mode: set.writeMode === 'live' ? 'live' : 'dry-run',
        epic: items.find((i) => i.type === 'epic') ?? null,
        stories: items.filter((i) => i.type !== 'epic').sort((a, b) => order(a.localId) - order(b.localId)),
        confluenceUrl: set.confluenceUrl,
        publishedAt: set.publishedAt.toISOString(),
      };
    },
  };
}

export type BacklogRepository = ReturnType<typeof createBacklogRepository>;
