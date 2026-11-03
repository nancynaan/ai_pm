import { type RunSummary, runSummarySchema } from '@ai-pm/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorText } from './api.js';
import { navigate } from './App.js';
import { STATE_LABEL } from './labels.js';

const EXAMPLE =
  'I want players to race against the "ghost" of a friend\'s best run, shown as a transparent runner in the same level, so they can compete without playing at the same time.';

export function ChatHome() {
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);

  useEffect(() => {
    api('/api/runs', z.array(runSummarySchema))
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const { runId } = await api('/api/runs', z.object({ runId: z.string() }), {
        method: 'POST',
        body: JSON.stringify({ description }),
      });
      navigate(`#/runs/${runId}`);
    } catch (err) {
      setError(errorText(err));
      setSending(false);
    }
  };

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>New feature request</h2>
          <span className="muted">You are the client</span>
        </div>
        <form onSubmit={(e) => void submit(e)} className="request">
          <label htmlFor="description" className="muted">
            Describe the feature you want in the game. The AI PM will ask a few questions and assess it.
          </label>
          <textarea
            id="description"
            rows={5}
            value={description}
            placeholder={EXAMPLE}
            onChange={(e) => setDescription(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" className="link" onClick={() => setDescription(EXAMPLE)}>
              Use the example
            </button>
            <button type="submit" className="primary" disabled={sending || description.trim().length < 10}>
              {sending ? 'Sending…' : 'Send to the AI PM'}
            </button>
          </div>
        </form>
      </section>

      {runs && runs.length > 0 && (
        <section className="card">
          <h2>Recent requests</h2>
          <ul className="runs">
            {runs.map((run) => (
              <li key={run.id}>
                <a href={`#/runs/${run.id}`}>{run.title}</a>
                <span className={`pill ${run.state}`}>{STATE_LABEL[run.state]}</span>
                <span className="muted">{new Date(run.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
