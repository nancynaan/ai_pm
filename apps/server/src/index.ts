import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyServerOptions } from 'fastify';
import { loadAgentDefinitions, loadSkill } from './agents/registry.js';
import { createAgentRunner } from './agents/runner.js';
import { AGENT_SCHEMAS } from './agents/schemas.js';
import { buildApp } from './app.js';
import { readBaselineSummary } from './baseline/store.js';
import { type AppConfig, atlassianCredentials, ConfigError, loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations, waitForDatabase } from './db/migrate.js';
import { createAnalysisRepository } from './pipeline-engine/analysis-repository.js';
import { createDocumentPublisher } from './pipeline-engine/documents/publish.js';
import { createDocumentRepository } from './pipeline-engine/documents/repository.js';
import { loadTemplates } from './pipeline-engine/documents/templates.js';
import { documentingStage } from './pipeline-engine/stages/documenting.js';
import { recordDecision, republishDocuments } from './pipeline-engine/documents/decision.js';
import { createBacklogRepository } from './pipeline-engine/backlog/repository.js';
import { createBacklogWriter } from './pipeline-engine/backlog/write.js';
import { backlogStage } from './pipeline-engine/stages/backlog.js';
import { createPresentationRepository } from './pipeline-engine/presentation/repository.js';
import { PPTX_TYPE, presentingStage } from './pipeline-engine/stages/presenting.js';
import { createPublisher } from './sync/publisher.js';
import { createContextBuilder } from './pipeline-engine/context.js';
import { createEventBus } from './pipeline-engine/events.js';
import { createPipelineEngine } from './pipeline-engine/engine.js';
import { createPgBossQueue } from './pipeline-engine/queue.js';
import { createRunRepository } from './pipeline-engine/repository.js';
import { createAgentAsker, createEpicDrafter, type StageServices } from './pipeline-engine/services.js';
import { analyzingStage } from './pipeline-engine/stages/analyzing.js';
import { loadAssessmentConfig } from './pipeline-engine/assessment-config.js';
import { loadDiscoveryConfig } from './pipeline-engine/discovery-config.js';
import { elicitingStage } from './pipeline-engine/stages/eliciting.js';
import { estimatingStage } from './pipeline-engine/stages/estimating.js';
import { intakeStage } from './pipeline-engine/stages/intake.js';
import { buildProbes } from './health/checks.js';
import { createAtlassianGateway } from './integrations/atlassian/index.js';
import { createClaudeCli } from './integrations/claude-cli.js';
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
  });

  const repo = createRunRepository(db);
  const analysis = createAnalysisRepository(db);
  const documentRepo = createDocumentRepository(db);
  const presentationRepo = createPresentationRepository(db);
  const backlogRepo = createBacklogRepository(db);
  const bus = createEventBus(repo);
  // Created after the database is ready; routes only receive requests after listen().
  const pipeline: { pipelineEngine?: ReturnType<typeof createPipelineEngine> } = {};
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
      assessments: analysis,
      documents: { repo: documentRepo, mode: config.atlassian.writeMode },
      presentations: presentationRepo,
      backlog: backlogRepo,
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
    // Validated at startup: a broken questionnaire config stops the app instead of a run.
    discovery: loadDiscoveryConfig(),
    assessment: loadAssessmentConfig(),
  };

  // Stage 04: the PM documents, published when the client presses the button.
  const templates = loadTemplates();
  const writer = definitions.get('pm-writer');
  if (!writer) throw new Error('agents/pm-writer.agent.md is missing');
  const documentServices = {
    repo: documentRepo,
    templates,
    publisher: createDocumentPublisher({
      gateway: stageGateway,
      store: drizzleSyncLog(db),
      mode: config.atlassian.writeMode,
      siteUrl: config.atlassian.siteUrl,
      jiraProjectKey: config.atlassian.jiraProjectKey,
      spaceKey: config.atlassian.confluenceSpaceKey,
    }),
    writerVersion: createHash('sha256')
      .update(JSON.stringify(writer))
      .update(writer.skills.map((name) => loadSkill(name).body).join('\n'))
      .update(JSON.stringify(templates))
      .digest('hex'),
  };

  // Stage 05: the three-slide client deck, its PPTX on the Feature Brief, and the decision gate.
  const presenter = definitions.get('presenter');
  if (!presenter) throw new Error('agents/presenter.agent.md is missing');
  const jiraPublisher = () =>
    stageGateway && config.atlassian.jiraProjectKey
      ? createPublisher({
          gateway: stageGateway,
          store: drizzleSyncLog(db),
          mode: config.atlassian.writeMode,
          jiraProjectKey: config.atlassian.jiraProjectKey,
        })
      : null;
  const presentationServices = {
    repo: presentationRepo,
    documents: documentRepo,
    autoApprove: config.pipeline.clientGateAutoApprove,
    presenterVersion: createHash('sha256')
      .update(JSON.stringify(presenter))
      .update(presenter.skills.map((name) => loadSkill(name).body).join('\n'))
      .digest('hex'),
    async attach(input: {
      runId: string;
      pageId: string;
      fileName: string;
      data: Uint8Array;
      contentHash: string;
    }) {
      const publisher = jiraPublisher();
      if (!publisher) return { status: 'skipped', url: null };
      const r = await publisher.upsertAttachment({
        key: `run:${input.runId}:deck`,
        pageId: input.pageId,
        fileName: input.fileName,
        data: input.data,
        contentType: PPTX_TYPE,
        contentHash: input.contentHash,
      });
      // Opens the Feature Brief with the deck's preview; before the first upload, the Brief itself.
      const attachmentId = r.externalId.startsWith('att') ? r.externalId.slice(3) : null;
      const brief = `${config.atlassian.siteUrl}/wiki/pages/viewpage.action?pageId=${input.pageId}`;
      const url = attachmentId
        ? `${brief}&preview=/${input.pageId}/${attachmentId}/${encodeURIComponent(input.fileName)}`
        : (r.url ?? null);
      return { status: r.action.replace(' ', '_'), url };
    },
  };

  // Stage 06: the approved feature's Epic and stories in Jira, and its block on the Initial Product Backlog.
  const builder = definitions.get('backlog-builder');
  if (!builder) throw new Error('agents/backlog-builder.agent.md is missing');
  const republishDeps = {
    analysis,
    context: services.context,
    repo,
    documents: documentRepo,
    publisher: documentServices.publisher,
    templates,
  };
  const backlogServices = {
    repo: backlogRepo,
    documents: documentRepo,
    writer: createBacklogWriter({
      gateway: stageGateway,
      store: drizzleSyncLog(db),
      mode: config.atlassian.writeMode,
      jiraProjectKey: config.atlassian.jiraProjectKey,
      siteUrl: config.atlassian.siteUrl,
    }),
    republish: (run: Parameters<typeof republishDocuments>[1]) => republishDocuments(republishDeps, run),
    builderVersion: createHash('sha256')
      .update(JSON.stringify(builder))
      .update(builder.skills.map((name) => loadSkill(name).body).join('\n'))
      .digest('hex'),
  };

  const pipelineEngine = createPipelineEngine({
    repo,
    bus,
    queue: createPgBossQueue(config.databaseUrl, (err) => app.log.error({ err }, 'job queue error')),
    pool,
    handlers: {
      intake: intakeStage(services),
      // eliciting = the discovery completeness check
      eliciting: elicitingStage(services),
      analyzing: analyzingStage(services),
      estimating: estimatingStage(services),
      documenting: documentingStage({ ...services, documents: documentServices }),
      presenting: presentingStage({ ...services, presentation: presentationServices }),
      backlog: backlogStage({ ...services, backlog: backlogServices }),
    },
    log: app.log,
    // The Decision Log: the decision goes to the Feature Brief and the Assumption Log block.
    onDecision: (run, decision) =>
      recordDecision(
        {
          ...republishDeps,
          closeEpic: (key) =>
            jiraPublisher()?.ensureStatus(key, 'done') ?? Promise.resolve('no transition' as const),
        },
        run,
        decision,
      ),
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
