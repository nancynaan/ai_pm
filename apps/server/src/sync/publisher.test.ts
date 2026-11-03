import { describe, expect, it } from 'vitest';
import { AtlassianError, type AtlassianGateway } from '../integrations/atlassian/index.js';
import { createPublisher } from './publisher.js';
import { memorySyncLog } from './sync-log.js';

interface FakePage {
  id: string;
  title: string;
  version: { number: number };
  body: { storage: { value: string } };
}

function fakeAtlassian(options: { refuseField?: string } = {}) {
  const writes: string[] = [];
  const issues: { id: string; key: string; labels: string[] }[] = [];
  const pages = new Map<string, FakePage>();
  let seq = 0;
  const gateway = {
    siteUrl: 'https://demo.atlassian.net',
    readOnly: false,
    jira: {
      search: async (jql: string) => {
        const label = /labels = "([^"]+)"/.exec(jql)?.[1] ?? '';
        return issues.filter((i) => i.labels.includes(label)).map(({ id, key }) => ({ id, key }));
      },
      createIssue: async (fields: Record<string, unknown>) => {
        if (options.refuseField && options.refuseField in fields) {
          throw new AtlassianError(
            `POST /rest/api/3/issue failed with 400: Field '${options.refuseField}' cannot be set`,
            400,
            '/rest/api/3/issue',
          );
        }
        writes.push(`create issue ${String(fields.summary)}`);
        const issue = { id: String(++seq), key: `AIPM-${seq}`, labels: fields.labels as string[] };
        issues.push(issue);
        return { id: issue.id, key: issue.key };
      },
      updateIssue: async (key: string) => {
        writes.push(`update issue ${key}`);
      },
      listComponents: async () => [{ id: '10', name: 'Physics & Movement' }],
      createComponent: async (_project: string, name: string) => {
        writes.push(`create component ${name}`);
        return { id: '11', name };
      },
    },
    confluence: {
      getPage: async (id: string) => pages.get(id) ?? null,
      findPageByTitle: async (_space: string, title: string) =>
        [...pages.values()].find((p) => p.title === title) ?? null,
      createPage: async ({ title, storage }: { title: string; storage: string }) => {
        writes.push(`create page ${title}`);
        const page = {
          id: String(++seq),
          title,
          version: { number: 1 },
          body: { storage: { value: storage } },
        };
        pages.set(page.id, page);
        return page;
      },
      updatePage: async (id: string, version: number, { storage }: { storage: string }) => {
        writes.push(`update page ${id} to v${version}`);
        const page = pages.get(id)!;
        Object.assign(page, { version: { number: version }, body: { storage: { value: storage } } });
        return page;
      },
      addLabels: async () => undefined,
    },
  } as unknown as AtlassianGateway;
  return { gateway, writes, pages };
}

const story = (summary = 'Lane switching') => ({
  key: 'seed:ST-01',
  marker: 'aipm-seed-st-01',
  label: 'ST-01',
  fields: {
    project: { key: 'AIPM' },
    issuetype: { name: 'Story' },
    summary,
    labels: ['aipm-seed', 'aipm-seed-st-01'],
  },
});

describe('publisher issues', () => {
  it('creates once, skips unchanged payloads and updates changed ones', async () => {
    const { gateway, writes } = fakeAtlassian();
    const store = memorySyncLog();
    const live = () => createPublisher({ gateway, store, mode: 'live', jiraProjectKey: 'AIPM' });

    expect((await live().upsertIssue(story())).action).toBe('created');
    expect((await live().upsertIssue(story())).action).toBe('unchanged');
    expect((await live().upsertIssue(story('Lane switching v2'))).action).toBe('updated');
    expect(writes).toEqual(['create issue Lane switching', 'update issue AIPM-1']);
  });

  it('finds an existing issue by its marker label when the sync log is empty', async () => {
    const { gateway, writes } = fakeAtlassian();
    await createPublisher({
      gateway,
      store: memorySyncLog(),
      mode: 'live',
      jiraProjectKey: 'AIPM',
    }).upsertIssue(story());

    const result = await createPublisher({
      gateway,
      store: memorySyncLog(),
      mode: 'live',
      jiraProjectKey: 'AIPM',
    }).upsertIssue(story());
    expect(result).toMatchObject({ action: 'updated', externalId: 'AIPM-1' });
    expect(writes.filter((w) => w.startsWith('create'))).toHaveLength(1);
  });

  it('writes nothing in dry-run and reports what it would do', async () => {
    const { gateway, writes } = fakeAtlassian();
    const store = memorySyncLog();
    const result = await createPublisher({
      gateway,
      store,
      mode: 'dry-run',
      jiraProjectKey: 'AIPM',
    }).upsertIssue(story());

    expect(result).toMatchObject({ action: 'would create', externalId: '(new seed:ST-01)' });
    expect(writes).toEqual([]);
    expect(store.entries.size).toBe(0);
  });

  it('retries without an optional field Jira refuses', async () => {
    const { gateway } = fakeAtlassian({ refuseField: 'customfield_10016' });
    const input = {
      ...story(),
      fields: { ...story().fields, customfield_10016: 5 },
      optionalFields: ['customfield_10016'],
    };
    const result = await createPublisher({
      gateway,
      store: memorySyncLog(),
      mode: 'live',
      jiraProjectKey: 'AIPM',
    }).upsertIssue(input);

    expect(result).toMatchObject({ action: 'created', note: 'Jira refused customfield_10016; left empty' });
  });
});

describe('publisher pages', () => {
  const page = (storage: string) => ({
    key: 'seed:risk_register',
    spaceId: 'S1',
    title: 'Comet Run: Risk Register',
    storage,
    labels: [],
  });

  it('keeps edits people made in Confluence while our content is unchanged', async () => {
    const { gateway, writes, pages } = fakeAtlassian();
    const store = memorySyncLog();
    const live = () => createPublisher({ gateway, store, mode: 'live', jiraProjectKey: 'AIPM' });

    const created = await live().upsertPage(page('<p>v1</p>'));
    pages.get(created.externalId)!.version.number = 2; // someone edited the page

    expect((await live().upsertPage(page('<p>v1</p>'))).action).toBe('unchanged');
    expect((await live().upsertPage(page('<p>v2</p>'))).action).toBe('updated');
    expect(writes).toEqual([
      'create page Comet Run: Risk Register',
      `update page ${created.externalId} to v3`,
    ]);
  });
});

describe('publisher components', () => {
  it('creates only the missing components', async () => {
    const { gateway, writes } = fakeAtlassian();
    const publisher = createPublisher({
      gateway,
      store: memorySyncLog(),
      mode: 'live',
      jiraProjectKey: 'AIPM',
    });

    await publisher.ensureComponents([
      { name: 'Physics & Movement', description: '' },
      { name: 'Audio', description: '' },
    ]);
    expect(publisher.results.map((r) => r.action)).toEqual(['unchanged', 'created']);
    expect(writes).toEqual(['create component Audio']);
  });
});
