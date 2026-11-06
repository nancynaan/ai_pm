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

const STATUS: Record<DocumentStatus, { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  pending: { label: 'Not published yet', tone: 'neutral' },
  created: { label: 'Created', tone: 'ok' },
  updated: { label: 'Updated', tone: 'ok' },
  unchanged: { label: 'Up to date', tone: 'ok' },
  would_create: { label: 'Would be created (dry-run)', tone: 'warn' },
  would_update: { label: 'Would be updated (dry-run)', tone: 'warn' },
  not_needed: { label: 'Not needed', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'warn' },
};

/**
 * The Documents card under the assessment: the button that generates the documents and
 * publishes them to Confluence, and a table with each document and its link. Re-publishing
 * rewrites the same pages; nothing is duplicated.
 */
export function DocumentsCard({ runId, version }: { runId: string; version: number }) {
  const [set, setSet] = useState<DocumentSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    api(`/api/runs/${runId}/documents`, documentSetSchema)
      .then(setSet)
      .catch((err: unknown) => setError(errorText(err)));
  }, [runId, version, tick]);
  // While the documents step runs (or right after the button), check again every few seconds.
  const waiting = busy || set?.running;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setTick((t) => t + 1), 4000);
    return () => clearInterval(timer);
  }, [waiting]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/runs/${runId}/documents`, z.object({ ok: z.boolean() }), {
        method: 'POST',
        body: '{}',
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!set) return error ? <p className="error">Could not load the documents: {error}</p> : null;
  const published = set.publishedAt !== null;
  const dryRun = set.mode === 'dry-run';

  return (
    <div className="card documents">
      <div className="card-head">
        <h3>Documents{set.faNumber ? ` · FA-${set.faNumber}` : ''}</h3>
        {dryRun && <span className="tag warn">Dry-run</span>}
      </div>
      <p className="muted">
        The Feature Brief, Requirements Specification and Estimation &amp; Release Forecast go to Confluence
        under Feature Assessments; this feature&apos;s risks and assumptions are added to the shared Risk
        Register and Assumption Log. A Roadmap Update Proposal is added only when the roadmap changes.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Status</th>
              <th>Link</th>
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
                    {doc.url && (
                      <a href={doc.url} target="_blank" rel="noreferrer">
                        Open in Confluence
                      </a>
                    )}
                    {doc.preview && <a href={`#/runs/${runId}/documents/${doc.type}`}>Preview</a>}
                    {!doc.url && !doc.preview && <span className="muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dryRun && (
        <p className="muted">
          Confluence writes are in dry-run mode: nothing is written, and the table shows what a live publish
          would do.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <p className="actions">
        {set.running ? (
          <span className="muted">Writing and publishing the documents… this takes a few minutes.</span>
        ) : (
          <button
            type="button"
            className="go"
            disabled={!set.canPublish || busy}
            onClick={() => void publish()}
          >
            {published ? 'Publish again (rewrites the same pages)' : 'Generate and publish to Confluence'}
          </button>
        )}
      </p>
    </div>
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
