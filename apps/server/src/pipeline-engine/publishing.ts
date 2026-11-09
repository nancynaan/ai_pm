import type pg from 'pg';
import { deckFileName, deckToPptx } from '../render/pptx.js';
import { type RepublishDeps, publishStoredDocuments, republishDocuments } from './documents/decision.js';
import { RunActionError } from './engine.js';
import type { PresentationRepository } from './presentation/repository.js';
import type { RunRecord } from './repository.js';
import { deckContentHash } from './stages/presenting.js';

/**
 * The client's two optional "Publish to Confluence" buttons (BPMN 04 and 05), outside the stage
 * flow: the documents once they are generated, and the deck once the documents are published.
 * Each is published once; there is no re-publish. Pages already published are still kept in
 * step by the stages (the decision, the Epic, the deck), through `republish`.
 *
 * One advisory lock per run serialises every write to the feature's pages, so a client publish
 * and a stage's update never race (two creates could otherwise duplicate a page).
 */

/** An attachment status that means the deck is in Confluence (or would be, in dry-run). */
const PUBLISHED = new Set(['created', 'updated', 'unchanged', 'would_create', 'would_update']);
export const isDeckPublished = (status: string | null | undefined) => !!status && PUBLISHED.has(status);

/** Steps that write the feature's pages themselves; a client publish waits for them to end. */
const WRITING_STATES = new Set(['documenting', 'backlog']);

export interface PublishingDeps {
  pool: pg.Pool;
  republish: RepublishDeps;
  presentations: Pick<PresentationRepository, 'get' | 'setAttachment'>;
  /** Attaches the PPTX to the Feature Brief page (idempotent; dry-run aware). */
  attach(input: {
    runId: string;
    pageId: string;
    fileName: string;
    data: Uint8Array;
    contentHash: string;
  }): Promise<{ status: string; url: string | null }>;
}

export interface PublishOutcome {
  /** The chat message for the client. */
  text: string;
  mode: 'dry-run' | 'live';
  published: number;
}

export function createPublishing(deps: PublishingDeps) {
  const docs = deps.republish.documents;
  const mode = deps.republish.publisher.mode;

  /** Waits for the run's publish lock (session-level, released when the client goes back). */
  async function locked<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const client = await deps.pool.connect();
    try {
      await client.query('select pg_advisory_lock(hashtext($1))', [`publish:${runId}`]);
      try {
        return await fn();
      } finally {
        await client.query('select pg_advisory_unlock(hashtext($1))', [`publish:${runId}`]);
      }
    } finally {
      client.release();
    }
  }

  return {
    locked,

    /** A stage's update of pages already published (never a first publish). */
    republish: (run: RunRecord) => locked(run.id, () => republishDocuments(deps.republish, run)),

    /** The Documents card's "Publish to Confluence": once, after the documents are generated. */
    async documents(run: RunRecord): Promise<PublishOutcome> {
      if (WRITING_STATES.has(run.state))
        throw new RunActionError('A step is writing the documents right now; try again in a moment', 409);
      return locked(run.id, async () => {
        const set = await docs.setOf(run.id);
        if (!set?.draft) throw new RunActionError('Generate the documents first', 409);
        if (set.publishedAt) throw new RunActionError('The documents are already published', 409);
        const r = await publishStoredDocuments(deps.republish, run);
        if (!r) throw new RunActionError('Generate the documents first', 409);
        const published = r.results.filter((x) => x.status !== 'not_needed').length;
        return {
          mode,
          published,
          text:
            mode === 'live'
              ? `The documents are in Confluence (FA-${r.faNumber}): ${published} published. The Documents card has the links.`
              : 'Confluence writes are in dry-run mode, so nothing was written. The Documents card shows what a live publish would do.',
        };
      });
    },

    /** The Proposal card's "Publish to Confluence": once, after the documents are published. */
    async presentation(run: RunRecord): Promise<PublishOutcome> {
      return locked(run.id, async () => {
        const stored = await deps.presentations.get(run.id);
        if (!stored) throw new RunActionError('There is no presentation yet', 409);
        if (isDeckPublished(stored.attachmentStatus))
          throw new RunActionError('The presentation is already published', 409);
        const set = await docs.setOf(run.id);
        const brief = (await docs.documentsOf(run.id)).find((d) => d.type === 'feature_brief');
        // In dry-run the Brief has no real page; the publisher only says what it would do.
        const pageId = brief?.confluencePageId ?? (mode === 'dry-run' ? 'dry-run' : null);
        if (!set?.publishedAt || !pageId)
          throw new RunActionError(
            'Publish the documents first: the presentation goes on the Feature Brief',
            409,
          );
        const attachment = await deps.attach({
          runId: run.id,
          pageId,
          fileName: deckFileName(stored.deck, set.faNumber),
          data: await deckToPptx(stored.deck),
          contentHash: deckContentHash(stored.deck),
        });
        await deps.presentations.setAttachment(run.id, attachment.status, attachment.url);
        // The Brief now embeds the deck (already inside the lock: no second acquire).
        await republishDocuments(deps.republish, run);
        return {
          mode,
          published: 1,
          text:
            mode === 'live'
              ? `The presentation is in Confluence: ${deckFileName(stored.deck, set.faNumber)} is attached to the FA-${set.faNumber} Feature Brief and shown on it.`
              : 'Confluence writes are in dry-run mode, so the presentation was not written. The Proposal card shows what a live publish would do.',
        };
      });
    },
  };
}

export type Publishing = ReturnType<typeof createPublishing>;
