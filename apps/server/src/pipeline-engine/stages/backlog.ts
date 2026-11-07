import type { BacklogItem } from '@ai-pm/shared';
import { BacklogDraft, DocumentDraft } from '../../agents/schemas.js';
import {
  type BacklogInputs,
  type BacklogPlan,
  buildBacklogPlan,
  builderHash,
  builderPrompt,
  checkBacklogDraft,
  coverageGaps,
} from '../backlog/plan.js';
import type { BacklogRepository } from '../backlog/repository.js';
import { type BacklogWriter, initialBacklogBlock, type IssueResult } from '../backlog/write.js';
import { buildFigures } from '../documents/figures.js';
import { loadDocumentInputs } from '../documents/load.js';
import type { DocumentRepository } from '../documents/repository.js';
import type { StageContext, StageHandler } from '../engine.js';
import type { RunRecord } from '../repository.js';
import type { StageServices } from '../services.js';

export interface BacklogServices {
  repo: Pick<BacklogRepository, 'setOf' | 'saveDraft' | 'saveWrite'>;
  documents: Pick<DocumentRepository, 'ensureSet' | 'documentsOf' | 'recordsOf' | 'epicKeyOf'>;
  writer: BacklogWriter;
  /** Rewrites the published documents, so the Brief shows the decision and links the Epic. */
  republish: (run: RunRecord) => Promise<unknown>;
  /** Changes when the builder's prompt or skills change, so the cached draft is redone. */
  builderVersion: string;
}

type Services = Pick<StageServices, 'ask' | 'analysis' | 'context'> & { backlog: BacklogServices };

/**
 * Everything before the Jira write: the inputs, the coverage gate, the backlog builder's draft
 * (one call, reused while its inputs are unchanged) and the issues to write. Used by the stage
 * and by the dry-run CLI.
 */
export async function prepareBacklog(
  services: Services,
  ctx: StageContext,
  options: { useCache: boolean },
): Promise<{ inputs: BacklogInputs; draft: BacklogDraft; plan: BacklogPlan; cached: boolean }> {
  const { run } = ctx;
  const b = services.backlog;
  const set = await b.documents.ensureSet(run.id);
  const docs = await loadDocumentInputs(
    {
      analysis: services.analysis,
      context: services.context,
      documents: b.documents,
      repo: ctx.repo,
    },
    run,
    set.faNumber,
  );
  const rows = await b.documents.documentsOf(run.id);
  const inputs: BacklogInputs = {
    docs,
    specification: DocumentDraft.safeParse(set.draft).data?.requirements ?? null,
    existingBacklog: await services.context.backlog(),
    documents: rows.filter((d) => d.url).map((d) => ({ title: d.title, url: d.url })),
    briefUrl: rows.find((d) => d.type === 'feature_brief')?.url ?? null,
  };

  // The coverage gate: every requirement in scope has at least one story.
  const gaps = coverageGaps(inputs);
  if (gaps.length)
    throw new Error(`The requirement coverage check failed: no story covers ${gaps.join(', ')}`);

  const items = docs.assessment.storyMap.items;
  const prompt = builderPrompt(inputs);
  // Our own new issues change the Jira backlog; they must not invalidate the cached draft.
  const hash = builderHash(builderPrompt({ ...inputs, existingBacklog: '' }), b.builderVersion);
  const stored = options.useCache ? await b.repo.setOf(run.id) : null;
  const cachedDraft = stored?.inputHash === hash ? BacklogDraft.safeParse(stored.draft) : null;
  let draft: BacklogDraft;
  let cached = false;
  if (cachedDraft?.success && checkBacklogDraft(cachedDraft.data, items).length === 0) {
    draft = cachedDraft.data;
    cached = true;
  } else {
    draft = await services.ask<BacklogDraft>(ctx, 'backlog-builder', prompt, {
      check: (d) => checkBacklogDraft(d, items),
    });
    await b.repo.saveDraft(run.id, hash, draft);
  }
  return { inputs, draft, plan: buildBacklogPlan(inputs, draft, buildFigures(docs)), cached };
}

const toItem = (plan: BacklogPlan['epic'], r: IssueResult): BacklogItem => ({
  localId: plan.localId,
  type: plan.type,
  summary: plan.summary,
  priority: plan.priority,
  aiEstimate: plan.aiEstimate,
  requirementCodes: plan.requirementCodes,
  blockedBy: plan.blockedBy,
  jiraKey: r.key,
  url: r.url,
  status: r.status,
  note: r.note,
});

/**
 * BPMN 06: after the client approves, the Epic and its stories go to Jira as an AI draft for the
 * Product Owner's review (label ai-draft, To Do, no sprint, Story Points empty, proposed
 * priority), the Initial Product Backlog page gets the feature's block, and the documents are
 * rewritten with the decision and the Epic. The chat gets one backlog card and a closing message.
 */
export function backlogStage(services: Services): StageHandler {
  return async (ctx) => {
    const { run } = ctx;
    const b = services.backlog;
    const { inputs, plan, cached } = await prepareBacklog(services, ctx, { useCache: true });
    const fa = `FA-${inputs.docs.faNumber}`;

    const result = await b.writer.writeIssues(run.id, plan, inputs.briefUrl);
    const live = b.writer.mode === 'live';
    if (live && result.epic.key) await services.analysis.setEpicKey(run.id, result.epic.key);
    const block = await b.writer.writeInitialBacklog(
      run.id,
      `aipm-fa-${inputs.docs.faNumber}`,
      initialBacklogBlock(fa, plan, result, inputs.briefUrl),
    );
    const items = [
      toItem(plan.epic, result.epic),
      ...plan.stories.map((s) =>
        toItem(
          s,
          result.stories.find((r) => r.localId === s.localId)!,
        ),
      ),
    ];
    await b.repo.saveWrite(run.id, items, {
      mode: b.writer.mode,
      confluenceUrl: block.url,
      confluenceStatus: block.status,
    });
    // The Brief shows the approval and links the Epic; its title gets the Epic key.
    await b.republish(run);

    const epic = result.epic;
    await ctx.emit(
      {
        type: 'backlog_ready',
        epicKey: epic.key,
        epicUrl: epic.url,
        stories: plan.stories.length,
        mode: b.writer.mode,
      },
      'backlog.result',
    );
    const changed = [epic, ...result.stories].some((r) => r.status === 'created' || r.status === 'updated');
    const verb = [epic, ...result.stories].some((r) => r.status === 'created') ? 'created' : 'updated';
    await ctx.emit(
      {
        type: 'message',
        role: 'ai',
        text: live
          ? [
              changed
                ? `Jira is updated: I ${verb} the Epic **${epic.key}** with ${plan.stories.length} stories: ${epic.url}`
                : `Jira is up to date: the Epic **${epic.key}** and its ${plan.stories.length} stories are already there: ${epic.url}`,
              `They are an AI draft in the Product Backlog (label ai-draft, status To Do, not in any sprint). The Product Owner reviews and orders them, and the team refines and estimates them in Backlog Refinement. The ${fa} Feature Brief records your approval and links the Epic, and the Initial Product Backlog lists it.`,
              'Thank you for your decision: this conversation is now closed.',
            ].join('\n\n')
          : [
              `Jira writes are in dry-run mode, so nothing was written. The card above shows the Epic and the ${plan.stories.length} stories a live run would create.`,
              'This conversation is now closed.',
            ].join('\n\n'),
      },
      'backlog.closing',
    );

    return {
      next: 'completed',
      output: {
        mode: b.writer.mode,
        cachedDraft: cached,
        epic: { key: epic.key, status: epic.status },
        stories: result.stories.map((s) => ({ ref: s.localId, key: s.key, status: s.status })),
        links: result.links,
        initialBacklog: block.status,
      },
    };
  };
}
