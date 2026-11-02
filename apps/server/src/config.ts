import { z } from 'zod';
import { databaseUrlFromEnv } from './db/url.js';

// An empty value in .env means "not set".
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(blank, z.string().trim().optional());
const flag = (fallback: boolean) => z.preprocess(blank, z.stringbool().default(fallback));

const envSchema = z.object({
  NODE_ENV: z.preprocess(blank, z.enum(['development', 'test', 'production']).default('development')),
  LOG_LEVEL: z.preprocess(
    blank,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ),
  APP_PORT: z.preprocess(blank, z.coerce.number().int().positive().default(3000)),
  APP_BASE_URL: z.preprocess(blank, z.url().default('http://localhost:3000')),

  // The CLI reads CLAUDE_CODE_OAUTH_TOKEN itself, so it is not part of the config object.
  CLAUDE_CLI_PATH: z.preprocess(blank, z.string().default('claude')),
  CLAUDE_MODEL: z.preprocess(blank, z.string().default('claude-opus-5-5')),

  ATLASSIAN_SITE_URL: z.preprocess(blank, z.url().optional()),
  ATLASSIAN_EMAIL: optionalString,
  ATLASSIAN_API_TOKEN: optionalString,
  JIRA_PROJECT_KEY: optionalString,
  JIRA_BOARD_ID: z.preprocess(blank, z.coerce.number().int().positive().optional()),
  CONFLUENCE_SPACE_KEY: optionalString,
  ATLASSIAN_WRITE_MODE: z.preprocess(blank, z.enum(['dry-run', 'live']).default('dry-run')),

  CLIENT_GATE_AUTO_APPROVE: flag(false),

  SMTP_HOST: optionalString,
  MAILPIT_HOST: z.preprocess(blank, z.string().default('localhost')),
  SMTP_PORT: z.preprocess(blank, z.coerce.number().int().positive().default(1025)),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_SECURE: flag(false),
  NOTIFY_FROM: z.preprocess(blank, z.string().default('ai-pm@localhost')),
});

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];
export type WriteMode = z.infer<typeof envSchema>['ATLASSIAN_WRITE_MODE'];

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  logLevel: LogLevel;
  port: number;
  baseUrl: string;
  databaseUrl: string;
  /** Claude Code CLI on the user's Claude subscription. */
  claude: { cliPath: string; model: string };
  atlassian: {
    siteUrl?: string;
    email?: string;
    apiToken?: string;
    jiraProjectKey?: string;
    jiraBoardId?: number;
    confluenceSpaceKey?: string;
    writeMode: WriteMode;
  };
  pipeline: { clientGateAutoApprove: boolean };
  /** With no SMTP_HOST set, email goes to the local Mailpit inbox. */
  smtp: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    secure: boolean;
    from: string;
    usingMailpit: boolean;
  };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration in .env:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    port: e.APP_PORT,
    baseUrl: e.APP_BASE_URL,
    databaseUrl: databaseUrlFromEnv(env),
    claude: { cliPath: e.CLAUDE_CLI_PATH, model: e.CLAUDE_MODEL },
    atlassian: {
      siteUrl: e.ATLASSIAN_SITE_URL?.replace(/\/+$/, ''),
      email: e.ATLASSIAN_EMAIL,
      apiToken: e.ATLASSIAN_API_TOKEN,
      jiraProjectKey: e.JIRA_PROJECT_KEY,
      jiraBoardId: e.JIRA_BOARD_ID,
      confluenceSpaceKey: e.CONFLUENCE_SPACE_KEY,
      writeMode: e.ATLASSIAN_WRITE_MODE,
    },
    pipeline: { clientGateAutoApprove: e.CLIENT_GATE_AUTO_APPROVE },
    smtp: {
      host: e.SMTP_HOST ?? e.MAILPIT_HOST,
      port: e.SMTP_PORT,
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
      secure: e.SMTP_SECURE,
      from: e.NOTIFY_FROM,
      usingMailpit: e.SMTP_HOST === undefined,
    },
  };
}

/** Atlassian credentials, or undefined while any of the three values is missing. */
export function atlassianCredentials(config: AppConfig) {
  const { siteUrl, email, apiToken } = config.atlassian;
  return siteUrl && email && apiToken ? { siteUrl, email, apiToken } : undefined;
}
