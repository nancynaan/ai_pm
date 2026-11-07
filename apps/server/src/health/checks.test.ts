import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import type { AtlassianGateway } from '../integrations/atlassian/index.js';
import type { JiraProject } from '../integrations/atlassian/jira.js';
import { buildProbes, type ProbeDeps } from './checks.js';
import { runProbe } from './probe.js';

const claudeCli = (loggedIn: boolean, authMethod = loggedIn ? 'oauth_token' : 'none') => ({
  version: async () => '2.1.316',
  authStatus: async () => ({ loggedIn, authMethod }),
});

const baseDeps = (overrides: Partial<ProbeDeps> = {}): ProbeDeps => ({
  config: loadConfig({ JIRA_PROJECT_KEY: 'ERG', CONFLUENCE_SPACE_KEY: 'ERG' }),
  query: async () => ({ rows: [{ n: 1 }] }),
  claude: claudeCli(false),
  ...overrides,
});

function fakeAtlassian(project: Partial<JiraProject>, boards: { id: number; name: string; type: string }[]) {
  return {
    jira: {
      getMyself: async () => ({ accountId: 'a1', displayName: 'Demo PM' }),
      getProject: async () => ({
        id: '1',
        key: 'ERG',
        name: 'Endless Runner',
        projectTypeKey: 'software',
        style: 'classic',
        ...project,
      }),
    },
    agile: { findBoards: async () => boards },
    confluence: { getSpaceByKey: async () => ({ id: '9', key: 'ERG', name: 'Endless Runner' }) },
  } as unknown as AtlassianGateway;
}

async function check(name: string, deps: ProbeDeps) {
  const probe = buildProbes(deps).find((p) => p.name === name);
  if (!probe) throw new Error(`no probe ${name}`);
  return runProbe(probe, 1000);
}

describe('health probes', () => {
  it('reports missing credentials as not configured', async () => {
    expect((await check('jira', baseDeps())).status).toBe('not_configured');
    const claude = await check('claude', baseDeps());
    expect(claude.status).toBe('not_configured');
    expect(claude.detail).toContain('claude setup-token');
  });

  it('accepts a signed-in Claude Code CLI', async () => {
    const result = await check('claude', baseDeps({ claude: claudeCli(true) }));
    expect(result).toMatchObject({ status: 'ok' });
    expect(result.detail).toBe('Claude Code 2.1.316, signed in (oauth_token); agents use claude-opus-5-5');
  });

  it('flags a token that cannot come from claude setup-token', async () => {
    const bad = await check('claude', baseDeps({ claude: claudeCli(true), claudeToken: 'L3L7-not-a-token' }));
    expect(bad).toMatchObject({ status: 'error' });
    expect(bad.detail).toContain('sk-ant-oat01-');
    const good = await check(
      'claude',
      baseDeps({ claude: claudeCli(true), claudeToken: 'sk-ant-oat01-abc' }),
    );
    expect(good.status).toBe('ok');
  });

  it('reports a missing Claude Code CLI as an error', async () => {
    const missing = {
      version: () => Promise.reject(new Error('Claude Code CLI not found at "claude"')),
      authStatus: async () => ({ loggedIn: false, authMethod: 'none' }),
    };
    expect(await check('claude', baseDeps({ claude: missing }))).toMatchObject({
      status: 'error',
      detail: 'Claude Code CLI not found at "claude"',
    });
  });

  it('accepts a company-managed project with a Scrum board', async () => {
    const result = await check(
      'jira_project',
      baseDeps({ atlassian: fakeAtlassian({}, [{ id: 3, name: 'ERG board', type: 'scrum' }]) }),
    );
    expect(result.status).toBe('ok');
    expect(result.detail).toContain('Scrum board "ERG board" #3');
  });

  it('flags a team-managed project', async () => {
    const atlassian = fakeAtlassian({ style: 'next-gen' }, [{ id: 3, name: 'ERG board', type: 'scrum' }]);
    const result = await check('jira_project', baseDeps({ atlassian }));
    expect(result).toMatchObject({ status: 'error' });
    expect(result.detail).toContain('team-managed');
  });

  it('flags a project without a Scrum board', async () => {
    const atlassian = fakeAtlassian({}, [{ id: 4, name: 'Kanban', type: 'kanban' }]);
    expect((await check('jira_project', baseDeps({ atlassian }))).detail).toContain('no Scrum board');
  });

  it('turns a thrown error into an error result', async () => {
    const result = await check(
      'database',
      baseDeps({ query: async () => Promise.reject(new Error('ECONNREFUSED')) }),
    );
    expect(result).toMatchObject({ status: 'error', detail: 'ECONNREFUSED' });
  });

  it('times out a hanging probe', async () => {
    const result = await runProbe({ name: 'slow', label: 'Slow', run: () => new Promise(() => {}) }, 20);
    expect(result).toMatchObject({ status: 'error', detail: 'timed out after 20 ms' });
  });
});
