import { type RunLog, runLogSchema, type RunState, type RunSummary, runSummarySchema } from '@ai-pm/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorText } from './api.js';
import { STATE_LABEL } from './labels.js';

/** Stage attempt status → the pill colours the health table uses. */
const PILL: Record<string, string> = {
  succeeded: 'ok',
  failed: 'error',
  paused: 'degraded',
  interrupted: 'degraded',
  running: 'not_configured',
};

const seconds = (ms: number | null) => (ms === null ? '–' : ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`);
const thousands = (n: number) => n.toLocaleString('en-US');

/**
 * The Run log on the System status page: each feature's stage attempts with their time,
 * outcome and Claude calls (tokens, repairs, usage-limit pauses). Numbers only, no prompt text.
 */
export function RunLogs() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api('/api/runs', z.array(runSummarySchema))
      .then(setRuns)
      .catch((err: unknown) => setError(errorText(err)));
  }, []);

  return (
    <section className="card run-log">
      <div className="card-head">
        <h2>Run log</h2>
      </div>
      <p className="muted">
        Each feature&apos;s steps with their time, outcome and Claude calls. A repair is a call whose answer
        failed a check and was asked again; a pause waits for the subscription&apos;s usage limit to reset.
      </p>
      {error && <p className="error">Could not load the runs: {error}</p>}
      {runs?.length === 0 && <p className="detail">No feature requests yet.</p>}
      {runs?.map((run) => (
        <RunLogEntry key={run.id} run={run} />
      ))}
    </section>
  );
}

function RunLogEntry({ run }: { run: RunSummary }) {
  const [log, setLog] = useState<RunLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || log) return;
    api(`/api/runs/${run.id}/log`, runLogSchema)
      .then(setLog)
      .catch((err: unknown) => setError(errorText(err)));
  }, [open, log, run.id]);

  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="run-log-title">{run.title}</span>{' '}
        <span className="muted">· {STATE_LABEL[run.state as RunState] ?? run.state}</span>
      </summary>
      {error && <p className="error">{error}</p>}
      {log && (
        <>
          <div className="table-wide">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Status</th>
                  <th className="num">Time</th>
                  <th className="num">Calls</th>
                  <th className="num">Tokens</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {log.stages.map((s, i) => {
                  const tokens = s.calls.reduce((n, c) => n + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0);
                  const repairs = s.calls.filter((c) => c.status === 'invalid_output').length;
                  // A step seen before: a retry after a failure, or a re-run (e.g. a re-publish).
                  const before = log.stages.slice(0, i).findLast((x) => x.stage === s.stage);
                  const notes = [
                    before ? (before.status === 'failed' ? 'retry' : 're-run') : null,
                    repairs ? `${repairs} repair${repairs > 1 ? 's' : ''}` : null,
                    s.error,
                  ].filter(Boolean);
                  return (
                    <tr key={`${s.stage}-${s.startedAt}-${i}`}>
                      <td>{STATE_LABEL[s.stage as RunState] ?? s.stage}</td>
                      <td>
                        <span className={`pill ${PILL[s.status] ?? 'not_configured'}`}>{s.status}</span>
                      </td>
                      <td className="num">{seconds(s.durationMs)}</td>
                      <td className="num">{s.calls.length || '–'}</td>
                      <td className="num">{tokens ? thousands(tokens) : '–'}</td>
                      <td className="detail">{notes.join('; ') || '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="meta">
            {log.totals.calls} Claude calls ({log.totals.repairs} repairs, {log.totals.limitPauses} usage-limit
            pauses, {log.totals.errors} errors), {thousands(log.totals.inputTokens + log.totals.outputTokens)}{' '}
            tokens, {seconds(log.totals.callMs)} in calls
          </p>
        </>
      )}
      {open && !log && !error && <p className="muted">Loading…</p>}
    </details>
  );
}
