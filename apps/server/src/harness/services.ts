import type { z } from 'zod';
import { type AgentDefinition, buildAgentSpec } from '../agents/registry.js';
import type { AgentRunner } from '../agents/runner.js';
import type { AppConfig } from '../config.js';
import type { AtlassianGateway } from '../integrations/atlassian/index.js';
import { markdownToAdf } from '../render/adf.js';
import { createPublisher, isPlaceholder } from '../sync/publisher.js';
import type { SyncLogStore } from '../sync/sync-log.js';
import type { AnalysisRepository } from './analysis-repository.js';
import type { ContextBuilder } from './context.js';
import type { AssessmentConfig } from './assessment-config.js';
import type { DiscoveryConfig } from './discovery-config.js';
import type { StageContext } from './orchestrator.js';
import type { RunRecord } from './repository.js';

export interface DraftEpic {
  key: string | null;
  url: string | null;
  /** One sentence for the chat. */
  note: string;
}

/** What the real stages need; tests pass fakes. */
export interface StageServices {
  ask<T>(ctx: StageContext, agent: string, prompt: string): Promise<T>;
  createDraftEpic(run: RunRecord, epicSummary: string, summary: string): Promise<DraftEpic>;
  analysis: AnalysisRepository;
  context: ContextBuilder;
  /** The discovery questionnaire and its completeness rules (config/discovery.yaml). */
  discovery: DiscoveryConfig;
  /** Assessment settings and verdict rules (config/feasibility-rules.yaml). */
  assessment: AssessmentConfig;
}

export function createAgentAsker(opts: {
  runner: AgentRunner;
  definitions: Map<string, AgentDefinition>;
  schemas: Record<string, z.ZodType>;
  defaultModel: string;
}): StageServices['ask'] {
  return async <T>(ctx: StageContext, agent: string, prompt: string): Promise<T> => {
    const definition = opts.definitions.get(agent);
    if (!definition) throw new Error(`Agent "${agent}" is not defined in agents/`);
    const spec = buildAgentSpec<T>(definition, {
      defaultModel: opts.defaultModel,
      schemas: opts.schemas,
      baselineDigest: ctx.baselineDigest,
    });
    return opts.runner.run(spec, prompt, {
      onCall: (call) => ctx.repo.recordCall(ctx.run.id, ctx.executionId, call),
    });
  };
}

/** The draft Epic created at intake on the Product Owner's behalf. Honours the write mode. */
export function createEpicDrafter(opts: {
  config: AppConfig;
  atlassian?: AtlassianGateway;
  store: SyncLogStore;
  analysis: AnalysisRepository;
}): StageServices['createDraftEpic'] {
  return async (run, epicSummary, summary) => {
    const projectKey = opts.config.atlassian.jiraProjectKey;
    if (!opts.atlassian || !projectKey) {
      return { key: null, url: null, note: 'Jira is not configured, so no draft Epic was created.' };
    }
    const publisher = createPublisher({
      gateway: opts.atlassian,
      store: opts.store,
      mode: opts.config.atlassian.writeMode,
      jiraProjectKey: projectKey,
    });
    const marker = `aipm-run-${run.id}`;
    const result = await publisher.upsertIssue({
      key: `run:${run.id}:epic`,
      marker,
      label: epicSummary,
      fields: {
        project: { key: projectKey },
        issuetype: { name: 'Epic' },
        summary: epicSummary,
        description: markdownToAdf(
          `**Draft created by the AI PM pipeline.** The assessment is in progress; the Product Owner completes this Epic after the client's decision.\n\n## Client request\n\n${run.description}\n\n## Summary\n\n${summary}`,
        ),
        labels: ['ai-pm', 'ai-pm-draft', marker],
      },
    });
    if (isPlaceholder(result.externalId)) {
      return {
        key: null,
        url: null,
        note: 'Jira writes are in dry-run mode, so the draft Epic was not created (set ATLASSIAN_WRITE_MODE=live to create it).',
      };
    }
    await opts.analysis.setEpicKey(run.id, result.externalId);
    return {
      key: result.externalId,
      url: result.url ?? null,
      note: `I created a draft Epic in Jira: ${result.externalId} ${result.url ?? ''}`.trim(),
    };
  };
}
