import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyServerOptions } from 'fastify';
import { loadAgentDefinitions } from './agents/registry.js';
import { createAgentRunner } from './agents/runner.js';
import { AGENT_SCHEMAS } from './agents/schemas.js';
import { buildApp } from './app.js';
import { readBaselineSummary } from './baseline/store.js';
import { type AppConfig, atlassianCredentials, ConfigError, loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations, waitForDatabase } from './db/migrate.js';
import { createAnalysisRepository } from './harness/analysis-repository.js';
import { createContextBuilder } from './harness/context.js';
import { createEventBus } from './harness/events.js';
import { createOrchestrator } from './harness/orchestrator.js';
import { createPgBossQueue } from './harness/queue.js';
import { createRunRepository } from './harness/repository.js';
import { createAgentAsker, createEpicDrafter, type StageServices } from './harness/services.js';
import { analyzingStage } from './harness/stages/analyzing.js';
import { elicitingStage } from './harness/stages/eliciting.js';
import { intakeStage } from './harness/stages/intake.js';
import { placeholderStages } from './harness/stages/placeholder.js';
import { buildProbes } from './health/checks.js';
import { createAtlassianGateway } from './integrations/atlassian/index.js';
import { createClaudeCli } from './integrations/claude-cli.js';
import { createMailer } from './integrations/mailer.js';
import { drizzleSyncLog } from './sync/sync-log.js';

function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
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
    mailer: createMailer(config.smtp),
  });

  const repo = createRunRepository(db);
  const bus = createEventBus(repo);
  // Created after the database is ready; routes only receive requests after listen().
  const pipeline: { orchestrator?: ReturnType<typeof createOrchestrator> } = {};
  const app = await buildApp({
    logger: loggerOptions(config),
    probes,
    version: pkg.version,
    baseline: () => readBaselineSummary(db, config),
    runs: {
      get orchestrator() {
        if (!pipeline.orchestrator) throw new Error('The pipeline is still starting');
        return pipeline.orchestrator;
      },
      repo,
      bus,
    },
    webDistDir: existsSync(webDistDir) ? webDistDir : undefined,
  });

  await waitForDatabase(pool, app.log);
  await runMigrations(db);
  app.log.info('database migrations applied');

  // Real stages (Phase 3+); in dry-run the gateway refuses every write as a second safety net.
  const stageGateway =
    credentials &&
    createAtlassianGateway(credentials, { readOnly: config.atlassian.writeMode === 'dry-run' });
  const analysis = createAnalysisRepository(db);
  const definitions = loadAgentDefinitions();
  app.log.info({ agents: [...definitions.keys()] }, 'agent definitions loaded');
  const services: StageServices = {
    ask: createAgentAsker({
      runner: createAgentRunner({ claude }),
      definitions,
      schemas: AGENT_SCHEMAS,
      defaultModel: config.claude.model,
    }),
    createDraftEpic: createEpicDrafter({
      config,
      atlassian: stageGateway,
      store: drizzleSyncLog(db),
      analysis,
    }),
    analysis,
    context: createContextBuilder({
      db,
      atlassian: stageGateway,
      jiraProjectKey: config.atlassian.jiraProjectKey,
    }),
  };

  const orchestrator = createOrchestrator({
    repo,
    bus,
    queue: createPgBossQueue(config.databaseUrl, (err) => app.log.error({ err }, 'job queue error')),
    pool,
    handlers: {
      ...placeholderStages({
        delayMs: config.pipeline.placeholderDelayMs,
        autoApprove: config.pipeline.clientGateAutoApprove,
      }),
      intake: intakeStage(services),
      eliciting: elicitingStage(services),
      analyzing: analyzingStage(services),
    },
    log: app.log,
  });
  pipeline.orchestrator = orchestrator;
  await orchestrator.start();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await orchestrator.stop();
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
      smtp: config.smtp.usingMailpit ? 'mailpit' : config.smtp.host,
    },
    `AI PM server ${pkg.version} ready at ${config.baseUrl}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
