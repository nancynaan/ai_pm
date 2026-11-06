import { type Assessment, assessmentSchema, deckSchema } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import type { DeckDraft } from '../../agents/schemas.js';
import type { AtlassianGateway } from '../../integrations/atlassian/index.js';
import { deckToPptx } from '../../render/pptx.js';
import { createPublisher } from '../../sync/publisher.js';
import { memorySyncLog } from '../../sync/sync-log.js';
import { kpiAfterChange } from '../calculators/baseline.js';
import { estimatingStage } from '../stages/estimating.js';
import { analysis, round1, run, seed, setupEstimating } from '../testing/fixtures.js';
import { buildDeck, compactUsd, type DeckInputs, deckFacts, presenterPrompt, shortDate } from './deck.js';
import { nextVersion } from './repository.js';
import { checkDeckDraft, deckCheckContext } from './validate.js';

async function deckInputs(overrides: Partial<Assessment['inputs']> = {}): Promise<DeckInputs> {
  const { ctx, services, saved } = setupEstimating([round1({})]);
  await estimatingStage(services)(ctx);
  const a = assessmentSchema.parse(saved());
  return {
    run: { id: run.id, title: run.title, description: run.description },
    faNumber: 3,
    featureName: 'Weekend tournament',
    epicKey: null,
    restatement: null,
    assessment: { ...a, inputs: { ...a.inputs, ...overrides } },
    analysis,
    report: null,
    answered: [round1({})],
    assumptions: [],
    constraints: [],
    decisions: [],
    baseline: { projectName: seed.project.name, financials: seed.kpis.financials, roadmap: seed.roadmap },
    kpis: seed.kpis.metrics,
  };
}

const draft = (overrides: Partial<DeckDraft['feasibility']> = {}): DeckDraft => ({
  opportunity: {
    heading: 'Weekends become the busiest time of the week',
    objective: 'Longer weekend sessions from competitive players',
    audience: 'Active players who like to compete',
  },
  solution: {
    heading: 'A weekend ranking players understand at a glance',
    flow: ['Open the event', 'Run', 'Post a distance', 'Collect a reward'],
    capabilities: [
      {
        title: 'Weekend schedule',
        detail: 'Opens on Friday, closes on Sunday',
        requirementCodes: ['REQ-FR-001'],
      },
      { title: 'Global ranking', detail: 'Best distance ranks players', requirementCodes: ['REQ-FR-002'] },
      { title: 'Smooth play', detail: 'Runs at 30 FPS on low-end phones', requirementCodes: ['REQ-NFR-001'] },
      { title: 'Rewards', detail: 'Top players get a trail effect', requirementCodes: ['REQ-FR-002'] },
    ],
    boundary: 'Paid entries and revives in ranked play',
  },
  feasibility: {
    heading: 'Feasible within the next release window',
    dependencies: ['Leaderboard API'],
    recommendation:
      'The feature is feasible subject to validation of the leaderboard dependency and team capacity.',
    ...overrides,
  },
});

describe('client deck', () => {
  it('computes KPI values after a change by unit', () => {
    expect(kpiAfterChange(2.1, 12, '%')).toBeCloseTo(2.352);
    expect(kpiAfterChange(0.14, 0.5, 'pts')).toBeCloseTo(0.145);
    expect(kpiAfterChange(7.5, 0.4, 'min')).toBeCloseTo(7.9);
    expect(nextVersion(null)).toBe('1.0');
    expect(nextVersion('1.0')).toBe('1.1');
    expect(compactUsd(119_660)).toBe('$120k');
    expect(shortDate('2027-01-24')).toBe('24 Jan 2027');
  });

  it('shows calendar and money ranges, never story points, and labels the deck as preliminary', async () => {
    const inputs = await deckInputs();
    const a = inputs.assessment;
    const deck = deckSchema.parse(buildDeck(inputs, draft(), '1.0', new Date('2026-11-06T10:00:00Z')));
    expect(deck.label).toBe('Feature Proposal · Weekend tournament · Version 1.0');
    expect(deck.disclaimer).toMatch(/not a delivery commitment/);
    expect(deck.feasibility.budget.range).toBe(
      `${compactUsd(a.budget.total.p50)} – ${compactUsd(a.budget.total.p85)}`,
    );
    expect(deck.feasibility.delivery.detail).toMatch(/not a commitment/);
    expect(deck.feasibility.budget.detail).toMatch(/^Preliminary/);
    expect(JSON.stringify(deck)).not.toMatch(/story[\s-]*points?|\bpoints\b/i);
    // The KPI chart: today, then the three scenarios.
    expect(deck.opportunity.chart.bars.map((b) => b.label)).toEqual([
      'Today',
      'Pessimistic',
      'Base',
      'Optimistic',
    ]);
    expect(deck.opportunity.chart.kpi).toBe('Average session length');
    expect(deck.solution.counts.find((c) => c.label === 'functional requirements')?.value).toBe(2);
    expect(deck.solution.counts.find((c) => c.label === 'user stories proposed')?.value).toBe(2);
    expect(deck.feasibility.risks.items[0]?.title).toBe('Cheated distances');
    expect(presenterPrompt(inputs)).not.toMatch(/Like the revive flow|O\/M\/P/);
    // The verdict badge already names the verdict; the sentence does not repeat it.
    const repeated = buildDeck(
      inputs,
      draft({ recommendation: 'Go: build it as scoped, with the team re-estimating first.' }),
      '1.0',
      new Date(),
    );
    expect(repeated.feasibility.verdict.sentence).toBe(
      'build it as scoped, with the team re-estimating first.',
    );
  });

  it('marks a retention effect without strong evidence as a hypothesis', async () => {
    const weak = deckFacts(await deckInputs({ evidence: 'weak' }));
    expect(weak.caution).toMatch(/hypothesis/i); // the base scenario changes D7 retention
    const ctx = deckCheckContext(await deckInputs({ evidence: 'weak' }));
    const promise = draft();
    promise.opportunity.heading = 'The tournament will lift retention';
    expect(checkDeckDraft(promise, ctx).join()).toContain('hypothesis to validate');
    promise.opportunity.heading = 'Expected to support retention, to be validated after release';
    expect(checkDeckDraft(promise, ctx)).toEqual([]);
  });

  it('rejects numbers, story points, unknown codes, invented dependencies and a verdict mismatch', async () => {
    const ctx = deckCheckContext(await deckInputs({ evidence: 'strong' }));
    expect(checkDeckDraft(draft(), ctx)).toEqual([]);
    const bad = draft({
      dependencies: ['Leaderboard API', 'Payments', 'Store review'],
      recommendation: 'Do not proceed: 21 story points take 3 sprints.',
    });
    bad.solution.capabilities[0]!.requirementCodes = ['REQ-FR-099'];
    const problems = checkDeckDraft(bad, { ...ctx, decision: 'go' }).join('\n');
    expect(problems).toContain('remove the numbers 21, 3');
    expect(problems).toContain('never mention story points');
    expect(problems).toContain('Unknown requirement codes: REQ-FR-099');
    expect(problems).toContain('found only 1');
    expect(problems).toContain('the verdict is Go');
    expect(checkDeckDraft(draft(), { ...ctx, decision: 'no_go' }).join()).toContain('No-Go');
  });

  it('renders the three slides as a PPTX', async () => {
    const deck = buildDeck(await deckInputs(), draft(), '1.0', new Date());
    const file = await deckToPptx(deck);
    expect(file.subarray(0, 2).toString()).toBe('PK'); // a zip container
    const names = file.toString('latin1');
    expect(names).toContain('ppt/slides/slide3.xml');
    expect(names).not.toContain('ppt/slides/slide4.xml');
    expect(names).toContain('ppt/charts/chart'); // the KPI chart is a native chart
  });
});

describe('PPTX attachment', () => {
  function fakeAttachments() {
    const files = new Map<string, { id: string; title: string; version: { number: number } }>();
    const writes: string[] = [];
    let seq = 0;
    const gateway = {
      siteUrl: 'https://demo.atlassian.net',
      confluence: {
        findAttachment: async (_page: string, name: string) => files.get(name) ?? null,
        uploadAttachment: async (
          _page: string,
          name: string,
          _d: Uint8Array,
          _t: string,
          existingId?: string,
        ) => {
          writes.push(existingId ? `update ${name}` : `create ${name}`);
          const prev = files.get(name);
          const file = {
            id: prev?.id ?? String(++seq),
            title: name,
            version: { number: (prev?.version.number ?? 0) + 1 },
          };
          files.set(name, file);
          return file;
        },
      },
    } as unknown as AtlassianGateway;
    return { gateway, files, writes };
  }

  it('creates the attachment once, skips an unchanged deck and versions a changed one', async () => {
    const fake = fakeAttachments();
    const store = memorySyncLog();
    const input = {
      key: 'run:1:deck',
      pageId: '42',
      fileName: 'FA-1 Feature Proposal.pptx',
      data: new Uint8Array([1]),
      contentType: 'x',
    };
    const dry = createPublisher({ gateway: fake.gateway, store, mode: 'dry-run', jiraProjectKey: 'AIPM' });
    expect((await dry.upsertAttachment({ ...input, contentHash: 'a' })).action).toBe('would create');
    const live = createPublisher({ gateway: fake.gateway, store, mode: 'live', jiraProjectKey: 'AIPM' });
    expect((await live.upsertAttachment({ ...input, contentHash: 'a' })).action).toBe('created');
    expect((await live.upsertAttachment({ ...input, contentHash: 'a' })).action).toBe('unchanged');
    const changed = await live.upsertAttachment({ ...input, contentHash: 'b' });
    expect(changed).toMatchObject({ action: 'updated', version: 2 });
    expect(fake.files.size).toBe(1);
    expect(fake.writes).toEqual(['create FA-1 Feature Proposal.pptx', 'update FA-1 Feature Proposal.pptx']);
  });
});
