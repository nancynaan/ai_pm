import { DocumentDraft } from '../../agents/schemas.js';
import type { Publisher } from '../../sync/publisher.js';
import type { RunRecord } from '../repository.js';
import { type DocumentInputDeps, loadDocumentInputs } from './load.js';
import type { DocumentPublisher } from './publish.js';
import { renderDocuments } from './render.js';
import type { DocumentRecord, DocumentRepository } from './repository.js';
import type { Templates } from './templates.js';

export interface DecisionLogDeps extends DocumentInputDeps {
  documents: DocumentInputDeps['documents'] &
    Pick<DocumentRepository, 'setOf' | 'documentsOf' | 'saveDocuments'>;
  publisher: DocumentPublisher;
  templates: Templates;
  /** Moves the draft Epic to Done when the client declines; absent without Jira. */
  closeEpic?: (epicKey: string) => ReturnType<Publisher['ensureStatus']>;
}

/**
 * The Decision Log (BPMN 05): after the client decides, the published documents are rendered
 * again from the stored draft (no Claude call), so the Feature Brief shows the decision next to
 * the recommendation and the Assumption Log block lists it. A decline closes the draft Epic.
 * Returns a chat message, or null when there is nothing to record (documents never published).
 */
export async function recordDecision(
  deps: DecisionLogDeps,
  run: RunRecord,
  decision: 'approve' | 'changes' | 'decline',
): Promise<string | null> {
  const notes: string[] = [];
  const set = await deps.documents.setOf(run.id);
  const draft = DocumentDraft.safeParse(set?.draft);
  if (set && draft.success && set.publishedAt) {
    const inputs = await loadDocumentInputs(deps, run, set.faNumber);
    const { docs, results } = await deps.publisher.publish(inputs, (links) =>
      renderDocuments(inputs, draft.data, deps.templates, links),
    );
    const previous = await deps.documents.documentsOf(run.id);
    const rows: DocumentRecord[] = docs.map((doc) => {
      const r = results.find((x) => x.type === doc.type);
      const old = previous.find((x) => x.type === doc.type);
      return {
        type: doc.type,
        title: doc.title,
        markdown: doc.markdown,
        figures: doc.figures,
        status: r?.status ?? 'skipped',
        confluencePageId: r?.pageId ?? old?.confluencePageId ?? null,
        confluenceVersion: r?.version ?? old?.confluenceVersion ?? null,
        url: r?.url ?? old?.url ?? null,
        note: r?.note ?? null,
      };
    });
    await deps.documents.saveDocuments(run.id, rows, deps.publisher.mode);
    notes.push(
      deps.publisher.mode === 'live'
        ? `I recorded the decision in Confluence: the FA-${set.faNumber} Feature Brief shows it next to the recommendation, and the Assumption Log lists it.`
        : 'Confluence writes are in dry-run mode, so the decision was not written to Confluence.',
    );
  }
  const epicKey = await deps.documents.epicKeyOf(run.id);
  if (decision === 'decline' && epicKey && deps.closeEpic) {
    const result = await deps.closeEpic(epicKey);
    notes.push(
      result === 'changed' || result === 'unchanged'
        ? `The draft Epic ${epicKey} is closed.`
        : result === 'would change'
          ? `The draft Epic ${epicKey} would be closed (dry-run).`
          : `The draft Epic ${epicKey} has no transition to Done; close it in Jira.`,
    );
  }
  return notes.length ? notes.join(' ') : null;
}
