import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { Cassette } from './agents/cassette.js';
import { loadAgentDefinitions, loadSkill } from './agents/registry.js';
import { createAgentRunner } from './agents/runner.js';
import { AGENT_SCHEMAS } from './agents/schemas.js';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import type { AtlassianGateway } from './integrations/atlassian/index.js';
import type { ClaudeCli } from './integrations/claude-cli.js';
import { createAnalysisRepository } from './pipeline-engine/analysis-repository.js';
import { loadAssessmentConfig } from './pipeline-engine/assessment-config.js';
import { createBacklogRepository } from './pipeline-engine/backlog/repository.js';
import { createBacklogWriter } from './pipeline-engine/backlog/write.js';
import { createContextBuilder } from './pipeline-engine/context.js';
import { loadDiscoveryConfig } from './pipeline-engine/discovery-config.js';
import { recordDecision } from './pipeline-engine/documents/decision.js';
import { createDocumentPublisher, deckAttachmentKey } from './pipeline-engine/documents/publish.js';
import { createDocumentRepository } from './pipeline-engine/documents/repository.js';
import { loadTemplates } from './pipeline-engine/documents/templates.js';
import { createPipelineEngine, type PipelineEngineOptions } from './pipeline-engine/engine.js';
import { createEventBus } from './pipeline-engine/events.js';
import { createPresentationRepository } from './pipeline-engine/presentation/repository.js';
import type { StageQueue } from './pipeline-engine/queue.js';
import { createPublishing } from './pipeline-engine/publishing.js';
import { createRunRepository } from './pipeline-engine/repository.js';
import { createAgentAsker, createEpicDrafter, type StageServices } from './pipeline-engine/services.js';
import { analyzingStage } from './pipeline-engine/stages/analyzing.js';
import { backlogStage } from './pipeline-engine/stages/backlog.js';
import { documentingStage } from './pipeline-engine/stages/documenting.js';
import { elicitingStage } from './pipeline-engine/stages/eliciting.js';
import { estimatingStage } from './pipeline-engine/stages/estimating.js';
import { intakeStage } from './pipeline-engine/stages/intake.js';
import { PPTX_TYPE, presentingStage } from './pipeline-engine/stages/presenting.js';
import { createPublisher } from './sync/publisher.js';
import { drizzleSyncLog } from './sync/sync-log.js';

/**
 * The pipeline as the app runs it: repositories, the event bus, every stage with its services,
 * and the decision log. `index.ts` serves it over HTTP; the end-to-end test drives it directly
 * with a replayed cassette and a fake Atlassian site.
 */

export function createRepositories(db: Db) {
  const repo = createRunRepository(db);
  return {
    repo,
    analysis: createAnalysisRepository(db),
    documents: createDocumentRepository(db),
    presentations: createPresentationRepository(db),
    backlog: createBacklogRepository(db),
    bus: createEventBus(repo),
  };
}
export type Repositories = ReturnType<typeof createRepositories>;

/** The hash that invalidates an agent's cached output when its definition or skills change. */
export function agentVersion(definition: { skills: string[] }, ...extra: unknown[]) {
  const hash = createHash('sha256')
    .update(JSON.stringify(definition))
    .update(definition.skills.map((name) => loadSkill(name).body).join('\n'));
  for (const value of extra) hash.update(JSON.stringify(value));
  return hash.digest('hex');
}

export function createPipeline(opts: {
  config: AppConfig;
  db: Db;
  pool: pg.Pool;
  repos: Repositories;
  /** In dry-run, a read-only gateway: every write is refused as a second safety net. */
  gateway: AtlassianGateway | undefined;
  claude: Pick<ClaudeCli, 'print'>;
  cassette?: Pick<Cassette, 'play'>;
  queue: StageQueue;
  log: PipelineEngineOptions['log'];
}) {
  const { config, db, pool, repos, gateway, claude, cassette, queue, log } = opts;
  const { repo, analysis, bus } = repos;
  const definitions = loadAgentDefinitions();
  const definition = (name: string) => {
    const found = definitions.get(name);
    if (!found) throw new Error(`agents/${name}.agent.md is missing`);
    return found;
  };
  const store = drizzleSyncLog(db);
  const { writeMode, jiraProjectKey, siteUrl, confluenceSpaceKey } = config.atlassian;

  const services: StageServices = {
    ask: createAgentAsker({
      runner: createAgentRunner({ claude, cassette }),
      definitions,
      schemas: AGENT_SCHEMAS,
      defaultModel: config.claude.model,
      log,
    }),
    createDraftEpic: createEpicDrafter({ config, atlassian: gateway, store, analysis }),
    analysis,
    context: createContextBuilder({ db, atlassian: gateway, jiraProjectKey }),
    // Validated at startup: a broken questionnaire config stops the app instead of a run.
    discovery: loadDiscoveryConfig(),
    assessment: loadAssessmentConfig(),
  };

  // Stage 04: the PM documents, published when the client presses the button.
  const templates = loadTemplates();
  const documentServices = {
    repo: repos.documents,
    templates,
    publisher: createDocumentPublisher({
      gateway,
      store,
      mode: writeMode,
      siteUrl,
      jiraProjectKey,
      spaceKey: confluenceSpaceKey,
    }),
    writerVersion: agentVersion(definition('pm-writer'), templates),
  };

  // Stage 05: the three-slide client deck and the decision gate.
  const jiraPublisher = () =>
    gateway && jiraProjectKey ? createPublisher({ gateway, store, mode: writeMode, jiraProjectKey }) : null;
  const presentationServices = {
    repo: repos.presentations,
    documents: repos.documents,
    autoApprove: config.pipeline.clientGateAutoApprove,
    presenterVersion: agentVersion(definition('presenter')),
  };

  // The client's optional publishes (documents, then the deck) and every later page update.
  const republishDeps = {
    analysis,
    context: services.context,
    repo,
    documents: repos.documents,
    publisher: documentServices.publisher,
    templates,
  };
  const publishing = createPublishing({
    pool,
    republish: republishDeps,
    presentations: repos.presentations,
    async attach(input) {
      const publisher = jiraPublisher();
      if (!publisher) return { status: 'skipped', url: null };
      const r = await publisher.upsertAttachment({
        key: deckAttachmentKey(input.runId),
        pageId: input.pageId,
        fileName: input.fileName,
        data: input.data,
        contentType: PPTX_TYPE,
        contentHash: input.contentHash,
      });
      // Opens the Feature Brief with the deck's preview; before the first upload, the Brief itself.
      const attachmentId = r.externalId.startsWith('att') ? r.externalId.slice(3) : null;
      const brief = `${siteUrl}/wiki/pages/viewpage.action?pageId=${input.pageId}`;
      const url = attachmentId
        ? `${brief}&preview=/${input.pageId}/${attachmentId}/${encodeURIComponent(input.fileName)}`
        : (r.url ?? null);
      return { status: r.action.replace(' ', '_'), url };
    },
  });

  // Stage 06: the approved feature's Epic and stories in Jira, and its block on the Initial Product Backlog.
  const backlogServices = {
    repo: repos.backlog,
    documents: repos.documents,
    writer: createBacklogWriter({ gateway, store, mode: writeMode, jiraProjectKey, siteUrl }),
    // Updates the documents only if the client published them.
    republish: publishing.republish,
    builderVersion: agentVersion(definition('backlog-builder')),
  };

  return createPipelineEngine({
    repo,
    bus,
    queue,
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
    log,
    // The Decision Log: the decision goes to the Feature Brief and the Assumption Log block (if
    // the client published them), under the publish lock like every other page write.
    onDecision: (run, decision) =>
      publishing.locked(run.id, () =>
        recordDecision(
          {
            ...republishDeps,
            closeEpic: (key) =>
              jiraPublisher()?.ensureStatus(key, 'done') ?? Promise.resolve('no transition' as const),
          },
          run,
          decision,
        ),
      ),
    publishing,
    documentsStatus: async (runId) => {
      const [set, rows] = await Promise.all([repos.documents.setOf(runId), repos.documents.documentsOf(runId)]);
      return { generated: rows.some((r) => r.markdown.length > 0), published: !!set?.publishedAt };
    },
  });
}
