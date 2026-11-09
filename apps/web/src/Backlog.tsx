import { type Backlog, backlogSchema } from '@ai-pm/shared';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { FeatureTitle } from './FeatureTitle.js';

/** Tells the header to look for the Backlog tab again (the chat sends it when the run completes). */
export const BACKLOG_CHANGED = 'aipm:backlog-changed';

const KIND: Record<string, string> = {
  story: 'Story',
  enabler: 'Enabler',
  nfr: 'NFR',
  spike: 'Spike',
};

/**
 * The approved feature's backlog in Jira: the Epic link and its stories, an AI draft for the
 * Product Owner's review. Shown in the chat under the backlog step and on the Backlog tab.
 */
export function BacklogCard({ runId, version = '' }: { runId: string; version?: string }) {
  const [backlog, setBacklog] = useState<Backlog | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api(`/api/runs/${runId}/backlog`, backlogSchema)
      .then((b) => {
        setBacklog(b);
        setError(false);
      })
      .catch(() => setError(true));
  }, [runId, version]);

  if (!backlog) return error ? null : <p className="muted">Loading the backlog…</p>;
  const { epic, stories } = backlog;
  const dryRun = backlog.mode === 'dry-run';

  return (
    <div className="card backlog">
      <div className="card-head">
        <h3>Backlog in Jira{epic?.jiraKey ? ` · ${epic.jiraKey}` : ''}</h3>
        <span className={`tag ${dryRun ? 'warn' : 'neutral'}`}>{dryRun ? 'Dry-run' : 'AI draft'}</span>
      </div>
      <p>
        {dryRun ? 'A live run would create' : 'The Epic'} <strong>{epic?.summary}</strong>{' '}
        {dryRun
          ? `with ${stories.length} stories.`
          : `and its ${stories.length} stories are in the Product Backlog.`}
      </p>
      <p className="muted">
        Status To Do, label ai-draft, no sprint. Priorities are proposed and Story Points are left empty: the
        Product Owner reviews and orders the stories, and the team refines and estimates them in Backlog
        Refinement.
      </p>
      <details>
        <summary>Stories ({stories.length})</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Story</th>
                <th>Proposed priority</th>
                <th>AI estimate (SP)</th>
              </tr>
            </thead>
            <tbody>
              {stories.map((s) => (
                <tr key={s.localId}>
                  <td>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.jiraKey}
                      </a>
                    ) : (
                      <span className="muted">{s.localId}</span>
                    )}
                  </td>
                  <td>
                    {s.summary}
                    <div className="detail">
                      {KIND[s.type] ?? s.type}
                      {s.blockedBy.length ? ` · blocked by ${s.blockedBy.join(', ')}` : ''}
                    </div>
                  </td>
                  <td>{s.priority ?? '—'}</td>
                  <td>{s.aiEstimate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="actions">
        {backlog.confluenceUrl && (
          <a className="button" href={backlog.confluenceUrl} target="_blank" rel="noreferrer">
            Initial Product Backlog
          </a>
        )}
        {epic?.url && (
          <a className="button go" href={epic.url} target="_blank" rel="noreferrer">
            Open the Epic in Jira
          </a>
        )}
      </p>
    </div>
  );
}

/** #/runs/<id>/backlog: the backlog card on its own. */
export function BacklogTab({ runId }: { runId: string }) {
  return (
    <>
      <FeatureTitle runId={runId} />
      <BacklogCard runId={runId} />
    </>
  );
}

/** Whether the feature has a backlog in Jira; rechecked when the chat says it changed. */
export function useHasBacklog(runId: string | null): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!runId) return setHas(false);
    let live = true;
    const check = () =>
      api(`/api/runs/${runId}/backlog`, backlogSchema)
        .then((b) => live && setHas(b.epic !== null))
        .catch(() => live && setHas(false));
    void check();
    window.addEventListener(BACKLOG_CHANGED, check);
    return () => {
      live = false;
      window.removeEventListener(BACKLOG_CHANGED, check);
    };
  }, [runId]);
  return has;
}
