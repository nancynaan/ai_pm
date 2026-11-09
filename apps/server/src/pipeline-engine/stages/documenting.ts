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

/**
 * BPMN 04: the PM documents. Runs when the client presses "Generate documents". One pm-writer
 * call writes the text of all documents, reused while the assessment is unchanged; code renders
 * tables and figures and the validator checks the draft and the result. The documents are saved
 * as generated (with previews) and the run goes on to the presentation. Publishing them to
 * Confluence is a separate, optional action the client takes once, at any time
 * (`publishing.ts`).
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
      draft = await services.ask<DocumentDraft>(ctx, 'pm-writer', prompt, {
        check: (d) => checkDraft(d, checks),
      });
      await docs.repo.saveDraft(run.id, hash, draft);
    }

    // Check the rendered result: the same check runs again before a publish.
    const render = (links: Links) => renderDocuments(inputs, draft, docs.templates, links);
    const rendered = render(await docs.publisher.knownLinks(run.id));
    const problems = checkRendered(rendered, inputs);
    if (problems.length) throw new Error(`The document check failed: ${problems.slice(0, 3).join('; ')}`);

    const previous = await docs.repo.documentsOf(run.id);
    const rows: DocumentRecord[] = rendered.map((doc) => {
      const old = previous.find((x) => x.type === doc.type);
      return {
        type: doc.type,
        title: doc.title,
        markdown: doc.markdown,
        figures: doc.figures,
        status: doc.needed ? 'generated' : 'not_needed',
        confluencePageId: old?.confluencePageId ?? null,
        confluenceVersion: old?.confluenceVersion ?? null,
        url: old?.url ?? null,
        note: doc.needed ? null : 'The feature does not change roadmap commitments',
      };
    });
    await docs.repo.saveDocuments(run.id, rows, docs.publisher.mode, { published: false });
    const generated = rows.filter((r) => r.status === 'generated').length;

    // Generated late, at the decision (the client skipped them first): back to the decision.
    const late = !!(await ctx.repo.lastSucceededAt(run.id, 'presenting'));
    // Each step shows once in the chat: a re-run rewrites these in place.
    await ctx.emit({ type: 'documents', published: 0, mode: docs.publisher.mode }, 'documents.status');
    await ctx.emit(
      {
        type: 'message',
        role: 'ai',
        text: late
          ? `The documents are ready (FA-${set.faNumber}): ${generated} generated, each with a preview on the Documents card above. Publish them to Confluence from that card; once they are published, you can approve the feature.`
          : `The documents are ready (FA-${set.faNumber}): ${generated} generated, each with a preview on the Documents card above. You can publish them to Confluence anytime from that card; approving the feature needs them published. Next, I am preparing the proposal.`,
      },
      'documents.result',
    );

    // On without waiting for a publish.
    return { next: late ? 'awaiting_decision' : 'presenting', output: { faNumber: set.faNumber, generated } };
  };
}
