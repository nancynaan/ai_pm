import {
  type Questionnaire,
  type RunState,
  type RunSummary,
  runSummarySchema,
  STAGES,
  type StoredRunEvent,
  storedRunEventSchema,
} from '@ai-pm/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorText } from './api.js';
import { STATE_LABEL } from './labels.js';
import { RichText } from './RichText.js';

/** Position of each state on the 7-step timeline; stages before it are done. */
const POSITION: Record<RunState, number> = {
  intake: 0,
  awaiting_answers: 1,
  eliciting: 1,
  analyzing: 2,
  estimating: 3,
  documenting: 4,
  presenting: 5,
  awaiting_decision: 6,
  backlog: 6,
  completed: 7,
  declined: 6,
  failed: 0,
};

type StepStatus = 'done' | 'active' | 'waiting' | 'failed' | 'pending' | 'skipped';

function stepStatus(index: number, run: RunSummary): StepStatus {
  const state = run.state;
  if (state === 'failed') {
    const at = POSITION[run.failedState ?? 'intake'];
    return index < at ? 'done' : index === at ? 'failed' : 'pending';
  }
  const at = POSITION[state];
  if (index < at) return 'done';
  if (index > at) return 'pending';
  if (state === 'declined') return 'skipped';
  if (state === 'awaiting_answers' || state === 'awaiting_decision') return 'waiting';
  return 'active';
}

export function RunView({ runId }: { runId: string }) {
  const [events, setEvents] = useState<StoredRunEvent[]>([]);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api(`/api/runs/${runId}`, runSummarySchema)
      .then(setRun)
      .catch((err: unknown) => setError(errorText(err)));
  }, [runId]);

  useEffect(() => {
    refresh();
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.addEventListener('run', (message) => {
      const stored = storedRunEventSchema.parse(JSON.parse((message as MessageEvent<string>).data));
      setEvents((prev) => (prev.some((e) => e.id === stored.id) ? prev : [...prev, stored]));
      if (stored.event.type === 'state' || stored.event.type === 'questionnaire') refresh();
    });
    return () => source.close();
  }, [runId, refresh]);

  if (error) return <p className="error">Could not load the run: {error}</p>;
  if (!run) return <p className="muted">Loading…</p>;

  return (
    <>
      <section className="card run-head">
        <div className="card-head">
          <h2>{run.title}</h2>
          <span className={`pill ${run.state}`}>{STATE_LABEL[run.state]}</span>
        </div>
        <ol className="timeline">
          {STAGES.map((stage, index) => (
            <li key={stage.state} className={stepStatus(index, run)}>
              <span className="dot" aria-hidden="true" />
              {stage.label}
            </li>
          ))}
        </ol>
      </section>

      <section className="chat" aria-live="polite">
        {events.map((stored) => (
          <EventItem key={stored.id} stored={stored} run={run} />
        ))}
        {run.state === 'completed' && <p className="banner ok">This feature request is complete.</p>}
        {run.state === 'declined' && (
          <p className="banner">The feature was declined. Nothing was added to the backlog.</p>
        )}
        {run.state === 'failed' && <FailedBanner run={run} />}
      </section>

      <p className="actions">
        <a href="#/">New feature request</a>
      </p>
    </>
  );
}

function EventItem({ stored, run }: { stored: StoredRunEvent; run: RunSummary }) {
  const { event } = stored;
  switch (event.type) {
    case 'message':
      return (
        <div className={`bubble ${event.role}`}>
          <span className="who">{event.role === 'client' ? 'You (client)' : 'AI PM'}</span>
          <RichText text={event.text} />
        </div>
      );
    case 'questionnaire':
      return run.pendingQuestionnaire?.id === event.questionnaire.id ? (
        <QuestionnaireCard runId={run.id} questionnaire={event.questionnaire} />
      ) : (
        <p className="system">
          Questionnaire with {event.questionnaire.questions.length} questions answered.
        </p>
      );
    case 'decision_requested':
      return (
        <DecisionCard
          runId={run.id}
          verdict={event.verdict}
          highlights={event.highlights}
          open={run.state === 'awaiting_decision'}
        />
      );
    case 'stage':
      return event.status === 'retrying' || event.status === 'paused' || event.status === 'failed' ? (
        <p className={`system ${event.status}`}>
          {STAGES.find((s) => s.state === event.stage)?.label ?? event.stage} {event.status}
          {event.detail ? `: ${event.detail}` : ''}
        </p>
      ) : null;
    case 'state':
      return null;
  }
}

function QuestionnaireCard({ runId, questionnaire }: { runId: string; questionnaire: Questionnaire }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const complete = questionnaire.questions.every((q) => (answers[q.id]?.length ?? 0) > 0);

  const toggle = (questionId: string, value: string, single: boolean) =>
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      const next = single
        ? [value]
        : current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
      return { ...prev, [questionId]: next };
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api(`/api/runs/${runId}/answers`, z.object({ ok: z.boolean() }), {
        method: 'POST',
        body: JSON.stringify({ questionnaireId: questionnaire.id, answers }),
      });
    } catch (err) {
      setError(errorText(err));
      setSending(false);
    }
  };

  return (
    <form className="card questionnaire" onSubmit={(e) => void submit(e)}>
      <h3>A few questions</h3>
      {questionnaire.questions.map((q) => (
        <fieldset key={q.id}>
          <legend>{q.text}</legend>
          {q.why && <p className="muted small">{q.why}</p>}
          {q.options.map((option) => (
            <label key={option.value} className="option">
              <input
                type={q.kind === 'single' ? 'radio' : 'checkbox'}
                name={q.id}
                value={option.value}
                checked={answers[q.id]?.includes(option.value) ?? false}
                onChange={() => toggle(q.id, option.value, q.kind === 'single')}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ))}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={!complete || sending}>
          {sending ? 'Sending…' : 'Send answers'}
        </button>
      </div>
    </form>
  );
}

function DecisionCard({
  runId,
  verdict,
  highlights,
  open,
}: {
  runId: string;
  verdict: string;
  highlights: string[];
  open: boolean;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const decide = async (decision: 'approve' | 'changes' | 'decline') => {
    setSending(true);
    setError(null);
    try {
      await api(`/api/runs/${runId}/decision`, z.object({ ok: z.boolean() }), {
        method: 'POST',
        body: JSON.stringify({ decision, comment: comment.trim() || undefined }),
      });
    } catch (err) {
      setError(errorText(err));
      setSending(false);
    }
  };

  return (
    <div className="card decision">
      <h3>
        Assessment: <span className="verdict">{verdict}</span>
      </h3>
      <ul>
        {highlights.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      {open && (
        <>
          <textarea
            rows={2}
            placeholder="Optional comment for the team"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" disabled={sending} onClick={() => void decide('decline')}>
              Decline
            </button>
            <button type="button" disabled={sending} onClick={() => void decide('changes')}>
              Request changes
            </button>
            <button
              type="button"
              className="primary"
              disabled={sending}
              onClick={() => void decide('approve')}
            >
              Approve
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function FailedBanner({ run }: { run: RunSummary }) {
  const [error, setError] = useState<string | null>(null);
  const retry = () =>
    api(`/api/runs/${run.id}/retry`, z.object({ ok: z.boolean() }), { method: 'POST' }).catch(
      (err: unknown) => setError(errorText(err)),
    );
  return (
    <div className="banner failed">
      <p>
        The {STAGES.find((s) => s.state === run.failedState)?.label ?? 'last'} stage failed: {run.error}
      </p>
      {error && <p className="error">{error}</p>}
      <button type="button" onClick={() => void retry()}>
        Retry
      </button>
    </div>
  );
}
