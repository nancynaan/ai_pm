import {
  type RunState,
  type RunSummary,
  runSummarySchema,
  STAGES,
  type StoredRunEvent,
  storedRunEventSchema,
} from '@ai-pm/shared';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorText } from './api.js';
import { DiscoveryDecisionCard, DiscoveryReportCard, QuestionnaireCard } from './Discovery.js';
import { STATE_LABEL } from './labels.js';
import { RichText } from './RichText.js';

/** Position of each state on the 7-step timeline; stages before it are done. */
const POSITION: Record<RunState, number> = {
  intake: 0,
  awaiting_answers: 1,
  eliciting: 1,
  awaiting_confirmation: 1,
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
  if (state === 'awaiting_answers' || state === 'awaiting_decision' || state === 'awaiting_confirmation')
    return 'waiting';
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

  // The discovery decision belongs to the latest report.
  const lastReportId = [...events].reverse().find((e) => e.event.type === 'discovery_report')?.id;

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
          <EventItem key={stored.id} stored={stored} run={run} lastReportId={lastReportId} />
        ))}
        {run.state === 'completed' && <p className="banner ok">This feature request is complete.</p>}
        {run.state === 'declined' && (
          <p className="banner">The feature request was stopped. Nothing was added to the backlog.</p>
        )}
        {run.state === 'failed' && <FailedBanner run={run} />}
      </section>

      <p className="actions">
        <a href="#/">New feature request</a>
      </p>
    </>
  );
}

function EventItem({
  stored,
  run,
  lastReportId,
}: {
  stored: StoredRunEvent;
  run: RunSummary;
  lastReportId: number | undefined;
}) {
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
          {event.questionnaire.round > 1 ? 'Clarification' : 'Questionnaire'} with{' '}
          {event.questionnaire.questions.length} questions answered.
        </p>
      );
    case 'discovery_report':
      return (
        <>
          <DiscoveryReportCard report={event.report} />
          {run.state === 'awaiting_confirmation' && stored.id === lastReportId && (
            <DiscoveryDecisionCard runId={run.id} />
          )}
        </>
      );
    case 'assessment_ready':
      return (
        <div className="card assessment-ready">
          <div className="card-head">
            <h3>Assessment ready</h3>
            <span
              className={`tag ${event.decision === 'go' ? 'ok' : event.decision === 'no_go' ? 'err' : 'warn'}`}
            >
              <span aria-hidden="true">
                {event.decision === 'go' ? '✓' : event.decision === 'no_go' ? '✕' : '!'}
              </span>{' '}
              {event.label}
            </span>
          </div>
          <ul>
            {event.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="actions">
            <a className="button primary" href={`#/analysis/${run.id}`}>
              Open on the Analysis tab
            </a>
          </p>
        </div>
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
