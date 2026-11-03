import { describe, expect, it, vi } from 'vitest';
import { createClaudeCli, type Exec } from './claude-cli.js';

describe('createClaudeCli', () => {
  it('reads the version number', async () => {
    const exec = vi.fn<Exec>(async () => ({ stdout: '2.1.316 (Claude Code)\n', stderr: '', exitCode: 0 }));
    const cli = createClaudeCli({ cliPath: 'claude', exec });

    await expect(cli.version()).resolves.toBe('2.1.316');
    expect(exec).toHaveBeenCalledWith('claude', ['--version'], expect.anything());
  });

  it('parses the auth status even when the CLI exits non-zero (signed out)', async () => {
    const stdout = JSON.stringify({
      loggedIn: false,
      authMethod: 'none',
      configDirectory: '/home/node/.claude',
    });
    const cli = createClaudeCli({
      cliPath: 'claude',
      exec: async () => ({ stdout, stderr: '', exitCode: 1 }),
    });

    await expect(cli.authStatus()).resolves.toEqual({ loggedIn: false, authMethod: 'none' });
  });

  it('drops an empty CLAUDE_CODE_OAUTH_TOKEN so the CLI falls back to its own login', async () => {
    const exec = vi.fn<Exec>(async () => ({
      stdout: '{"loggedIn":true,"authMethod":"claude.ai"}',
      stderr: '',
      exitCode: 0,
    }));
    const cli = createClaudeCli({
      cliPath: 'claude',
      exec,
      env: { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: '' },
    });

    await cli.authStatus();
    expect(exec.mock.calls[0]?.[2].env).toEqual({ PATH: '/bin' });
  });

  it('passes a real token through to the CLI', async () => {
    const exec = vi.fn<Exec>(async () => ({
      stdout: '{"loggedIn":true,"authMethod":"oauth_token"}',
      stderr: '',
      exitCode: 0,
    }));
    const cli = createClaudeCli({ cliPath: 'claude', exec, env: { CLAUDE_CODE_OAUTH_TOKEN: 'tok' } });

    await cli.authStatus();
    expect(exec.mock.calls[0]?.[2].env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok');
  });
});
