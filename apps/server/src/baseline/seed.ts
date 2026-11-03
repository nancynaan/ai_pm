import type { AppConfig, WriteMode } from '../config.js';
import type { Db } from '../db/client.js';
import type { AtlassianGateway } from '../integrations/atlassian/index.js';
import { markdownToAdf } from '../render/adf.js';
import { infoPanel, markdownToStorage } from '../render/storage.js';
import { createPublisher, type SyncResult } from '../sync/publisher.js';
import type { SyncLogStore } from '../sync/sync-log.js';
import { buildPages, type BuiltPage } from './pages.js';
import type { SeedData } from './seed-data.js';
import { loadBaseline, type RenderedPage } from './store.js';

export const AI_ESTIMATE_FIELD = 'AI estimate (SP)';
const PAGE_LABELS = ['aipm-baseline'];
const NOTICE =
  'Baseline of the AI PM demo project. All names and numbers are fictional. Created by the AI PM seed; the pipeline reads this page when it assesses new features.';

export interface SeedReport {
  mode: WriteMode;
  results: SyncResult[];
  statusChanges: { issue: string; result: string }[];
  baseline: Awaited<ReturnType<typeof loadBaseline>>;
}

const marker = (seedId: string) => `aipm-seed-${seedId.toLowerCase()}`;

export const renderPage = (page: BuiltPage): RenderedPage => ({
  ...page,
  storage: infoPanel(NOTICE) + markdownToStorage(page.markdown),
});

function storyMarkdown(story: SeedData['backlog']['stories'][number]): string {
  if (story.acceptance.length === 0) return story.story;
  return `${story.story}\n\n## Acceptance criteria\n\n\`\`\`gherkin\n${story.acceptance.map((a) => a.trimEnd()).join('\n\n')}\n\`\`\``;
}

/** Checks the target project and space before anything is written. */
async function preflight(config: AppConfig, gateway: AtlassianGateway) {
  const { jiraProjectKey, jiraBoardId, confluenceSpaceKey } = config.atlassian;
  if (!jiraProjectKey || !confluenceSpaceKey)
    throw new Error('Set JIRA_PROJECT_KEY and CONFLUENCE_SPACE_KEY in .env');

  const project = await gateway.jira.getProject(jiraProjectKey);
  if (project.style !== 'classic')
    throw new Error(`${project.key} is team-managed; the seed needs a company-managed Scrum project`);
  const issueTypes = new Set(project.issueTypes?.map((t) => t.name));
  for (const needed of ['Epic', 'Story']) {
    if (!issueTypes.has(needed)) throw new Error(`${project.key} has no "${needed}" issue type`);
  }
  const boards = await gateway.agile.findBoards(jiraProjectKey);
  const board = jiraBoardId
    ? boards.find((b) => b.id === jiraBoardId)
    : boards.find((b) => b.type === 'scrum');
  if (!board) throw new Error(`No Scrum board found for ${project.key}`);
  const estimationField = await gateway.agile.getEstimationField(board.id);

  const space = await gateway.confluence.getSpaceByKey(confluenceSpaceKey);
  if (!space)
    throw new Error(`Confluence space ${confluenceSpaceKey} not found, or the token's account cannot see it`);
  return { project, board, estimationField, space };
}

export async function runSeed(opts: {
  config: AppConfig;
  gateway: AtlassianGateway;
  store: SyncLogStore;
  db: Db;
  seed: SeedData;
  mode: WriteMode;
  log: (message: string) => void;
}): Promise<SeedReport> {
  const { config, gateway, store, db, seed, mode, log } = opts;
  log('Checking the Jira project, board and Confluence space');
  const { project, estimationField, space } = await preflight(config, gateway);
  const publisher = createPublisher({ gateway, store, mode, jiraProjectKey: project.key });

  log(`Custom field "${AI_ESTIMATE_FIELD}"`);
  await publisher.ensureNumberField(
    AI_ESTIMATE_FIELD,
    'Story points estimated by the AI PM pipeline. The team’s own estimate stays in the Story Points field.',
    project.id,
  );

  log(`${seed.components.components.length} Jira components`);
  await publisher.ensureComponents(
    seed.components.components.map((c) => ({ name: c.name, description: c.responsibility })),
  );

  log(`${seed.backlog.epics.length} epics and ${seed.backlog.stories.length} stories`);
  const issueKeys = new Map<string, string>();
  const statusChanges: SeedReport['statusChanges'] = [];
  const common = (id: string, components: string[]) => ({
    project: { key: project.key },
    labels: ['aipm-seed', marker(id)],
    components: components.map((name) => ({ name })),
  });

  for (const epic of seed.backlog.epics) {
    const result = await publisher.upsertIssue({
      key: `seed:${epic.id}`,
      marker: marker(epic.id),
      label: `${epic.id} ${epic.summary}`,
      fields: {
        ...common(epic.id, epic.components),
        issuetype: { name: 'Epic' },
        summary: epic.summary,
        description: markdownToAdf(epic.description),
      },
    });
    issueKeys.set(epic.id, result.externalId);
    statusChanges.push({
      issue: result.externalId,
      result: await publisher.ensureStatus(result.externalId, epic.status),
    });
  }

  for (const story of seed.backlog.stories) {
    const pointsField = estimationField?.fieldId;
    const result = await publisher.upsertIssue({
      key: `seed:${story.id}`,
      marker: marker(story.id),
      label: `${story.id} ${story.summary}`,
      fields: {
        ...common(story.id, story.components),
        issuetype: { name: 'Story' },
        summary: story.summary,
        parent: { key: issueKeys.get(story.epic) },
        description: markdownToAdf(storyMarkdown(story)),
        ...(pointsField ? { [pointsField]: story.points } : {}),
      },
      optionalFields: pointsField ? [pointsField] : [],
    });
    issueKeys.set(story.id, result.externalId);
    statusChanges.push({
      issue: result.externalId,
      result: await publisher.ensureStatus(result.externalId, story.status),
    });
  }

  log(`${seed.pages.length} Confluence pages`);
  const pages = buildPages(seed, { issueKeys }).map(renderPage);
  const home = pages.find((p) => p.type === 'baseline_home');
  if (!home) throw new Error('seed/baseline/pages needs a page with type baseline_home');
  const homeResult = await publisher.upsertPage({
    key: `seed:${home.type}`,
    spaceId: space.id,
    parentId: space.homepageId ?? undefined,
    title: home.title,
    storage: home.storage,
    labels: PAGE_LABELS,
  });
  for (const page of pages.filter((p) => p !== home)) {
    await publisher.upsertPage({
      key: `seed:${page.type}`,
      spaceId: space.id,
      parentId: homeResult.externalId,
      title: page.title,
      storage: page.storage,
      labels: PAGE_LABELS,
    });
  }

  log('Saving the baseline and digest to the database');
  const baseline = await loadBaseline({ db, config, gateway, store, seed, pages });
  return { mode, results: publisher.results, statusChanges, baseline };
}
