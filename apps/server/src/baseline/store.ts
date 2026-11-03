import { createHash } from 'node:crypto';
import type { BaselineSummary } from '@ai-pm/shared';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { baselineArtifacts, projects } from '../db/schema.js';
import type { AtlassianGateway } from '../integrations/atlassian/index.js';
import { storageToText } from '../render/storage.js';
import { isPlaceholder } from '../sync/publisher.js';
import type { SyncLogStore } from '../sync/sync-log.js';
import { buildDigest } from './digest.js';
import type { BuiltPage } from './pages.js';
import type { SeedData } from './seed-data.js';

export interface RenderedPage extends BuiltPage {
  storage: string;
}

export const pageSyncKey = (type: string) => `confluence:page:seed:${type}`;

/**
 * Loads the baseline into the database: each page as it currently is in Confluence (so edits
 * made there are picked up), or the locally rendered version while nothing has been published.
 * Also stores the structured data and the digest the agents use.
 */
export async function loadBaseline(opts: {
  db: Db;
  config: AppConfig;
  gateway: AtlassianGateway;
  store: SyncLogStore;
  seed: SeedData;
  pages: RenderedPage[];
}) {
  const { db, config, gateway, store, seed, pages } = opts;
  const key = config.atlassian.jiraProjectKey ?? seed.project.name;
  const now = new Date();
  const digest = buildDigest(seed);
  const projectValues = {
    name: seed.project.name,
    jiraProjectKey: config.atlassian.jiraProjectKey ?? '',
    confluenceSpaceKey: config.atlassian.confluenceSpaceKey ?? '',
    baselineDigest: digest,
    baselineSyncedAt: now,
  };
  const [project] = await db
    .insert(projects)
    .values({ key, ...projectValues })
    .onConflictDoUpdate({ target: projects.key, set: { ...projectValues, updatedAt: now } })
    .returning({ id: projects.id });
  if (!project) throw new Error('Could not save the project row');

  let fromConfluence = 0;
  for (const page of pages) {
    const pageId = (await store.get(pageSyncKey(page.type)))?.externalId ?? undefined;
    const remote = pageId && !isPlaceholder(pageId) ? await gateway.confluence.getPage(pageId) : null;
    const storage = remote?.body?.storage?.value ?? page.storage;
    if (remote) fromConfluence++;
    const values = {
      title: remote?.title ?? page.title,
      confluencePageId: remote?.id ?? null,
      confluenceVersion: remote?.version.number ?? null,
      contentStorage: storage,
      contentText: storageToText(storage),
      data: page.data,
      checksum: createHash('sha256').update(storage).digest('hex'),
      syncedAt: now,
    };
    await db
      .insert(baselineArtifacts)
      .values({ projectId: project.id, type: page.type, ...values })
      .onConflictDoUpdate({ target: [baselineArtifacts.projectId, baselineArtifacts.type], set: values });
  }
  return {
    projectId: project.id,
    artifacts: pages.length,
    fromConfluence,
    digestLines: digest.split('\n').length,
  };
}

/** What the status page shows: the project, its artifacts with Confluence links, and the digest. */
export async function readBaselineSummary(db: Db, config: AppConfig): Promise<BaselineSummary> {
  const projectKey = config.atlassian.jiraProjectKey;
  const [project] = projectKey
    ? await db.select().from(projects).where(eq(projects.key, projectKey)).limit(1)
    : await db.select().from(projects).limit(1);
  if (!project) return { project: null, artifacts: [], digest: null };
  const rows = await db
    .select()
    .from(baselineArtifacts)
    .where(eq(baselineArtifacts.projectId, project.id))
    .orderBy(baselineArtifacts.title);
  const siteUrl = config.atlassian.siteUrl;
  return {
    project: {
      key: project.key,
      name: project.name,
      syncedAt: project.baselineSyncedAt?.toISOString() ?? null,
    },
    artifacts: rows.map((a) => ({
      type: a.type,
      title: a.title,
      url:
        a.confluencePageId && siteUrl
          ? `${siteUrl}/wiki/pages/viewpage.action?pageId=${a.confluencePageId}`
          : null,
      version: a.confluenceVersion,
      syncedAt: a.syncedAt.toISOString(),
    })),
    digest: project.baselineDigest,
  };
}
