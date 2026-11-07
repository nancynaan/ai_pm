import { type Assessment, assessmentSchema, type RunEvent } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import type { BacklogDraft } from '../../agents/schemas.js';
import type { AtlassianGateway } from '../../integrations/atlassian/index.js';
import { memorySyncLog } from '../../sync/sync-log.js';
import { recordDecision } from '../documents/decision.js';
import { buildFigures } from '../documents/figures.js';
import type { DocumentInputs } from '../documents/inputs.js';
import type { StageContext } from '../engine.js';
import { backlogStage } from '../stages/backlog.js';
import { estimatingStage } from '../stages/estimating.js';
import { analysis, round1, run, seed, setupEstimating } from '../testing/fixtures.js';
import {
  type BacklogInputs,
  buildBacklogPlan,
  checkBacklogDraft,
  coverageGaps,
  findCycle,
  gherkin,
  proposePriority,
} from './plan.js';
import { createBacklogWriter, initialBacklogBlock } from './write.js';

async function assessed(): Promise<Assessment> {
  const { ctx, services, saved } = setupEstimating([round1({})]);
  await estimatingStage(services)(ctx);
  const a = assessmentSchema.parse(saved());
  // The spike also covers the NFR, so every requirement in scope has a story.
  return {
    ...a,
    storyMap: {
      ...a.storyMap,
      items: a.storyMap.items.map((i) => (i.ref === 'S-3' ? { ...i, requirementCodes: ['REQ-NFR-001'] } : i)),
    },
  };
}

function docsFor(assessment: Assessment): DocumentInputs {
  return {
    run: { id: run.id, title: run.title, description: run.description },
    faNumber: 3,
    featureName: 'Weekend tournament with a ranking',
    epicKey: null,
    restatement: null,
    assessment,
    analysis,
    report: null,
    answered: [round1({})],
    assumptions: [],
    constraints: [],
    decisions: [
      { gate: 'assessment', decision: 'approve', comment: null, decidedAt: '2026-11-07T10:00:00.000Z' },
    ],
    baseline: { projectName: seed.project.name, financials: seed.kpis.financials, roadmap: seed.roadmap },
  };
}

const inputsFor = (assessment: Assessment): BacklogInputs => ({
  docs: docsFor(assessment),
  specification: null,
  existingBacklog: '(the backlog is empty)',
  documents: [
    { title: 'FA-3 Feature Brief: Weekend tournament', url: 'https://demo.atlassian.net/wiki/brief' },
  ],
  briefUrl: 'https://demo.atlassian.net/wiki/brief',
});

const story = (ref: string, blockedBy: string[] = []): BacklogDraft['stories'][number] => ({
  ref,
  summary: `Tournament part ${ref}`,
  userStory: `As a player, I want part ${ref} of the tournament, so that the weekend is more fun.`,
  context: 'Build it on the existing event screen and reuse the leaderboard UI.',
  acceptanceCriteria: [
    {
      scenario: 'The event is open',
      given: ['it is Friday', 'Given the player has finished the tutorial'],
      when: ['the player opens the main menu'],
      then: ['the tournament entry is shown'],
    },
  ],
  blockedBy,
  openQuestions: [],
});

const draft: BacklogDraft = {
  epic: {
    overview: 'A weekend tournament where players compete on distance for a ranking and a reward.',
    outcome: 'Longer weekend sessions among active players.',
  },
  stories: [story('S-1', ['S-2']), story('S-2', ['S-3']), story('S-3'), story('S-4')],
};

describe('backlog rules', () => {
  it('proposes priorities from MoSCoW, one step up for items others wait for', () => {
    expect(proposePriority(['must'], false)).toBe('High');
    expect(proposePriority(['must', 'could'], true)).toBe('Highest');
    expect(proposePriority(['should'], false)).toBe('Medium');
    expect(proposePriority(['could'], false)).toBe('Low');
    expect(proposePriority(['wont'], false)).toBe('Lowest');
    expect(proposePriority([], false)).toBe('Medium');
  });

  it('finds requirements no story covers, ignoring won’t-haves', async () => {
    const a = await assessed();
    expect(coverageGaps(inputsFor(a))).toEqual([]);
    const uncovered = {
      ...a,
      storyMap: { ...a.storyMap, items: a.storyMap.items.filter((i) => i.ref !== 'S-3') },
    };
    expect(coverageGaps(inputsFor(uncovered))).toEqual(['REQ-NFR-001']);
  });

  it('accepts a complete draft and sends problems back to the agent', async () => {
    const items = (await assessed()).storyMap.items;
    expect(checkBacklogDraft(draft, items)).toEqual([]);
    // Any role is fine, with or without an article.
    const qa = {
      ...draft,
      stories: draft.stories.map((s) => ({
        ...s,
        userStory: `As QA, I want to test ${s.ref}, so that the release is safe.`,
      })),
    };
    expect(checkBacklogDraft(qa, items)).toEqual([]);
    const bad: BacklogDraft = {
      ...draft,
      stories: [
        { ...story('S-1', ['S-2']), userStory: 'The player gets a tournament.' },
        story('S-2', ['S-1']),
        { ...story('S-3', ['S-9']), context: 'About 5 story points of server work, planned for Sprint 14.' },
        story('S-5'),
      ],
    };
    const problems = checkBacklogDraft(bad, items).join('\n');
    expect(problems).toMatch(/S-1: userStory must read/);
    expect(problems).toMatch(/S-3 is blocked by unknown S-9/);
    expect(problems).toMatch(/S-3 mentions story points/);
    expect(problems).toMatch(/S-3 mentions a sprint/);
    expect(problems).toMatch(/S-5 is not in the story map/);
    expect(problems).toMatch(/S-4 has no story/);
    expect(problems).toMatch(/cycle: S-1 → S-2 → S-1/);
  });

  it('finds cycles in blockers', () => {
    expect(
      findCycle([
        { ref: 'A', blockedBy: ['B'] },
        { ref: 'B', blockedBy: [] },
      ]),
    ).toBeNull();
    expect(
      findCycle([
        { ref: 'A', blockedBy: ['B'] },
        { ref: 'B', blockedBy: ['A'] },
      ]),
    ).toEqual(['A', 'B', 'A']);
  });

  it('renders Gherkin with one keyword per step and no doubled keywords', () => {
    expect(gherkin(draft.stories[0]!.acceptanceCriteria)).toBe(
      [
        '  Scenario: The event is open',
        '    Given it is Friday',
        '    And the player has finished the tutorial',
        '    When the player opens the main menu',
        '    Then the tournament entry is shown',
      ].join('\n'),
    );
  });

  it('plans the Epic and stories as an AI draft: labels, proposed priority, AI estimate, no Story Points', async () => {
    const a = await assessed();
    const inputs = inputsFor(a);
    const plan = buildBacklogPlan(inputs, draft, buildFigures(inputs.docs));
    expect(plan.epic.labels).toEqual(['ai-pm', 'ai-draft', 'fa-3', `aipm-run-${run.id}`]);
    expect(plan.epic.priority).toBe('High');
    expect(plan.epic.description).toMatch(/AI draft, pending Product Owner review/);
    expect(plan.epic.description).toMatch(/not a delivery commitment/);
    expect(plan.stories.map((s) => s.localId)).toEqual(['S-1', 'S-2', 'S-3', 'S-4']);
    const [s1, s2, s3] = plan.stories;
    expect(s1!.priority).toBe('High'); // must, blocks nobody
    expect(s2!.priority).toBe('High'); // must; S-1 waits for it, but it waits for S-3 itself
    expect(s3!.priority).toBe('Highest'); // must, S-2 waits for it and it waits for nothing: start here
    expect(s2!.labels).toContain('enabler');
    expect(s3!.labels).toContain('spike');
    expect(s1!.aiEstimate).toBe(Math.round(a.storyMap.items[0]!.mean * 10) / 10);
    expect(s1!.description).toMatch(/```gherkin\nFeature: Tournament part S-1/);
    expect(s1!.description).toMatch(/Blocked by S-2: Tournament part S-2/);
    expect(s1!.description).toMatch(/Story Points are left for the team/);
  });
});

// ---- writing to Jira --------------------------------------------------------------------------

interface FakeIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  links: { id: string; type: string; inward: string | null; outward: string | null }[];
}

function fakeJira(options: { reversedLinks?: boolean } = {}) {
  const writes: string[] = [];
  const issues: FakeIssue[] = [];
  const remoteLinks = new Map<string, string>();
  let seq = 40;
  let linkSeq = 0;
  const byKey = (key: string) => issues.find((i) => i.key === key)!;
  const page = {
    id: '589827',
    title: 'Initial Product Backlog',
    version: { number: 4 },
    parentId: null,
    body: { storage: { value: '<p>Backlog</p>' } },
  };
  const gateway = {
    siteUrl: 'https://demo.atlassian.net',
    readOnly: false,
    jira: {
      listFields: async () => [{ id: 'customfield_10050', name: 'AI estimate (SP)', custom: true }],
      listPriorities: async () => ['Highest', 'High', 'Medium', 'Low', 'Lowest'],
      listComponents: async () => [{ id: '1', name: 'Physics & Movement' }],
      search: async (jql: string) => {
        const label = /labels = "([^"]+)"/.exec(jql)?.[1] ?? '';
        return issues
          .filter((i) => (i.fields.labels as string[]).includes(label))
          .map(({ id, key }) => ({ id, key }));
      },
      createIssue: async (fields: Record<string, unknown>) => {
        const issue = { id: String(++seq), key: `AIPM-${seq}`, fields, links: [] };
        issues.push(issue);
        writes.push(`create ${issue.key} ${String((fields.issuetype as { name: string }).name)}`);
        return { id: issue.id, key: issue.key };
      },
      updateIssue: async (key: string, fields: Record<string, unknown>) => {
        writes.push(`update ${key}`);
        Object.assign(byKey(key).fields, fields);
      },
      getStatusCategory: async () => 'new',
      listTransitions: async () => [],
      transitionIssue: async () => undefined,
      issueLinks: async (key: string) => byKey(key).links,
      createIssueLink: async (type: string, outwardKey: string, inwardKey: string) => {
        writes.push(`link ${outwardKey} ${type} ${inwardKey}`);
        const id = String(++linkSeq);
        // Jira lists the link on both issues, each seeing the other one.
        const [blocker, blocked] = options.reversedLinks ? [inwardKey, outwardKey] : [outwardKey, inwardKey];
        byKey(blocked).links.push({ id, type, inward: blocker, outward: null });
        byKey(blocker).links.push({ id, type, inward: null, outward: blocked });
      },
      deleteIssueLink: async (id: string) => {
        writes.push(`delete link ${id}`);
        for (const i of issues) i.links = i.links.filter((l) => l.id !== id);
      },
      upsertRemoteLink: async (key: string, link: { globalId: string; url: string }) => {
        writes.push(`remote link ${key}`);
        remoteLinks.set(link.globalId, link.url);
      },
    },
    confluence: {
      getPage: async (id: string) => (id === page.id ? page : null),
      updatePage: async (id: string, version: number, content: { storage: string }) => {
        writes.push(`update page ${id}`);
        page.version.number = version;
        page.body.storage.value = content.storage;
        return { ...page, id };
      },
    },
  } as unknown as AtlassianGateway;
  return { gateway, writes, issues, remoteLinks, page };
}

async function planned() {
  const a = await assessed();
  const inputs = inputsFor(a);
  return { inputs, plan: buildBacklogPlan(inputs, draft, buildFigures(inputs.docs)) };
}

describe('backlog writer', () => {
  it('writes nothing in dry-run and says what a live run would do', async () => {
    const { plan } = await planned();
    const jira = fakeJira();
    const writer = createBacklogWriter({
      gateway: jira.gateway,
      store: memorySyncLog(),
      mode: 'dry-run',
      jiraProjectKey: 'AIPM',
      siteUrl: 'https://demo.atlassian.net',
    });
    const result = await writer.writeIssues(run.id, plan, 'https://demo.atlassian.net/wiki/brief');
    expect(jira.writes).toEqual([]);
    expect(result.epic.status).toBe('would_create');
    expect(result.stories.every((s) => s.status === 'would_create' && s.key === null)).toBe(true);
    expect(result.links.planned).toBe(2);
  });

  it('creates the Epic and stories once; a second run changes nothing (idempotent)', async () => {
    const { plan } = await planned();
    const jira = fakeJira();
    const store = memorySyncLog();
    const writer = createBacklogWriter({
      gateway: jira.gateway,
      store,
      mode: 'live',
      jiraProjectKey: 'AIPM',
      siteUrl: 'https://demo.atlassian.net',
    });
    const first = await writer.writeIssues(run.id, plan, 'https://demo.atlassian.net/wiki/brief');
    expect(first.epic).toMatchObject({
      status: 'created',
      key: 'AIPM-41',
      url: 'https://demo.atlassian.net/browse/AIPM-41',
    });
    expect(first.stories.map((s) => s.key)).toEqual(['AIPM-42', 'AIPM-43', 'AIPM-44', 'AIPM-45']);
    expect(first.links).toEqual({ created: 2, unchanged: 0, planned: 0 });

    const s1 = jira.issues.find((i) => i.key === 'AIPM-42')!.fields;
    expect(s1.parent).toEqual({ key: 'AIPM-41' });
    expect(s1.labels).toContain('ai-draft');
    expect(s1.priority).toEqual({ name: 'High' });
    expect(s1.customfield_10050).toBeGreaterThan(0);
    // No Story Points, no sprint: the team and the PO decide those.
    expect(Object.keys(s1).filter((k) => /sprint|story ?points/i.test(k))).toEqual([]);
    expect(jira.writes).toContain('link AIPM-43 Blocks AIPM-42'); // S-2 blocks S-1
    expect(jira.remoteLinks.size).toBe(1);

    const writes = jira.writes.length;
    const second = await writer.writeIssues(run.id, plan, 'https://demo.atlassian.net/wiki/brief');
    expect(jira.writes.length).toBe(writes);
    expect(jira.issues).toHaveLength(5);
    expect([second.epic, ...second.stories].every((r) => r.status === 'unchanged')).toBe(true);
    expect(second.links).toEqual({ created: 0, unchanged: 2, planned: 0 });
  });

  it('completes the draft Epic from intake instead of creating a second one', async () => {
    const { plan } = await planned();
    const jira = fakeJira();
    await jira.gateway.jira.createIssue({
      issuetype: { name: 'Epic' },
      summary: 'Draft',
      labels: ['ai-pm', 'ai-pm-draft', `aipm-run-${run.id}`],
    });
    const writer = createBacklogWriter({
      gateway: jira.gateway,
      store: memorySyncLog(),
      mode: 'live',
      jiraProjectKey: 'AIPM',
      siteUrl: 'https://demo.atlassian.net',
    });
    const result = await writer.writeIssues(run.id, plan, null);
    expect(result.epic).toMatchObject({ status: 'updated', key: 'AIPM-41' });
    expect(
      jira.issues.filter((i) => (i.fields.issuetype as { name: string } | undefined)?.name === 'Epic'),
    ).toHaveLength(1);
    expect(jira.issues.find((i) => i.key === 'AIPM-41')!.fields.labels).toContain('ai-draft');
  });

  it('turns a link that came out the wrong way round', async () => {
    const { plan } = await planned();
    const jira = fakeJira({ reversedLinks: true });
    const writer = createBacklogWriter({
      gateway: jira.gateway,
      store: memorySyncLog(),
      mode: 'live',
      jiraProjectKey: 'AIPM',
      siteUrl: 'https://demo.atlassian.net',
    });
    await writer.writeIssues(run.id, plan, null);
    const s1 = jira.issues.find((i) => i.key === 'AIPM-42')!;
    expect(s1.links.filter((l) => l.inward === 'AIPM-43')).toHaveLength(1); // S-1 is blocked by S-2
    const s2 = jira.issues.find((i) => i.key === 'AIPM-43')!;
    expect(s2.links.filter((l) => l.inward === 'AIPM-44')).toHaveLength(1); // S-2 is blocked by S-3
    // Only the first link was sent the wrong way; the second used what the first one taught.
    expect(jira.writes.filter((w) => w.startsWith('delete link'))).toEqual(['delete link 1']);
  });

  it('adds one block to the Initial Product Backlog page and keeps it on a re-run', async () => {
    const { plan } = await planned();
    const jira = fakeJira();
    const store = memorySyncLog();
    await store.save({
      idempotencyKey: 'confluence:page:seed:initial_backlog',
      system: 'confluence',
      entityType: 'page',
      externalId: '589827',
      lastAction: 'created',
    });
    const writer = createBacklogWriter({
      gateway: jira.gateway,
      store,
      mode: 'live',
      jiraProjectKey: 'AIPM',
      siteUrl: 'https://demo.atlassian.net',
    });
    const result = await writer.writeIssues(run.id, plan, null);
    const markdown = initialBacklogBlock('FA-3', plan, result, null);
    expect(markdown).toMatch(/\[AIPM-42\]\(https:\/\/demo\.atlassian\.net\/browse\/AIPM-42\)/);
    const first = await writer.writeInitialBacklog(run.id, 'aipm-fa-3', markdown);
    expect(first.status).toBe('updated');
    expect(jira.page.body.storage.value).toMatch(
      /^<p>Backlog<\/p>.*aipm-fa-3-start.*AIPM-41.*aipm-fa-3-end/s,
    );
    const again = await writer.writeInitialBacklog(run.id, 'aipm-fa-3', markdown);
    expect(again.status).toBe('unchanged');
    expect((jira.page.body.storage.value.match(/aipm-fa-3-start/g) ?? []).length).toBe(1);
  });
});

// ---- the stage --------------------------------------------------------------------------------

function stageSetup(assessment: Assessment) {
  const events: { event: RunEvent; key?: string }[] = [];
  const saved: unknown[] = [];
  let asks = 0;
  let stored: {
    inputHash: string;
    draft: unknown;
    writeMode: null;
    confluenceUrl: null;
    publishedAt: null;
  } | null = null;
  const jira = fakeJira();
  const docs = docsFor(assessment);
  const ctx = {
    run,
    executionId: 'x',
    repo: {
      answeredQuestionnaires: async () => docs.answered,
      latestStageOutput: async () => ({ elicitation: { epicSummary: docs.featureName } }),
    },
    baselineDigest: null,
    emit: async (event: RunEvent, key?: string) => void events.push({ event, key }),
  } as unknown as StageContext;
  const services = {
    ask: async <T>(_ctx: StageContext, agent: string) => {
      asks++;
      expect(agent).toBe('backlog-builder');
      return draft as T;
    },
    analysis: {
      assessmentOf: async () => assessment,
      analysisOf: async () => analysis,
      setEpicKey: async () => undefined,
    },
    context: {
      backlog: async () => '(the backlog is empty)',
      baselineData: async () => ({
        project_charter: { project: seed.project, financials: seed.kpis.financials },
        product_roadmap: seed.roadmap,
      }),
    },
    backlog: {
      repo: {
        setOf: async () => stored,
        saveDraft: async (_r: string, inputHash: string, d: unknown) => {
          stored = { inputHash, draft: d, writeMode: null, confluenceUrl: null, publishedAt: null };
        },
        saveWrite: async (_r: string, items: unknown) => void saved.push(items),
      },
      documents: {
        ensureSet: async () => ({
          faNumber: 3,
          inputHash: null,
          draft: null,
          writeMode: null,
          publishedAt: null,
        }),
        documentsOf: async () => [],
        recordsOf: async () => ({ assumptions: [], constraints: [], decisions: docs.decisions }),
        epicKeyOf: async () => null,
      },
      writer: createBacklogWriter({
        gateway: jira.gateway,
        store: memorySyncLog(),
        mode: 'live',
        jiraProjectKey: 'AIPM',
        siteUrl: 'https://demo.atlassian.net',
      }),
      republish: async () => null,
      builderVersion: 'v1',
    },
  };
  return {
    ctx,
    services: services as unknown as Parameters<typeof backlogStage>[0],
    events,
    saved,
    jira,
    asks: () => asks,
  };
}

describe('backlog stage', () => {
  it('writes the backlog, shows one card and a closing message, and completes the run', async () => {
    const s = stageSetup(await assessed());
    const outcome = await backlogStage(s.services)(s.ctx);
    expect(outcome.next).toBe('completed');
    expect(s.events.map((e) => e.key)).toEqual(['backlog.result', 'backlog.closing']);
    expect(s.events[0]!.event).toMatchObject({
      type: 'backlog_ready',
      epicKey: 'AIPM-41',
      stories: 4,
      mode: 'live',
    });
    const closing = s.events[1]!.event;
    expect(closing.type === 'message' && closing.text).toMatch(
      /Epic \*\*AIPM-41\*\* with 4 stories.*conversation is now closed/s,
    );
    expect(s.saved).toHaveLength(1);

    // A re-run reuses the draft (no second Claude call) and creates nothing new.
    await backlogStage(s.services)(s.ctx);
    expect(s.asks()).toBe(1);
    expect(s.jira.issues).toHaveLength(5);
  });

  it('stops before Jira when a requirement has no story', async () => {
    const a = await assessed();
    const uncovered = {
      ...a,
      storyMap: { ...a.storyMap, items: a.storyMap.items.filter((i) => i.ref !== 'S-3') },
    };
    const s = stageSetup(uncovered);
    await expect(backlogStage(s.services)(s.ctx)).rejects.toThrow(/no story covers REQ-NFR-001/);
    expect(s.jira.writes).toEqual([]);
    expect(s.asks()).toBe(0);
  });
});

describe('decision log', () => {
  const deps = {
    documents: { setOf: async () => null, epicKeyOf: async () => 'AIPM-9' },
    closeEpic: async () => 'changed' as const,
  } as unknown as Parameters<typeof recordDecision>[0];

  it('leaves an approval to the backlog stage', async () => {
    expect(await recordDecision(deps, run, 'approve')).toBeNull();
  });

  it('closes the draft Epic and the conversation on a decline', async () => {
    const text = await recordDecision(deps, run, 'decline');
    expect(text).toMatch(/The draft Epic AIPM-9 is closed/);
    expect(text).toMatch(/this conversation is now closed/);
  });
});
