import { describe, expect, it } from 'vitest';
import { buildDigest } from './digest.js';
import { averageVelocity, teamCostPerSprint } from './facts.js';
import { buildPages } from './pages.js';
import { renderPage } from './seed.js';
import { loadSeedData } from './seed-data.js';

const seed = loadSeedData();

describe('seed data', () => {
  it('loads and passes the cross-reference checks', () => {
    expect(seed.project.name).toBe('Comet Run');
    expect(seed.backlog.epics).toHaveLength(5);
    expect(seed.backlog.stories).toHaveLength(22);
    expect(seed.components.components).toHaveLength(14);
    expect(seed.pages.map((p) => p.type)).toContain('baseline_home');
  });

  it('matches the team cost and velocity agreed in the plan', () => {
    expect(teamCostPerSprint(seed.team)).toBe(38_600);
    expect(averageVelocity(seed.team)).toBeCloseTo(30.17, 2);
  });
});

describe('buildPages', () => {
  const pages = buildPages(seed, { issueKeys: new Map([['EP-CORE', 'AIPM-1']]) });

  it('fills every placeholder except the children macro', () => {
    for (const page of pages) {
      expect(page.markdown.replace('{{children}}', '')).not.toMatch(/\{\{/);
    }
  });

  it('prefixes titles with the game name and keeps them unique', () => {
    const titles = pages.map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toContain('Comet Run: Risk Register');
  });

  it('puts known Jira keys and computed totals into the tables', () => {
    const backlog = pages.find((p) => p.type === 'initial_backlog');
    expect(backlog?.markdown).toContain('| Core runner gameplay | AIPM-1 | Done | 5 | 26 / 26 |');
    const team = pages.find((p) => p.type === 'team_velocity');
    expect(team?.markdown).toContain('**$38,600**');
    expect(team?.markdown).toContain('**30.2 story points**');
  });

  it('renders to Confluence storage with the notice and the children macro', () => {
    const home = renderPage(pages.find((p) => p.type === 'baseline_home')!);
    expect(home.storage).toMatch(/^<ac:structured-macro ac:name="info"/);
    expect(home.storage).toContain('ac:name="children"');
    expect(home.storage).not.toContain('{{');
  });
});

describe('buildDigest', () => {
  it('is deterministic and contains the key planning numbers', () => {
    const digest = buildDigest(seed);
    expect(buildDigest(seed)).toBe(digest);
    expect(digest).toContain('6.5 FTE, $38,600 per sprint');
    expect(digest).toContain('Daily active users (DAU): 12,000 → 150,000');
    expect(digest).toContain('R-01 Retention below target after global launch (P3 × I5 = 15)');
    expect(digest).toContain('Physics & Movement (core)');
  });
});
