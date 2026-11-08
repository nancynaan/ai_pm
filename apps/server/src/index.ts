import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyServerOptions } from 'fastify';
import { buildApp } from './app.js';
import { readBaselineSummary } from './baseline/store.js';
import { type AppConfig, atlassianCredentials, ConfigError, loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations, waitForDatabase } from './db/migrate.js';
import { buildProbes } from './health/checks.js';
import { createAtlassianGateway } from './integrations/atlassian/index.js';
import { createClaudeCli } from './integrations/claude-cli.js';
import { createPipeline, createRepositories } from './pipeline.js';
import { createPgBossQueue } from './pipeline-engine/queue.js';

function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    // Secrets never reach the logs, also if a config or env object is logged by mistake.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.apiToken',
        '*.authorization',
        '*.ATLASSIAN_API_TOKEN',
        '*.CLAUDE_CODE_OAUTH_TOKEN',
        '*.POSTGRES_PASSWORD',
        '*.atlassian.apiToken',
        '*.databaseUrl',
      ],
      censor: '[redacted]',
    },
    ...(config.env === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}

async function main() {
  const config = loadConfig();
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

  const { db, pool } = createDb(config.databaseUrl);
  const credentials = atlassianCredentials(config);
  const claude = createClaudeCli({ cliPath: config.claude.cliPath });
  const probes = buildProbes({
    config,
    query: (sql) => pool.query(sql),
    atlassian: credentials && createAtlassianGateway(credentials),
    claude,
    claudeToken: process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || undefined,
  });

  const repos = createRepositories(db);
  const { repo, bus } = repos;
  // Created after the database is ready; routes only receive requests after listen().
  const pipeline: { pipelineEngine?: ReturnType<typeof createPipeline> } = {};
  const app = await buildApp({
    logger: loggerOptions(config),
    probes,
    version: pkg.version,
    baseline: () => readBaselineSummary(db, config),
    runs: {
      get pipelineEngine() {
        if (!pipeline.pipelineEngine) throw new Error('The pipeline is still starting');
        return pipeline.pipelineEngine;
      },
      repo,
      bus,
      assessments: repos.analysis,
      documents: { repo: repos.documents, mode: config.atlassian.writeMode },
      presentations: repos.presentations,
      backlog: repos.backlog,
    },
    webDistDir: existsSync(webDistDir) ? webDistDir : undefined,
  });

  await waitForDatabase(pool, app.log);
  await runMigrations(db);
  app.log.info('database migrations applied');

  // In dry-run the gateway refuses every write as a second safety net.
  const stageGateway =
    credentials &&
    createAtlassianGateway(credentials, { readOnly: config.atlassian.writeMode === 'dry-run' });
  const pipelineEngine = createPipeline({
    config,
    db,
    pool,
    repos,
    gateway: stageGateway,
    claude,
    queue: createPgBossQueue(config.databaseUrl, (err) => app.log.error({ err }, 'job queue error')),
    log: app.log,
  });
  pipeline.pipelineEngine = pipelineEngine;
  await pipelineEngine.start();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await pipelineEngine.stop();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: config.port });
  app.log.info(
    {
      atlassian: credentials ? config.atlassian.siteUrl : 'not configured',
      writeMode: config.atlassian.writeMode,
      claude: `${config.claude.cliPath} (${config.claude.model})`,
    },
    `AI PM server ${pkg.version} ready at ${config.baseUrl}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
