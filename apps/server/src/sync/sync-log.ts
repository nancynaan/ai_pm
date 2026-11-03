import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { syncLog } from '../db/schema.js';

export interface SyncEntry {
  idempotencyKey: string;
  system: 'jira' | 'confluence';
  entityType: string;
  externalId?: string | null;
  externalKey?: string | null;
  externalVersion?: number | null;
  payloadHash?: string | null;
  lastAction: string;
}

/** Maps our ids to Jira/Confluence ids. Written only in live mode. */
export interface SyncLogStore {
  get(idempotencyKey: string): Promise<SyncEntry | undefined>;
  save(entry: SyncEntry): Promise<void>;
}

export function drizzleSyncLog(db: Db): SyncLogStore {
  return {
    async get(idempotencyKey) {
      const [row] = await db
        .select()
        .from(syncLog)
        .where(eq(syncLog.idempotencyKey, idempotencyKey))
        .limit(1);
      if (!row) return undefined;
      return {
        idempotencyKey: row.idempotencyKey,
        system: row.system as SyncEntry['system'],
        entityType: row.entityType,
        externalId: row.externalId,
        externalKey: row.externalKey,
        externalVersion: row.externalVersion,
        payloadHash: row.payloadHash,
        lastAction: row.lastAction,
      };
    },
    async save(entry) {
      const values = {
        system: entry.system,
        entityType: entry.entityType,
        externalId: entry.externalId ?? null,
        externalKey: entry.externalKey ?? null,
        externalVersion: entry.externalVersion ?? null,
        payloadHash: entry.payloadHash ?? null,
        lastAction: entry.lastAction,
      };
      await db
        .insert(syncLog)
        .values({ idempotencyKey: entry.idempotencyKey, ...values })
        .onConflictDoUpdate({ target: syncLog.idempotencyKey, set: { ...values, updatedAt: new Date() } });
    },
  };
}

export function memorySyncLog(): SyncLogStore & { entries: Map<string, SyncEntry> } {
  const entries = new Map<string, SyncEntry>();
  return {
    entries,
    async get(key) {
      return entries.get(key);
    },
    async save(entry) {
      entries.set(entry.idempotencyKey, { ...entry });
    },
  };
}
