import { describe, expect, it } from 'vitest';
import { atlassianCredentials, ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults when only the database password is set', () => {
    const config = loadConfig({ POSTGRES_PASSWORD: 'secret' });
    expect(config.port).toBe(3000);
    expect(config.claude).toEqual({ cliPath: 'claude', model: 'claude-opus-5-5' });
    expect(config.atlassian.writeMode).toBe('dry-run');
    expect(config.pipeline.clientGateAutoApprove).toBe(false);
    expect(config.databaseUrl).toBe('postgres://aipm:secret@localhost:5432/aipm');
  });

  it('treats empty values as not set', () => {
    const config = loadConfig({
      ATLASSIAN_SITE_URL: '',
      ATLASSIAN_API_TOKEN: '  ',
      JIRA_BOARD_ID: '',
      SMTP_HOST: '',
    });
    expect(config.atlassian.siteUrl).toBeUndefined();
    expect(config.atlassian.apiToken).toBeUndefined();
    expect(config.atlassian.jiraBoardId).toBeUndefined();
    expect(config.smtp.usingMailpit).toBe(true);
    expect(atlassianCredentials(config)).toBeUndefined();
  });

  it('uses Mailpit unless an SMTP host is set', () => {
    expect(loadConfig({ MAILPIT_HOST: 'mailpit' }).smtp).toMatchObject({
      host: 'mailpit',
      usingMailpit: true,
    });
    expect(loadConfig({ SMTP_HOST: 'smtp.example.com' }).smtp).toMatchObject({
      host: 'smtp.example.com',
      usingMailpit: false,
    });
  });

  it('returns Atlassian credentials once all three values are present', () => {
    const config = loadConfig({
      ATLASSIAN_SITE_URL: 'https://demo.atlassian.net/',
      ATLASSIAN_EMAIL: 'pm@example.com',
      ATLASSIAN_API_TOKEN: 'token',
    });
    expect(atlassianCredentials(config)).toEqual({
      siteUrl: 'https://demo.atlassian.net',
      email: 'pm@example.com',
      apiToken: 'token',
    });
  });

  it('parses boolean flags and prefers an explicit DATABASE_URL', () => {
    const config = loadConfig({ CLIENT_GATE_AUTO_APPROVE: 'true', DATABASE_URL: 'postgres://u:p@db:5432/x' });
    expect(config.pipeline.clientGateAutoApprove).toBe(true);
    expect(config.databaseUrl).toBe('postgres://u:p@db:5432/x');
  });

  it('rejects invalid values with a readable error', () => {
    expect(() => loadConfig({ ATLASSIAN_WRITE_MODE: 'yolo' })).toThrow(ConfigError);
    expect(() => loadConfig({ ATLASSIAN_SITE_URL: 'not a url' })).toThrow(/ATLASSIAN_SITE_URL/);
  });
});
