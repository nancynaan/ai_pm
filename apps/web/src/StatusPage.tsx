import {
  type BaselineSummary,
  baselineSummarySchema,
  type HealthReport,
  healthReportSchema,
} from '@ai-pm/shared';
import { useCallback, useEffect, useState } from 'react';

const STATUS_TEXT: Record<string, string> = {
  ok: 'OK',
  degraded: 'Needs configuration',
  error: 'Problem',
  not_configured: 'Not configured',
};

export function StatusPage() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/health');
      setReport(healthReportSchema.parse(await response.json()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <>
      <section className="card" aria-busy={loading}>
        <div className="card-head">
          <h2>
            Overall {report && <span className={`pill ${report.status}`}>{STATUS_TEXT[report.status]}</span>}
          </h2>
          <button type="button" onClick={() => void check()} disabled={loading}>
            {loading ? 'Checking…' : 'Check again'}
          </button>
        </div>

        {error && <p className="error">Could not reach the server: {error}</p>}

        {report && (
          <table>
            <thead>
              <tr>
                <th>Dependency</th>
                <th>Status</th>
                <th>Details</th>
                <th className="num">Time</th>
              </tr>
            </thead>
            <tbody>
              {report.checks.map((c) => (
                <tr key={c.name}>
                  <td>{c.label}</td>
                  <td>
                    <span className={`pill ${c.status}`}>{STATUS_TEXT[c.status]}</span>
                  </td>
                  <td className="detail">{c.detail}</td>
                  <td className="num">{c.latencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {report && (
          <p className="meta">
            Server {report.version}, checked {new Date(report.checkedAt).toLocaleTimeString()}
          </p>
        )}
      </section>

      <Baseline />
    </>
  );
}

const SEED_COMMAND = 'docker compose exec app node apps/server/dist/baseline/cli.js';

function Baseline() {
  const [summary, setSummary] = useState<BaselineSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/baseline')
      .then(async (response) => setSummary(baselineSummarySchema.parse(await response.json())))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const published = summary?.artifacts.filter((a) => a.url).length ?? 0;

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          Project baseline {summary?.project && <span className="muted">· {summary.project.name}</span>}
        </h2>
      </div>

      {error && <p className="error">Could not load the baseline: {error}</p>}

      {summary && !summary.project && (
        <p className="detail">
          No baseline yet. Seed the demo project with <code>{SEED_COMMAND}</code> (dry-run), then add{' '}
          <code>--live</code> to write it to Jira and Confluence.
        </p>
      )}

      {summary?.project && (
        <>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Confluence</th>
                <th className="num">Version</th>
              </tr>
            </thead>
            <tbody>
              {summary.artifacts.map((a) => (
                <tr key={a.type}>
                  <td>{a.url ? <a href={a.url}>{a.title}</a> : a.title}</td>
                  <td>
                    <span className={`pill ${a.url ? 'ok' : 'not_configured'}`}>
                      {a.url ? 'Published' : 'Not published'}
                    </span>
                  </td>
                  <td className="num">{a.version ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="meta">
            {published} of {summary.artifacts.length} documents published
            {summary.project.syncedAt && `, saved ${new Date(summary.project.syncedAt).toLocaleString()}`}
          </p>
          {summary.digest && (
            <details>
              <summary>Digest the agents receive</summary>
              <pre>{summary.digest}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
