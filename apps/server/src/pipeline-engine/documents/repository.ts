import type { DocumentStatus, DocumentType } from '@ai-pm/shared';
import { asc, eq, max } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  assumptions,
  constraints,
  decisions,
  documents,
  documentSets,
  featureRequests,
  pipelineRuns,
} from '../../db/schema.js';

export interface StoredDocumentSet {
  faNumber: number;
  inputHash: string | null;
  draft: unknown;
  writeMode: string | null;
  publishedAt: Date | null;
}

export interface DocumentRecord {
  type: DocumentType;
  title: string;
  markdown: string;
  figures: Record<string, string>;
  status: DocumentStatus;
  confluencePageId: string | null;
  confluenceVersion: number | null;
  url: string | null;
  note: string | null;
}

/** Database access for the documents stage and the documents API. */
export function createDocumentRepository(db: Db) {
  return {
    async setOf(runId: string): Promise<StoredDocumentSet | null> {
      const [row] = await db.select().from(documentSets).where(eq(documentSets.runId, runId));
      return row ?? null;
    },

    /** The run's document set; the first call assigns the next FA number. */
    async ensureSet(runId: string): Promise<StoredDocumentSet> {
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await this.setOf(runId);
        if (existing) return existing;
        const [top] = await db.select({ n: max(documentSets.faNumber) }).from(documentSets);
        try {
          const [row] = await db
            .insert(documentSets)
            .values({ runId, faNumber: (top?.n ?? 0) + 1 })
            .onConflictDoNothing({ target: documentSets.runId })
            .returning();
          if (row) return row;
        } catch (err) {
          // Another run took the same FA number at the same moment; try the next one.
          if (!String(err).includes('fa_number')) throw err;
        }
      }
      throw new Error('Could not assign an FA number');
    },

    async saveDraft(runId: string, inputHash: string, draft: unknown) {
      await db
        .update(documentSets)
        .set({ inputHash, draft, updatedAt: new Date() })
        .where(eq(documentSets.runId, runId));
    },

    async saveDocuments(runId: string, rows: DocumentRecord[], mode: 'dry-run' | 'live') {
      const now = new Date();
      await db.transaction(async (tx) => {
        for (const row of rows) {
          await tx
            .insert(documents)
            .values({ runId, ...row })
            .onConflictDoUpdate({
              target: [documents.runId, documents.type],
              set: { ...row, updatedAt: now },
            });
        }
        await tx
          .update(documentSets)
          .set({ writeMode: mode, publishedAt: now, updatedAt: now })
          .where(eq(documentSets.runId, runId));
      });
    },

    async documentsOf(runId: string): Promise<DocumentRecord[]> {
      const rows = await db.select().from(documents).where(eq(documents.runId, runId));
      return rows.map((r) => ({
        type: r.type as DocumentType,
        title: r.title,
        markdown: r.markdown,
        figures: r.figures,
        status: r.status as DocumentStatus,
        confluencePageId: r.confluencePageId,
        confluenceVersion: r.confluenceVersion,
        url: r.url,
        note: r.note,
      }));
    },

    async epicKeyOf(runId: string): Promise<string | null> {
      const [row] = await db
        .select({ epicKey: featureRequests.epicKey })
        .from(pipelineRuns)
        .innerJoin(featureRequests, eq(featureRequests.id, pipelineRuns.featureRequestId))
        .where(eq(pipelineRuns.id, runId));
      return row?.epicKey ?? null;
    },

    async recordsOf(runId: string) {
      const [a, c, d] = await Promise.all([
        db.select().from(assumptions).where(eq(assumptions.runId, runId)),
        db.select().from(constraints).where(eq(constraints.runId, runId)),
        db.select().from(decisions).where(eq(decisions.runId, runId)).orderBy(asc(decisions.decidedAt)),
      ]);
      return {
        assumptions: a.map((x) => ({
          text: x.text,
          kind: x.kind,
          source: x.source,
          owner: x.owner,
          status: x.status,
        })),
        constraints: c.map((x) => ({ type: x.type, text: x.text })),
        decisions: d.map((x) => ({
          gate: x.gate,
          decision: x.decision,
          comment: x.comment,
          decidedAt: x.decidedAt.toISOString(),
        })),
      };
    },
  };
}

export type DocumentRepository = ReturnType<typeof createDocumentRepository>;
