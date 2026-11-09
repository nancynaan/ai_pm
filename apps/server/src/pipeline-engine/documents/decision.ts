import { DocumentDraft } from '../../agents/schemas.js';
import type { Publisher } from '../../sync/publisher.js';
import type { RunRecord } from '../repository.js';
import { type DocumentInputDeps, loadDocumentInputs } from './load.js';
import type { DocumentPublisher } from './publish.js';
import { type Links, renderDocuments } from './render.js';
import type { DocumentRecord, DocumentRepository } from './repository.js';
import type { Templates } from './templates.js';
import { checkRendered } from './validate.js';

export interface RepublishDeps extends DocumentInputDeps {
  documents: DocumentInputDeps['documents'] &
    Pick<DocumentRepository, 'setOf' | 'documentsOf' | 'saveDocuments'>;
  publisher: DocumentPublisher;
  templates: Templates;
}

export interface DecisionLogDeps extends RepublishDeps {
  /** Moves the draft Epic to Done when the client declines; absent without Jira. */
  closeEpic?: (epicKey: string) => ReturnType<Publisher['ensureStatus']>;
}

/**
 * Renders the published documents again from the stored draft (no Claude call) and rewrites
 * them in place, so they show what happened since: the client's decision, the Epic and its
 * backlog, the published deck. Returns null when the documents were never published: the
 * client's choice, which a later step never overrides.
 */
export async function republishDocuments(
  deps: RepublishDeps,
  run: RunRecord,
): Promise<{ faNumber: number; mode: DocumentPublisher['mode'] } | null> {
  const set = await deps.documents.setOf(run.id);
  if (!set?.publishedAt) return null;
  return publishStoredDocuments(deps, run);
}

/**
 * Publishes the generated documents from the stored draft (no Claude call): the client's
 * "Publish to Confluence", and every later update of pages already published. Returns null
 * when nothing was generated.
 */
export async function publishStoredDocuments(
  deps: RepublishDeps,
  run: RunRecord,
): Promise<{
  faNumber: number;
  mode: DocumentPublisher['mode'];
  results: { type: string; status: string }[];
} | null> {
  const set = await deps.documents.setOf(run.id);
  const draft = DocumentDraft.safeParse(set?.draft);
  if (!set || !draft.success) return null;
  const inputs = await loadDocumentInputs(deps, run, set.faNumber);
  const render = (links: Links) => renderDocuments(inputs, draft.data, deps.templates, links);
  // The same check as at generation: nothing goes to Confluence that fails it.
  const problems = checkRendered(render(await deps.publisher.knownLinks(run.id)), inputs);
  if (problems.length) throw new Error(`The document check failed: ${problems.slice(0, 3).join('; ')}`);
  const { docs, results } = await deps.publisher.publish(inputs, render);
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
  await deps.documents.saveDocuments(run.id, rows, deps.publisher.mode, { published: true });
  return {
    faNumber: set.faNumber,
    mode: deps.publisher.mode,
    results: results.map((r) => ({ type: r.type, status: r.status })),
  };
}

/**
 * The Decision Log (BPMN 05) after a decline: the Feature Brief shows the decision next to the
 * recommendation, the Assumption Log block lists it, the draft Epic is closed and the
 * conversation ends. An approval is recorded by the backlog stage instead, which rewrites the
 * same pages with the Epic (two writers on one page would race). Returns a chat message.
 */
export async function recordDecision(
  deps: DecisionLogDeps,
  run: RunRecord,
  decision: 'approve' | 'decline',
): Promise<string | null> {
  if (decision === 'approve') return null;
  const notes: string[] = [];
  const republished = await republishDocuments(deps, run);
  if (republished) {
    notes.push(
      republished.mode === 'live'
        ? `I recorded the decision in Confluence: the FA-${republished.faNumber} Feature Brief shows it next to the recommendation, and the Assumption Log lists it.`
        : 'Confluence writes are in dry-run mode, so the decision was not written to Confluence.',
    );
  }
  const epicKey = await deps.documents.epicKeyOf(run.id);
  if (epicKey && deps.closeEpic) {
    const result = await deps.closeEpic(epicKey);
    notes.push(
      result === 'changed' || result === 'unchanged'
        ? `The draft Epic ${epicKey} is closed.`
        : result === 'would change'
          ? `The draft Epic ${epicKey} would be closed (dry-run).`
          : `The draft Epic ${epicKey} has no transition to Done; close it in Jira.`,
    );
  }
  notes.push('Nothing goes to the backlog. Thank you for your time: this conversation is now closed.');
  return notes.join(' ');
}
