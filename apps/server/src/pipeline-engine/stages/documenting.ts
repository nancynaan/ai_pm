import { DocumentDraft } from '../../agents/schemas.js';
import { needsRoadmapProposal } from '../calculators/baseline.js';
import { buildFigures } from '../documents/figures.js';
import { loadDocumentInputs } from '../documents/load.js';
import { inputHash, writerPrompt } from '../documents/prompt.js';
import type { DocumentPublisher } from '../documents/publish.js';
import { type Links, renderDocuments } from '../documents/render.js';
import type { DocumentRecord, DocumentRepository } from '../documents/repository.js';
import type { Templates } from '../documents/templates.js';
import { checkDraft, checkRendered, draftCheckContext } from '../documents/validate.js';
import type { StageHandler } from '../engine.js';
import type { StageServices } from '../services.js';

export interface DocumentServices {
  repo: DocumentRepository;
  publisher: DocumentPublisher;
  templates: Templates;
  /** Changes when the writer's prompt, skills or templates change, so the cached draft is redone. */
  writerVersion: string;
}

const PUBLISHED = new Set(['created', 'updated', 'unchanged']);

/**
 * BPMN 04: the PM documents. Runs when the client presses "Publish documents" (and again for
 * every re-publish). One pm-writer call writes the text of all documents, reused while the
 * assessment is unchanged; code renders tables and figures, the validator checks the draft and
 * the result, and the publisher creates or rewrites the Confluence pages without duplicates.
 */
export function documentingStage(services: StageServices & { documents: DocumentServices }): StageHandler {
  return async (ctx) => {
    const { run } = ctx;
    const docs = services.documents;
    if (!(await services.analysis.assessmentOf(run.id)))
      throw new Error('This run has no assessment yet; the documents are built from it.');
    const set = await docs.repo.ensureSet(run.id);
    const inputs = await loadDocumentInputs(
      { analysis: services.analysis, context: services.context, documents: docs.repo, repo: ctx.repo },
      run,
      set.faNumber,
    );
    const assessment = inputs.assessment;

    // One writer call for all documents; an unchanged assessment reuses the stored draft.
    const roadmapNeeded = needsRoadmapProposal(assessment.roadmapImpact);
    const prompt = writerPrompt(inputs, buildFigures(inputs), docs.templates, roadmapNeeded);
    const hash = inputHash(prompt, docs.writerVersion);
    const checks = draftCheckContext(inputs, roadmapNeeded);
    const cached = set.inputHash === hash ? DocumentDraft.safeParse(set.draft) : null;
    let draft: DocumentDraft;
    if (cached?.success && checkDraft(cached.data, checks).length === 0) {
      draft = cached.data;
    } else {
      await ctx.emit({
        type: 'message',
        role: 'ai',
        text: 'Writing the documents. This takes a few minutes.',
      });
      draft = await services.ask<DocumentDraft>(ctx, 'pm-writer', prompt, {
        check: (d) => checkDraft(d, checks),
      });
      await docs.repo.saveDraft(run.id, hash, draft);
    }

    // Check the rendered result before anything goes to Confluence.
    const render = (links: Links) => renderDocuments(inputs, draft, docs.templates, links);
    const problems = checkRendered(render(await docs.publisher.knownLinks(run.id)), inputs);
    if (problems.length) throw new Error(`The document check failed: ${problems.slice(0, 3).join('; ')}`);

    const { docs: rendered, results } = await docs.publisher.publish(inputs, render);
    const rows: DocumentRecord[] = rendered.map((doc) => {
      const r = results.find((x) => x.type === doc.type);
      return {
        type: doc.type,
        title: doc.title,
        markdown: doc.markdown,
        figures: doc.figures,
        status: r?.status ?? 'skipped',
        confluencePageId: r?.pageId ?? null,
        confluenceVersion: r?.version ?? null,
        url: r?.url ?? null,
        note: r?.note ?? null,
      };
    });
    await docs.repo.saveDocuments(run.id, rows, docs.publisher.mode);

    const published = results.filter((r) => PUBLISHED.has(r.status)).length;
    await ctx.emit({ type: 'documents', published, mode: docs.publisher.mode });
    const live = docs.publisher.mode === 'live';
    await ctx.emit({
      type: 'message',
      role: 'ai',
      text: live
        ? `The documents are in Confluence (FA-${set.faNumber}): ${published} published. The Documents card above has the links.`
        : `Confluence writes are in dry-run mode, so nothing was written. The Documents card above shows what a live publish would do; each document has a preview.`,
    });

    // A re-publish from the decision step returns there; the first publish goes on to the presentation.
    const [presented, estimated] = await Promise.all([
      ctx.repo.lastSucceededAt(run.id, 'presenting'),
      ctx.repo.lastSucceededAt(run.id, 'estimating'),
    ]);
    const next = presented && estimated && presented > estimated ? 'awaiting_decision' : 'presenting';
    return {
      next,
      output: {
        faNumber: set.faNumber,
        mode: docs.publisher.mode,
        results: results.map((r) => ({ type: r.type, status: r.status })),
      },
    };
  };
}
