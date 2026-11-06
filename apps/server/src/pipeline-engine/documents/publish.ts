import type { DocumentStatus, DocumentType } from '@ai-pm/shared';
import type { WriteMode } from '../../config.js';
import type { AtlassianGateway } from '../../integrations/atlassian/index.js';
import { childrenMacro, infoPanel } from '../../render/storage.js';
import { createPublisher, isPlaceholder, type SyncResult } from '../../sync/publisher.js';
import type { SyncLogStore } from '../../sync/sync-log.js';
import type { DocumentInputs } from './inputs.js';
import { type Links, type RenderedDocument, withdrawnProposal } from './render.js';

export interface PublishedDocument {
  type: DocumentType;
  status: DocumentStatus;
  url: string | null;
  pageId: string | null;
  version: number | null;
  note: string | null;
}

export interface DocumentPublisherOptions {
  gateway?: AtlassianGateway;
  store: SyncLogStore;
  mode: WriteMode;
  siteUrl?: string;
  jiraProjectKey?: string;
  spaceKey?: string;
}

const STATUS: Record<SyncResult['action'], DocumentStatus> = {
  created: 'created',
  updated: 'updated',
  unchanged: 'unchanged',
  'would create': 'would_create',
  'would update': 'would_update',
};

/** Sync-log keys of the seeded shared pages the feature blocks go to. */
const SHARED_PAGE: Partial<Record<DocumentType, string>> = {
  risk_register: 'confluence:page:seed:risk_register',
  assumption_log: 'confluence:page:seed:assumption_log',
};
const pageKey = (runId: string, type: DocumentType) => `run:${runId}:${type}`;

/**
 * Publishes a feature's documents through the idempotent publisher (BPMN 04): the shared
 * "Feature Assessments" page once, the Feature Brief under it, the other pages under the Brief,
 * then this feature's blocks on the shared Risk Register and Assumption Log. Pages are found by
 * the sync log and then by title, so a re-publish rewrites them and never duplicates them.
 * In dry-run nothing is written; the result says what a live run would do.
 */
export function createDocumentPublisher(opts: DocumentPublisherOptions) {
  const { gateway, store, mode } = opts;
  const url = (id: string | null | undefined) =>
    id && !isPlaceholder(id) && opts.siteUrl
      ? `${opts.siteUrl}/wiki/pages/viewpage.action?pageId=${id}`
      : null;
  const known = async (key: string) => (await store.get(key))?.externalId ?? null;

  return {
    mode,

    /** Confluence links known before publishing (from earlier publishes and the seed). */
    async knownLinks(runId: string): Promise<Links> {
      return {
        brief: url(await known(`confluence:page:${pageKey(runId, 'feature_brief')}`)),
        riskRegister: url(await known(SHARED_PAGE.risk_register!)),
        assumptionLog: url(await known(SHARED_PAGE.assumption_log!)),
      };
    },

    async publish(
      inputs: DocumentInputs,
      render: (links: Links) => RenderedDocument[],
    ): Promise<{ docs: RenderedDocument[]; results: PublishedDocument[] }> {
      const runId = inputs.run.id;
      const links = await this.knownLinks(runId);
      let docs = render(links);
      if (!gateway || !opts.spaceKey || !opts.jiraProjectKey) {
        return {
          docs,
          results: docs.map((d) => ({
            type: d.type,
            status: d.needed ? 'skipped' : 'not_needed',
            url: null,
            pageId: null,
            version: null,
            note: d.needed ? 'Confluence is not configured' : null,
          })),
        };
      }
      const space = await gateway.confluence.getSpaceByKey(opts.spaceKey);
      if (!space) throw new Error(`Confluence space ${opts.spaceKey} not found`);
      const publisher = createPublisher({ gateway, store, mode, jiraProjectKey: opts.jiraProjectKey });
      const labels = ['ai-pm', 'aipm-assessment', `fa-${inputs.faNumber}`];
      const results: PublishedDocument[] = [];
      const done = (type: DocumentType, r: SyncResult & { version: number | null }, note?: string) => {
        const pageId = isPlaceholder(r.externalId) ? null : r.externalId;
        results.push({
          type,
          status: STATUS[r.action],
          url: url(pageId),
          pageId,
          version: r.version,
          note: note ?? r.note ?? null,
        });
        return pageId;
      };

      const container = await publisher.upsertPage({
        key: 'feature-assessments',
        spaceId: space.id,
        parentId: space.homepageId ?? undefined,
        title: `${inputs.baseline.projectName}: Feature Assessments`,
        storage:
          infoPanel(
            'Feature assessments written by the AI PM pipeline. Each page below is the Feature Brief of one feature; its child pages hold the requirements, the estimate and, when the roadmap changes, a roadmap proposal.',
          ) + childrenMacro(),
        labels: ['ai-pm', 'aipm-assessments'],
      });

      const page = (type: DocumentType, parentId: string | undefined, storage: string, title: string) =>
        publisher.upsertPage({
          key: pageKey(runId, type),
          spaceId: space.id,
          parentId,
          title,
          storage,
          labels: [...labels, `aipm-${type.replaceAll('_', '-')}`],
          overwrite: true,
        });

      const briefDoc = docs.find((d) => d.type === 'feature_brief')!;
      const briefResult = await page('feature_brief', container.externalId, briefDoc.storage, briefDoc.title);
      const briefId = done('feature_brief', briefResult);
      // The shared-page blocks link back to the Brief; render again once its first URL is known.
      if (url(briefId) !== links.brief) docs = render({ ...links, brief: url(briefId) });

      for (const doc of docs.filter((d) => d.kind === 'page' && d.type !== 'feature_brief')) {
        if (doc.needed) {
          done(doc.type, await page(doc.type, briefResult.externalId, doc.storage, doc.title));
        } else if (await known(`confluence:page:${pageKey(runId, doc.type)}`)) {
          // Published earlier, not needed now: rewrite it as withdrawn instead of deleting it.
          done(
            doc.type,
            await page(doc.type, briefResult.externalId, withdrawnProposal(inputs), doc.title),
            'Withdrawn: the feature no longer changes the roadmap',
          );
        } else {
          results.push({
            type: doc.type,
            status: 'not_needed',
            url: null,
            pageId: null,
            version: null,
            note: 'The feature does not change roadmap commitments',
          });
        }
      }

      for (const doc of docs.filter((d) => d.kind === 'block')) {
        const sharedId = await known(SHARED_PAGE[doc.type]!);
        if (!sharedId || isPlaceholder(sharedId)) {
          results.push({
            type: doc.type,
            status: 'skipped',
            url: null,
            pageId: null,
            version: null,
            note: 'The shared page is not in Confluence yet (run the seed with --live)',
          });
          continue;
        }
        done(
          doc.type,
          await publisher.upsertPageBlock({
            key: pageKey(runId, doc.type),
            pageId: sharedId,
            blockId: `aipm-fa-${inputs.faNumber}`,
            storage: doc.storage,
            label: doc.title,
          }),
        );
      }
      return { docs, results };
    },
  };
}

export type DocumentPublisher = ReturnType<typeof createDocumentPublisher>;

