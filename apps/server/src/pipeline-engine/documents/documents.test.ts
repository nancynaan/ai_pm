import { type Assessment, assessmentSchema } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import type { DocumentDraft } from '../../agents/schemas.js';
import type { AtlassianGateway } from '../../integrations/atlassian/index.js';
import { spliceBlock } from '../../sync/publisher.js';
import { memorySyncLog } from '../../sync/sync-log.js';
import { baselineImpact, needsRoadmapProposal } from '../calculators/baseline.js';
import { estimatingStage } from '../stages/estimating.js';
import { analysis, round1, run, seed, setupEstimating } from '../testing/fixtures.js';
import { buildFigures } from './figures.js';
import type { DocumentInputs } from './inputs.js';
import { writerPrompt } from './prompt.js';
import { createDocumentPublisher } from './publish.js';
import { renderDocuments } from './render.js';
import { loadTemplates } from './templates.js';
import { checkDraft, checkRendered, draftCheckContext, strayNumbers } from './validate.js';

const templates = loadTemplates();

async function assessed(): Promise<Assessment> {
  const { ctx, services, saved } = setupEstimating([round1({})]);
  await estimatingStage(services)(ctx);
  return assessmentSchema.parse(saved());
}

function inputsFor(assessment: Assessment, overrides: Partial<DocumentInputs> = {}): DocumentInputs {
  return {
    run: { id: run.id, title: run.title, description: run.description },
    faNumber: 3,
    featureName: 'Weekend tournament',
    epicKey: null,
    restatement: 'A weekend tournament with a ranking.',
    assessment,
    analysis,
    report: null,
    answered: [round1({})],
    assumptions: [
      {
        text: 'Players want to compete',
        kind: 'client_hypothesis',
        source: 'elicitation',
        owner: null,
        status: 'open',
      },
      {
        text: 'Server checks are possible',
        kind: 'open_issue',
        source: 'elicitation',
        owner: null,
        status: 'open',
      },
    ],
    constraints: [{ type: 'platform', text: 'iOS and Android' }],
    decisions: [
      { gate: 'discovery', decision: 'proceed', comment: null, decidedAt: '2026-11-05T10:00:00.000Z' },
    ],
    baseline: { projectName: seed.project.name, financials: seed.kpis.financials, roadmap: seed.roadmap },
    ...overrides,
  };
}

const prose = (text: string) => `${text} This sentence makes the slot long enough for the schema.`;

function draftFor(roadmapNeeded: boolean): DocumentDraft {
  return {
    brief: {
      problem: prose('Weekend sessions are short and the ranking motivates the top 10 % of players.'),
      objectives: prose('Longer weekend sessions, measured with {{figure:value.primary_kpi}}.'),
      expectedValue: prose(
        'The base case returns {{figure:value.base.roi}} with payback in {{figure:value.base.payback}}.',
      ),
      scope: prose('The MVP covers REQ-FR-001, REQ-FR-002 and REQ-NFR-001.'),
      impact: prose('The remaining budget falls to {{figure:baseline.remaining_after}}.'),
      recommendation: prose('Go ahead as recommended: {{figure:verdict}}.'),
    },
    requirements: {
      userFlows: [
        {
          name: 'Enter the tournament',
          steps: ['Open the event screen', 'Run and post a distance'],
          requirementCodes: ['REQ-FR-001'],
        },
      ],
      businessRules: [{ rule: 'The tournament runs Friday to Sunday.', requirementCodes: ['REQ-FR-001'] }],
      acceptanceCriteria: [
        {
          requirementCode: 'REQ-FR-001',
          criteria: ['Given Friday, when the player opens the menu, then the event is open.'],
        },
        { requirementCode: 'REQ-FR-002', criteria: ['Players are ranked by their best distance.'] },
        {
          requirementCode: 'REQ-NFR-001',
          criteria: ['The event screen keeps 30 FPS on the low-end device.'],
        },
      ],
    },
    estimation: {
      sequencing: prose('The spike on server checks comes first, then the leaderboard service.'),
      confidence: prose('The forecast is preliminary until the team re-estimates it.'),
    },
    roadmap: roadmapNeeded ? prose('The current release moves by {{figure:roadmap.delay}}.') : null,
  };
}

describe('baseline impact', () => {
  it('computes what is left of the approved budget after the feature', () => {
    expect(
      baselineImpact({ approvedBudgetUsd: 900_000, spentToDateUsd: 400_000, featureCostP85Usd: 125_000 }),
    ).toEqual({
      remainingUsd: 500_000,
      remainingAfterUsd: 375_000,
      shareOfRemaining: 0.25,
    });
    expect(
      baselineImpact({ approvedBudgetUsd: 1, spentToDateUsd: 1, featureCostP85Usd: 5 }).shareOfRemaining,
    ).toBeNull();
  });
});

describe('documents', () => {
  it('prints figures exactly as the assessment holds them', async () => {
    const a = await assessed();
    const figures = buildFigures(inputsFor(a));
    expect(figures['budget.total.p85']).toBe(`$${Math.round(a.budget.total.p85).toLocaleString('en-US')}`);
    expect(figures.fa).toBe('FA-3');
    expect(figures['forecast.full.date.p85']).toMatch(/^\d{1,2} \w+ \d{4}$/);
    expect(figures['requirements.mvp']).toBe('3');
  });

  it('renders every document with all slots filled, and the check finds nothing', async () => {
    const a = await assessed();
    const inputs = inputsFor(a);
    const needed = needsRoadmapProposal(a.roadmapImpact);
    const docs = renderDocuments(inputs, draftFor(needed), templates, {
      brief: null,
      riskRegister: 'https://demo.atlassian.net/wiki/pages/viewpage.action?pageId=9',
      assumptionLog: null,
    });
    expect(docs.map((d) => d.type)).toEqual([
      'feature_brief',
      'requirements',
      'estimation',
      'risk_register',
      'assumption_log',
      'roadmap_proposal',
    ]);
    expect(docs.find((d) => d.type === 'roadmap_proposal')!.needed).toBe(needed);
    expect(checkRendered(docs, inputs)).toEqual([]);

    const brief = docs[0]!;
    expect(brief.title).toBe('FA-3 Feature Brief: Weekend tournament');
    expect(brief.storage).toContain('ac:name="status"');
    expect(brief.storage).toContain('ac:name="children"');
    expect(brief.markdown).toContain(`**${a.verdict.label}**`);
    expect(brief.figures['budget.total.p85']).toBe(buildFigures(inputs)['budget.total.p85']);
    expect(docs[1]!.markdown).toContain('REQ-NFR-001');
    expect(docs[1]!.markdown).toContain('BR-01');
    expect(docs[3]!.markdown).toContain('FA3-R1'); // risk ids get the feature prefix on the shared register
    expect(docs[4]!.markdown).toContain('Discovery: proceed');
    // Text from agents can never act as a template slot.
    const injected = renderDocuments(
      inputsFor(a, { constraints: [{ type: 'other', text: 'Use {{figure:verdict}} here' }] }),
      draftFor(needed),
      templates,
      { brief: null, riskRegister: null, assumptionLog: null },
    );
    expect(injected[0]!.markdown).toContain('Use { {figure:verdict}} here');
  });

  it('writes a prompt with the figures by key and without the story-point sizes', async () => {
    const a = await assessed();
    const inputs = inputsFor(a);
    const prompt = writerPrompt(inputs, buildFigures(inputs), templates, false);
    expect(prompt).toContain(`- budget.total.p85 = ${buildFigures(inputs)['budget.total.p85']}`);
    expect(prompt).toContain('return `roadmap: null`');
    expect(prompt).not.toContain('Like the revive flow'); // estimator rationales stay out
  });

  it('rejects typed numbers, unknown figures and codes, and missing acceptance criteria', async () => {
    const a = await assessed();
    const inputs = inputsFor(a);
    const ctx = draftCheckContext(inputs, false);
    expect(checkDraft(draftFor(false), ctx)).toEqual([]);

    const bad = draftFor(false);
    bad.brief.impact = prose('The feature costs $12,400 and needs {{figure:budget.secret}}.');
    bad.requirements.acceptanceCriteria = [
      { requirementCode: 'REQ-FR-009', criteria: ['Something unknown is tested here.'] },
    ];
    bad.roadmap = prose('A proposal nobody asked for.');
    const problems = checkDraft(bad, ctx).join('\n');
    expect(problems).toContain('{{figure:budget.secret}} is not in the figure list');
    expect(problems).toContain('the numbers 12.400');
    expect(problems).toContain('Unknown requirement codes: REQ-FR-009');
    expect(problems).toContain('missing for the MVP requirements REQ-FR-001, REQ-FR-002, REQ-NFR-001');
    expect(problems).toContain('no proposal is needed');
  });

  it('allows identifiers, list markers and numbers the client or the requirements state', () => {
    const allowed = new Set(['30', '10']);
    expect(strayNumbers('REQ-FR-001 at P85, D7 retention, R-02 and FA3-R1', allowed)).toEqual([]);
    expect(strayNumbers('1. Open the menu\n2. Run', allowed)).toEqual([]);
    expect(strayNumbers('Keep 30 FPS for the top 10 %', allowed)).toEqual([]);
    expect(strayNumbers('It takes 3 sprints', allowed)).toEqual(['3']);
  });
});

describe('shared-page blocks', () => {
  it('appends the block once, replaces it on a re-run, and leaves the rest of the page alone', () => {
    const page = '<p>Baseline risks</p><table><tbody><tr><td>R-01</td></tr></tbody></table>';
    const first = spliceBlock(page, 'aipm-fa-3', '<h2>FA-3</h2><p>old</p>');
    expect(first.startsWith(page)).toBe(true);
    // Confluence adds macro ids to what we stored; the block is still found and replaced.
    const stored = first.replaceAll(
      'ac:name="anchor" ac:schema-version="1"',
      'ac:name="anchor" ac:schema-version="1" ac:macro-id="abc"',
    );
    const second = spliceBlock(stored, 'aipm-fa-3', '<h2>FA-3</h2><p>new</p>');
    expect(second).toContain('<p>new</p>');
    expect(second).not.toContain('<p>old</p>');
    expect(second.match(/aipm-fa-3-start/g)).toHaveLength(1);
    expect(spliceBlock(stored, 'aipm-fa-3', '<h2>FA-3</h2><p>old</p>')).toBe(stored); // unchanged
    expect(spliceBlock(second, 'aipm-fa-4', '<p>other</p>')).toContain('<p>new</p>'); // another feature appends
  });
});

// ---- publishing against a fake Confluence -----------------------------------------------------

interface FakePage {
  id: string;
  title: string;
  parentId?: string;
  version: { number: number };
  body: { storage: { value: string } };
}

function fakeConfluence() {
  const pages = new Map<string, FakePage>();
  const writes: string[] = [];
  let seq = 100;
  const add = (title: string, storage: string) => {
    const page = { id: String(++seq), title, version: { number: 1 }, body: { storage: { value: storage } } };
    pages.set(page.id, page);
    return page;
  };
  const gateway = {
    siteUrl: 'https://demo.atlassian.net',
    readOnly: false,
    confluence: {
      getSpaceByKey: async () => ({ id: 'space-1', key: 'AIPMconf', name: 'AI PM', homepageId: '1' }),
      getPage: async (id: string) => pages.get(id) ?? null,
      findPageByTitle: async (_space: string, title: string) =>
        [...pages.values()].find((p) => p.title === title) ?? null,
      createPage: async ({
        title,
        storage,
        parentId,
      }: {
        title: string;
        storage: string;
        parentId?: string;
      }) => {
        writes.push(`create ${title}`);
        return { ...add(title, storage), parentId };
      },
      updatePage: async (id: string, version: number, c: { title: string; storage: string }) => {
        writes.push(`update ${c.title}`);
        const page = {
          ...pages.get(id)!,
          title: c.title,
          version: { number: version },
          body: { storage: { value: c.storage } },
        };
        pages.set(id, page);
        return page;
      },
      addLabels: async () => undefined,
    },
  };
  return { gateway: gateway as unknown as AtlassianGateway, pages, writes, add };
}

async function publishSetup() {
  const a = await assessed();
  const inputs = inputsFor(a);
  const fake = fakeConfluence();
  const store = memorySyncLog();
  const risk = fake.add('Comet Run: Risk Register', '<p>Baseline risks</p>');
  const log = fake.add('Comet Run: Assumption Log', '<p>Baseline assumptions</p>');
  await store.save({
    idempotencyKey: 'confluence:page:seed:risk_register',
    system: 'confluence',
    entityType: 'page',
    externalId: risk.id,
    lastAction: 'created',
  });
  await store.save({
    idempotencyKey: 'confluence:page:seed:assumption_log',
    system: 'confluence',
    entityType: 'page',
    externalId: log.id,
    lastAction: 'created',
  });
  const draft = draftFor(needsRoadmapProposal(a.roadmapImpact));
  const render = (links: Parameters<typeof renderDocuments>[3]) =>
    renderDocuments(inputs, draft, templates, links);
  const publisher = (mode: 'dry-run' | 'live') =>
    createDocumentPublisher({
      gateway: fake.gateway,
      store,
      mode,
      siteUrl: 'https://demo.atlassian.net',
      jiraProjectKey: 'AIPM',
      spaceKey: 'AIPMconf',
    });
  return { a, inputs, fake, render, publisher, risk };
}

describe('publishing documents', () => {
  it('writes nothing in dry-run and reports what a live publish would do', async () => {
    const { inputs, fake, render, publisher } = await publishSetup();
    const { results } = await publisher('dry-run').publish(inputs, render);
    expect(fake.writes).toEqual([]);
    expect(results.find((r) => r.type === 'feature_brief')!.status).toBe('would_create');
    expect(results.find((r) => r.type === 'risk_register')!.status).toBe('would_update');
  });

  it('creates the pages once; a re-publish rewrites the same pages, also after an edit in Confluence', async () => {
    const { a, inputs, fake, render, publisher, risk } = await publishSetup();
    const first = await publisher('live').publish(inputs, render);
    const pagesAfterFirst = fake.pages.size;
    const brief = first.results.find((r) => r.type === 'feature_brief')!;
    expect(brief).toMatchObject({ status: 'created', version: 1 });
    expect(brief.url).toBe(`https://demo.atlassian.net/wiki/pages/viewpage.action?pageId=${brief.pageId}`);
    expect(fake.writes.filter((w) => w.startsWith('create'))).toEqual([
      'create Comet Run: Feature Assessments',
      'create FA-3 Feature Brief: Weekend tournament',
      'create FA-3 Requirements Specification',
      'create FA-3 Estimation & Release Forecast',
      ...(needsRoadmapProposal(a.roadmapImpact) ? ['create FA-3 Roadmap Update Proposal'] : []),
    ]);
    // The shared pages keep their content and get this feature's block, linking to the Brief.
    const riskPage = fake.pages.get(risk.id)!.body.storage.value;
    expect(riskPage.startsWith('<p>Baseline risks</p>')).toBe(true);
    expect(riskPage).toContain('FA3-R1');
    expect(riskPage).toContain(`pageId=${brief.pageId}`);

    // Unchanged → nothing new; someone edits the Brief in Confluence → the re-publish rewrites it.
    fake.writes.length = 0;
    const again = await publisher('live').publish(inputs, render);
    expect(fake.pages.size).toBe(pagesAfterFirst);
    expect(fake.writes).toEqual([]);
    expect(again.results.find((r) => r.type === 'feature_brief')!.status).toBe('unchanged');
    // Confluence rewrites stored markup; an unchanged block on an untouched page is not written again.
    const normalised = fake.pages.get(risk.id)!;
    fake.pages.set(risk.id, {
      ...normalised,
      body: { storage: { value: normalised.body.storage.value.replaceAll('<p>', '<p class="auto">') } },
    });
    const fourth = await publisher('live').publish(inputs, render);
    expect(fourth.results.find((r) => r.type === 'risk_register')!.status).toBe('unchanged');
    expect(fake.writes).toEqual([]);

    const page = fake.pages.get(brief.pageId!)!;
    fake.pages.set(page.id, {
      ...page,
      version: { number: 2 },
      body: { storage: { value: '<p>edited</p>' } },
    });
    const third = await publisher('live').publish(inputs, render);
    expect(fake.pages.size).toBe(pagesAfterFirst);
    expect(third.results.find((r) => r.type === 'feature_brief')).toMatchObject({
      status: 'updated',
      version: 3,
    });
    expect(fake.pages.get(page.id)!.body.storage.value).not.toBe('<p>edited</p>');
  });
});
