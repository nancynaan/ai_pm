import type { SeedData } from '../baseline/seed-data.js';
import { type AtlassianGateway, ReadOnlyViolation } from '../integrations/atlassian/index.js';

/**
 * A read-only Atlassian site for the end-to-end test: the seed project's components and backlog
 * in Jira, an empty Confluence space, and nothing else. Every write is refused the way the real
 * read-only gateway refuses it, and recorded, so the test can prove a dry-run wrote nothing.
 * A method the fake does not know throws with its name, so a new gateway call shows up at once.
 */
export function fakeAtlassian(seed: SeedData) {
  const writes: string[] = [];
  const write =
    (name: string) =>
    async (...args: unknown[]) => {
      writes.push(`${name} ${JSON.stringify(args).slice(0, 120)}`);
      throw new ReadOnlyViolation(`dry-run: ${name} refused`);
    };
  const keys = new Map<string, string>();
  [...seed.backlog.epics, ...seed.backlog.stories].forEach((item, i) => keys.set(item.id, `AIPM-${i + 1}`));

  const jira = {
    getMyself: async () => ({ accountId: 'e2e', displayName: 'E2E' }),
    getProject: async (key: string) => ({ id: '10000', key, name: 'Comet Run', style: 'classic' }),
    listFields: async () => [{ id: 'customfield_10050', name: 'AI estimate (SP)', custom: true }],
    listComponents: async () =>
      seed.components.components.map((c, i) => ({ id: String(i + 1), name: c.name })),
    listPriorities: async () => ['Highest', 'High', 'Medium', 'Low', 'Lowest'],
    // Marker-label lookups: nothing the pipeline created exists yet.
    search: async () => [],
    searchBacklog: async () => [
      ...seed.backlog.epics.map((e) => ({
        key: keys.get(e.id)!,
        summary: e.summary,
        type: 'Epic',
        status: e.status,
        components: e.components,
        parent: null,
      })),
      ...seed.backlog.stories.map((s) => ({
        key: keys.get(s.id)!,
        summary: s.summary,
        type: 'Story',
        status: s.status,
        components: s.components,
        parent: keys.get(s.epic) ?? null,
      })),
    ],
    getStatusCategory: async () => 'new',
    listTransitions: async () => [],
    issueLinks: async () => [],
    createNumberField: write('createNumberField'),
    addFieldToScreen: write('addFieldToScreen'),
    createComponent: write('createComponent'),
    createIssue: write('createIssue'),
    updateIssue: write('updateIssue'),
    transitionIssue: write('transitionIssue'),
    createIssueLink: write('createIssueLink'),
    deleteIssueLink: write('deleteIssueLink'),
    upsertRemoteLink: write('upsertRemoteLink'),
  };
  const confluence = {
    getSpaceByKey: async (key: string) => ({ id: '98305', key, name: 'AI PM' }),
    findPageByTitle: async () => null,
    getPage: async () => null,
    findAttachment: async () => null,
    createPage: write('createPage'),
    updatePage: write('updatePage'),
    uploadAttachment: write('uploadAttachment'),
    addLabels: write('addLabels'),
  };
  const agile = {
    findBoards: async () => [{ id: 36, name: 'AIPM board', type: 'scrum' }],
    getEstimationField: async () => ({ fieldId: 'customfield_10016', displayName: 'Story Points' }),
  };

  const strict = <T extends object>(area: string, api: T) =>
    new Proxy(api, {
      get(target, prop) {
        if (typeof prop !== 'string' || prop in target) return Reflect.get(target, prop);
        throw new Error(`fake Atlassian: ${area}.${prop} is not faked`);
      },
    });
  const gateway = {
    siteUrl: 'https://example.atlassian.net',
    readOnly: true,
    jira: strict('jira', jira),
    confluence: strict('confluence', confluence),
    agile: strict('agile', agile),
  } as unknown as AtlassianGateway;
  return { gateway, writes };
}
