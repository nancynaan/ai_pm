import { createHash } from 'node:crypto';
import { DeckDraft } from '../../agents/schemas.js';
import type { SeedData } from '../../baseline/seed-data.js';
import { deckFileName, deckToPptx } from '../../render/pptx.js';
import { loadDocumentInputs } from '../documents/load.js';
import type { DocumentRepository } from '../documents/repository.js';
import { buildDeck, type DeckInputs, presenterPrompt } from '../presentation/deck.js';
import { nextVersion, type PresentationRepository } from '../presentation/repository.js';
import { checkDeckDraft, deckCheckContext } from '../presentation/validate.js';
import type { StageHandler } from '../engine.js';
import type { StageServices } from '../services.js';
import { highlights } from './estimating.js';

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export interface PresentationServices {
  repo: PresentationRepository;
  documents: Pick<DocumentRepository, 'setOf' | 'documentsOf' | 'recordsOf' | 'epicKeyOf'>;
  /** Changes when the presenter's prompt or skills change, so the stored wording is redone. */
  presenterVersion: string;
  autoApprove: boolean;
  /** Attaches the PPTX to the Feature Brief page (idempotent; dry-run aware). */
  attach(input: {
    runId: string;
    pageId: string;
    fileName: string;
    data: Uint8Array;
    contentHash: string;
  }): Promise<{ status: string; url: string | null }>;
}

/** The deck's content without its timestamp: an unchanged deck is not uploaded again. */
const contentHash = (deck: object) =>
  createHash('sha256')
    .update(JSON.stringify({ ...deck, createdAt: undefined }))
    .digest('hex');

/**
 * BPMN 05: the three-slide client deck and the decision gate. One presenter call words the
 * slides (reused while the assessment is unchanged); code fills every number. The PPTX goes to
 * the Feature Brief in Confluence; then the client decides (or auto-approve moves on).
 */
export function presentingStage(
  services: StageServices & { presentation: PresentationServices },
): StageHandler {
  return async (ctx) => {
    const { run } = ctx;
    const p = services.presentation;
    const [set, data] = await Promise.all([
      p.documents.setOf(run.id),
      services.context.baselineData(run.projectId, ['business_case']),
    ]);
    const kpis = (data.business_case as SeedData['kpis'] | undefined)?.metrics ?? [];
    const inputs: DeckInputs = {
      ...(await loadDocumentInputs(
        { analysis: services.analysis, context: services.context, documents: p.documents, repo: ctx.repo },
        run,
        set?.faNumber ?? 0,
      )),
      kpis,
    };

    const prompt = presenterPrompt(inputs);
    const inputHash = createHash('sha256').update(p.presenterVersion).update(prompt).digest('hex');
    const checks = deckCheckContext(inputs);
    const stored = await p.repo.get(run.id);
    const reused = stored?.inputHash === inputHash ? DeckDraft.safeParse(stored.draft) : null;
    let draft: DeckDraft;
    let version: string;
    if (reused?.success && checkDeckDraft(reused.data, checks).length === 0) {
      draft = reused.data;
      version = stored!.version;
    } else {
      draft = await services.ask<DeckDraft>(ctx, 'presenter', prompt, {
        check: (d) => checkDeckDraft(d, checks),
      });
      version = nextVersion(stored?.version ?? null);
    }
    // A re-publish with an unchanged deck already shown to the client adds no new cards.
    const estimatedAt = await ctx.repo.lastSucceededAt(run.id, 'estimating');
    const alreadyShown = !!reused?.success && !!stored && !!estimatedAt && stored.updatedAt > estimatedAt;
    const deck = buildDeck(inputs, draft, version, new Date());
    await p.repo.save(run.id, { version, inputHash, draft, deck });

    // The PPTX goes to the Feature Brief once the documents are in Confluence.
    const brief = (await p.documents.documentsOf(run.id)).find((d) => d.type === 'feature_brief');
    const attachment = brief?.confluencePageId
      ? await p.attach({
          runId: run.id,
          pageId: brief.confluencePageId,
          fileName: deckFileName(deck, set?.faNumber ?? null),
          data: await deckToPptx(deck),
          contentHash: contentHash(deck),
        })
      : { status: 'skipped', url: null };
    await p.repo.setAttachment(run.id, attachment.status, attachment.url);

    if (alreadyShown) {
      return {
        next: 'awaiting_decision',
        output: { version, attachment: attachment.status, unchanged: true },
      };
    }
    // One presentation card and one decision card per run: a new deck rewrites them in place.
    await ctx.emit({ type: 'presentation_ready', version, label: deck.label }, 'presentation');
    const assessment = inputs.assessment;
    // The question comes first, then the card with the decision buttons.
    await ctx.emit(
      {
        type: 'message',
        role: 'ai',
        text: p.autoApprove
          ? 'Auto-approve is on, so I am going straight to the backlog.'
          : 'Here is the assessment summary. Do you want to go ahead with this feature?',
      },
      'decision.prompt',
    );
    await ctx.emit(
      {
        type: 'decision_requested',
        verdict: `${assessment.verdict.label}${assessment.preliminary ? ' (preliminary)' : ''}`,
        highlights: highlights(assessment),
      },
      'decision',
    );
    if (p.autoApprove) {
      await ctx.repo.saveDecision(run.id, 'approve', 'Auto-approved (CLIENT_GATE_AUTO_APPROVE is on)');
      return { next: 'backlog', output: { version, attachment: attachment.status, autoApproved: true } };
    }
    return { next: 'awaiting_decision', output: { version, attachment: attachment.status } };
  };
}
