import { type HealthReport, healthReportSchema } from '@ai-pm/shared';
import { useCallback, useEffect, useState } from 'react';

const STATUS_TEXT: Record<string, string> = {
  ok: 'OK',
  degraded: 'Needs configuration',
  error: 'Problem',
  not_configured: 'Not configured',
};

export function App() {
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
    <main>
      <header>
        <h1>AI PM</h1>
        <p>System status. The client ↔ AI PM chat arrives in Phase 2.</p>
      </header>

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
    </main>
  );
}
