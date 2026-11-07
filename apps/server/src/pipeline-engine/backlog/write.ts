import type { DocumentStatus } from '@ai-pm/shared';
import { AI_ESTIMATE_FIELD } from '../../baseline/seed.js';
import type { WriteMode } from '../../config.js';
import type { AtlassianGateway } from '../../integrations/atlassian/index.js';
import { markdownToAdf } from '../../render/adf.js';
import { markdownToStorage, statusMacro } from '../../render/storage.js';
import { markdownTable } from '../../render/tables.js';
import { createPublisher, isPlaceholder, type SyncAction, type SyncResult } from '../../sync/publisher.js';
import type { SyncLogStore } from '../../sync/sync-log.js';
import { INITIAL_BACKLOG_PAGE, initialBacklogKey } from '../documents/publish.js';
import type { BacklogPlan, IssuePlan } from './plan.js';

export interface IssueResult {
  localId: string;
  status: DocumentStatus;
  /** Jira key; null in dry-run for an issue that does not exist yet. */
  key: string | null;
  url: string | null;
  note: string | null;
}

export interface BacklogWriteResult {
  epic: IssueResult;
  stories: IssueResult[];
  links: { created: number; unchanged: number; planned: number };
}

export interface BacklogWriterOptions {
  gateway?: AtlassianGateway;
  store: SyncLogStore;
  mode: WriteMode;
  jiraProjectKey?: string;
  siteUrl?: string;
}

const STATUS: Record<SyncAction, DocumentStatus> = {
  created: 'created',
  updated: 'updated',
  unchanged: 'unchanged',
  'would create': 'would_create',
  'would update': 'would_update',
};

const issueKey = (runId: string, plan: IssuePlan) =>
  plan.type === 'epic' ? `run:${runId}:epic` : `run:${runId}:story:${plan.localId}`;

/**
 * Writes an approved feature's backlog through the idempotent publisher (BPMN 06): the Epic
 * (created, or the draft from intake completed), one story per item under it, `Blocks` links and
 * a link from the Epic to the Feature Brief, then the feature's block on the Initial Product
 * Backlog page. Each issue has a sync-log key and a marker label, so a second run updates the same
 * issues and never duplicates them. Nothing goes into a sprint; new issues start in To Do. In
 * dry-run nothing is written; the result says what a live run would do.
 */
export function createBacklogWriter(opts: BacklogWriterOptions) {
  const { gateway, store, mode } = opts;
  const pageUrl = (id: string | null | undefined) =>
    id && !isPlaceholder(id) && opts.siteUrl
      ? `${opts.siteUrl}/wiki/pages/viewpage.action?pageId=${id}`
      : null;

  return {
    mode,

    async writeIssues(
      runId: string,
      plan: BacklogPlan,
      briefUrl: string | null,
    ): Promise<BacklogWriteResult> {
      if (!gateway || !opts.jiraProjectKey) {
        const skipped = (p: IssuePlan): IssueResult => ({
          localId: p.localId,
          status: 'skipped',
          key: null,
          url: null,
          note: 'Jira is not configured',
        });
        return {
          epic: skipped(plan.epic),
          stories: plan.stories.map(skipped),
          links: { created: 0, unchanged: 0, planned: 0 },
        };
      }
      const projectKey = opts.jiraProjectKey;
      const publisher = createPublisher({ gateway, store, mode, jiraProjectKey: projectKey });
      const [fields, priorities, components] = await Promise.all([
        gateway.jira.listFields(),
        gateway.jira.listPriorities().catch(() => [] as string[]),
        gateway.jira.listComponents(projectKey).catch(() => []),
      ]);
      const estimateField = fields.find((f) => f.custom && f.name === AI_ESTIMATE_FIELD)?.id;
      const componentNames = new Set(components.map((c) => c.name));

      const upsert = async (p: IssuePlan, extra: Record<string, unknown>) => {
        const notes: string[] = [];
        const priority = priorities.includes(p.priority) ? { priority: { name: p.priority } } : {};
        if (!priorities.includes(p.priority)) notes.push(`Jira has no priority "${p.priority}"; left as is`);
        const known = p.components.filter((c) => componentNames.has(c));
        const estimate = estimateField && p.aiEstimate !== null ? { [estimateField]: p.aiEstimate } : {};
        const r: SyncResult = await publisher.upsertIssue({
          key: issueKey(runId, p),
          marker: p.marker,
          label: `${p.localId} ${p.summary}`,
          fields: {
            project: { key: projectKey },
            issuetype: { name: p.type === 'epic' ? 'Epic' : 'Story' },
            summary: p.summary,
            description: markdownToAdf(p.description),
            labels: p.labels,
            ...priority,
            ...(known.length ? { components: known.map((name) => ({ name })) } : {}),
            ...estimate,
            ...extra,
          },
          optionalFields: ['priority', ...(estimateField ? [estimateField] : [])],
        });
        if (r.note) notes.push(r.note);
        if (r.action === 'created') {
          // New issues start in the workflow's first status; make sure that is To Do.
          const moved = await publisher.ensureStatus(r.externalId, 'todo');
          if (moved === 'no transition') notes.push('could not move it to To Do');
        }
        return {
          localId: p.localId,
          status: STATUS[r.action],
          key: isPlaceholder(r.externalId) ? null : r.externalId,
          url: r.url ?? null,
          note: notes.join('; ') || null,
          externalId: r.externalId,
        };
      };

      const { externalId: epicId, ...epic } = await upsert(plan.epic, {});
      const parent = isPlaceholder(epicId) ? {} : { parent: { key: epicId } };
      const stories: (IssueResult & { externalId: string })[] = [];
      for (const story of plan.stories) stories.push(await upsert(story, parent));

      const idOf = new Map(stories.map((s) => [s.localId, s.externalId]));
      const links = { created: 0, unchanged: 0, planned: 0 };
      for (const story of plan.stories) {
        for (const blocker of story.blockedBy) {
          const r = await publisher.ensureBlocksLink(idOf.get(blocker) ?? '', idOf.get(story.localId) ?? '');
          if (r === 'created') links.created++;
          else if (r === 'unchanged') links.unchanged++;
          else links.planned++;
        }
      }
      if (briefUrl) {
        await publisher.ensureRemoteLink({
          key: `run:${runId}:epic:brief`,
          issueKey: epicId,
          url: briefUrl,
          title: 'Feature Brief (Confluence)',
        });
      }
      const withoutId = (s: IssueResult & { externalId: string }): IssueResult => ({
        localId: s.localId,
        status: s.status,
        key: s.key,
        url: s.url,
        note: s.note,
      });
      return { epic, stories: stories.map(withoutId), links };
    },

    /** The feature's block on the Initial Product Backlog page: the Epic and its stories. */
    async writeInitialBacklog(
      runId: string,
      blockId: string,
      markdown: string,
    ): Promise<{ status: DocumentStatus; url: string | null; note: string | null }> {
      if (!gateway || !opts.jiraProjectKey)
        return { status: 'skipped', url: null, note: 'Confluence is not configured' };
      const pageId = (await store.get(INITIAL_BACKLOG_PAGE))?.externalId;
      if (!pageId || isPlaceholder(pageId))
        return {
          status: 'skipped',
          url: null,
          note: 'The Initial Product Backlog page is not in Confluence yet (run the seed with --live)',
        };
      const publisher = createPublisher({ gateway, store, mode, jiraProjectKey: opts.jiraProjectKey });
      const r = await publisher.upsertPageBlock({
        key: initialBacklogKey(runId),
        pageId,
        blockId,
        storage: markdownToStorage(markdown, { ai_draft: statusMacro('Yellow', 'AI draft') }),
        label: 'Initial Product Backlog',
      });
      return { status: STATUS[r.action], url: pageUrl(r.externalId), note: r.note ?? null };
    },
  };
}

export type BacklogWriter = ReturnType<typeof createBacklogWriter>;

/** Markdown of the feature's block on the Initial Product Backlog page. */
export function initialBacklogBlock(
  fa: string,
  plan: BacklogPlan,
  result: Pick<BacklogWriteResult, 'epic' | 'stories'>,
  briefUrl: string | null,
): string {
  const keyOf = (r: IssueResult | undefined) =>
    r?.key && r.url ? `[${r.key}](${r.url})` : (r?.key ?? '(new)');
  const byId = new Map(result.stories.map((s) => [s.localId, s]));
  const kind = (t: string) => (t === 'nfr' ? 'NFR' : t[0]!.toUpperCase() + t.slice(1));
  return [
    `## ${fa} ${plan.epic.summary} (${result.epic.key ?? 'Epic'})`,
    `{{macro:ai_draft}} Added by the AI PM pipeline after the client approved the feature: Epic ${keyOf(result.epic)} with ${plan.stories.length} stories in the Product Backlog. They are not in any sprint; the Product Owner reviews and orders them, and the team refines and estimates them.${briefUrl ? ` Assessment: [${fa} Feature Brief](${briefUrl}).` : ''}`,
    markdownTable(plan.stories, [
      { header: 'Key', value: (s) => keyOf(byId.get(s.localId)) },
      { header: 'Item', value: (s) => s.localId },
      { header: 'Summary', value: (s) => s.summary.replaceAll('|', '/') },
      { header: 'Type', value: (s) => kind(s.type) },
      { header: 'Proposed priority', value: (s) => s.priority },
      { header: 'AI estimate (SP)', value: (s) => (s.aiEstimate === null ? '—' : String(s.aiEstimate)) },
      { header: 'Blocked by', value: (s) => s.blockedBy.join(', ') || '—' },
    ]),
    'Story points stay empty until the team estimates; the AI estimate is a preliminary size.',
  ].join('\n\n');
}
