import {
  type DocumentSet,
  documentPreviewSchema,
  type DocumentPreview as Preview,
  documentSetSchema,
  type DocumentStatus,
} from '@ai-pm/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorText } from './api.js';
import { FeatureTitle } from './FeatureTitle.js';
import { Markdown } from './Markdown.js';
import { Waiting } from './Waiting.js';

const STATUS: Record<DocumentStatus, { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  pending: { label: 'Not generated yet', tone: 'neutral' },
  generated: { label: 'Generated, not published yet', tone: 'neutral' },
  created: { label: 'Published', tone: 'ok' },
  updated: { label: 'Published', tone: 'ok' },
  unchanged: { label: 'Published', tone: 'ok' },
  would_create: { label: 'Would be created (dry-run)', tone: 'warn' },
  would_update: { label: 'Would be updated (dry-run)', tone: 'warn' },
  not_needed: { label: 'Not needed', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'warn' },
};

const ok = z.object({ ok: z.boolean() });

/**
 * The Documents card under the assessment: "Generate documents", then "Publish to Confluence",
 * each shown only while its step is still to do (no re-generation, no re-publish). "Skip for now"
 * moves on without them for any verdict; Approve needs them published, so a client who skipped
 * generates them here (or on the Documents tab) at the decision.
 */
export function DocumentsCard({ runId, version }: { runId: string; version: number }) {
  const [set, setSet] = useState<DocumentSet | null>(null);
  const [busy, setBusy] = useState<'generate' | 'publish' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    api(`/api/runs/${runId}/documents`, documentSetSchema)
      .then(setSet)
      .catch((err: unknown) => setError(errorText(err)));
  }, [runId, version, tick]);
  // While the documents are being generated, check again every few seconds.
  const waiting = busy === 'generate' || set?.running;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setTick((t) => t + 1), 4000);
    return () => clearInterval(timer);
  }, [waiting]);

  async function act(kind: 'generate' | 'publish' | 'skip') {
    setBusy(kind);
    setError(null);
    const path = { generate: '', publish: '/publish', skip: '/skip' }[kind];
    try {
      await api(`/api/runs/${runId}/documents${path}`, ok, { method: 'POST', body: '{}' });
      setTick((t) => t + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (!set) return error ? <p className="error">Could not load the documents: {error}</p> : null;
  const published = set.publishedAt !== null;
  const dryRun = set.mode === 'dry-run';
  const generating = set.running || busy === 'generate';
  // Each button shows only while its step is still to do.
  const showGenerate = !set.generated && (set.canGenerate || generating);
  const showPublish = !published && (set.generated || set.canGenerate || generating);

  return (
    <>
      <div className="card documents">
        <div className="card-head">
          <h3>Documents{set.faNumber ? ` · FA-${set.faNumber}` : ''}</h3>
          {dryRun && <span className="tag warn">Dry-run</span>}
        </div>
        <p className="muted">
          The Feature Brief, Requirements Specification and Estimation &amp; Release Forecast, plus this
          feature&apos;s entries for the shared Risk Register and Assumption Log; a Roadmap Update Proposal
          only when the roadmap changes. Generate them to preview them here and on the Documents tab;
          publishing them to Confluence is optional.
        </p>
        {generating ? (
          <Waiting text="Please wait, the documents are generating. This takes a few minutes." />
        ) : (
          <div className="table-wide">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Status</th>
                  <th>Preview</th>
                  <th>Confluence</th>
                </tr>
              </thead>
              <tbody>
                {set.documents.map((doc) => {
                  const status = STATUS[doc.status];
                  return (
                    <tr key={doc.type}>
                      <td>
                        {doc.title}
                        {doc.note && <div className="detail">{doc.note}</div>}
                      </td>
                      <td>
                        <span className={`tag ${status.tone}`}>{status.label}</span>
                        {doc.version !== null && <div className="detail">Version {doc.version}</div>}
                      </td>
                      <td className="links">
                        {doc.preview ? (
                          <a href={`#/runs/${runId}/documents/${doc.type}`}>Preview</a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="links">
                        {doc.url ? (
                          <a href={doc.url} target="_blank" rel="noreferrer">
                            Open in Confluence
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {dryRun && (
          <p className="muted">
            Confluence writes are in dry-run mode: a publish writes nothing and the table shows what a live
            publish would do.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {/* A step that is done loses its button: there is no re-generation and no re-publish. */}
        {(showGenerate || showPublish) && (
          <div className="actions doc-actions">
            {showGenerate && (
              <button
                type="button"
                className="go"
                disabled={!set.canGenerate || busy !== null}
                onClick={() => void act('generate')}
              >
                {generating ? 'Generating…' : 'Generate documents'}
              </button>
            )}
            {showPublish && (
              <PublishButton
                id={`publish-docs-${runId}`}
                canPublish={set.canPublish}
                lockedReason={set.lockedReason}
                busy={busy === 'publish'}
                note="Required to approve"
                onPublish={() => void act('publish')}
              />
            )}
          </div>
        )}
        {set.canSkip && (
          <p className="skip">
            <button type="button" className="link" disabled={busy !== null} onClick={() => void act('skip')}>
              Skip for now
            </button>{' '}
            <span className="muted">
              and go straight to the proposal. You can decline without documents; to approve the feature,
              generate and publish them first.
            </span>
          </p>
        )}
      </div>
    </>
  );
}

/**
 * "Publish to Confluence": grey with a hint until it can be used, then green. The caller removes
 * it once the publish is done: there is no second publish.
 */
export function PublishButton({
  id,
  canPublish,
  lockedReason,
  busy,
  note,
  onPublish,
}: {
  id: string;
  canPublish: boolean;
  lockedReason: string | null;
  busy: boolean;
  /** The small line under the button ("Optional", "Required to approve"). */
  note: string;
  onPublish: () => void;
}) {
  if (!canPublish) {
    // aria-disabled keeps it focusable, so the hint shows on hover, keyboard focus and a tap.
    return (
      <span className="publish">
        <span className="hint-wrap">
          <button type="button" className="go locked" aria-disabled="true" aria-describedby={`${id}-hint`}>
            Publish to Confluence
          </button>
          {lockedReason && (
            <span role="tooltip" id={`${id}-hint`} className="hint">
              {lockedReason}
            </span>
          )}
        </span>
        <span className="optional">{note}</span>
      </span>
    );
  }
  return (
    <span className="publish">
      <button type="button" className="go" disabled={busy} onClick={onPublish}>
        {busy ? 'Publishing…' : 'Publish to Confluence'}
      </button>
      <span className="optional">{note}</span>
    </span>
  );
}

/** #/runs/<id>/documents/<type>: one document as it was rendered for Confluence. */
export function DocumentPreview({ runId, type }: { runId: string; type: string }) {
  const [doc, setDoc] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api(`/api/runs/${runId}/documents/${type}`, documentPreviewSchema)
      .then(setDoc)
      .catch((err: unknown) => setError(errorText(err)));
  }, [runId, type]);

  return (
    <>
      <p className="actions start">
        <a href={`#/runs/${runId}/documents`}>← Back to the documents</a>
      </p>
      {error && <p className="error">Could not load the document: {error}</p>}
      {doc && (
        <section className="card doc-preview">
          <div className="card-head">
            <h2>{doc.title}</h2>
            <span className="tag neutral">Preview</span>
          </div>
          <Markdown source={doc.markdown} />
        </section>
      )}
    </>
  );
}

/** #/runs/<id>/documents: the Documents card on its own. */
export function DocumentsTab({ runId }: { runId: string }) {
  return (
    <>
      <FeatureTitle runId={runId} />
      <DocumentsCard runId={runId} version={0} />
    </>
  );
}
