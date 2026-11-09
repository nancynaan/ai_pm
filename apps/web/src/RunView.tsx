import {
  documentSetSchema,
  type RunState,
  type RunSummary,
  runSummarySchema,
  STAGES,
  type StoredRunEvent,
  storedRunEventSchema,
} from '@ai-pm/shared';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorText } from './api.js';
import { DiscoveryDecisionCard, DiscoveryReportCard, QuestionnaireCard } from './Discovery.js';
import { BACKLOG_CHANGED, BacklogCard } from './Backlog.js';
import { DocumentsCard } from './Documents.js';
import { PresentationCard } from './Presentation.js';
import { STATE_LABEL } from './labels.js';
import { RichText } from './RichText.js';
import { StepWaitingCard } from './Waiting.js';

/** Position of each state on the 7-step timeline; stages before it are done. */
const POSITION: Record<RunState, number> = {
  intake: 0,
  awaiting_answers: 1,
  eliciting: 1,
  awaiting_confirmation: 1,
  analyzing: 2,
  estimating: 3,
  awaiting_documents: 4,
  documenting: 4,
  presenting: 5,
  awaiting_decision: 5, // the decision belongs to the presentation step
  backlog: 6,
  completed: 7,
  declined: 6,
  failed: 0,
};

type StepStatus = 'done' | 'active' | 'waiting' | 'failed' | 'pending' | 'stopped';

function stepStatus(index: number, run: RunSummary): StepStatus {
  const state = run.state;
  if (state === 'failed') {
    const at = POSITION[run.failedState ?? 'intake'];
    return index < at ? 'done' : index === at ? 'failed' : 'pending';
  }
  const at = POSITION[state];
  if (index < at) return 'done';
  if (index > at) return 'pending';
  // Declined: the backlog step can never start.
  if (state === 'declined') return 'stopped';
  if (
    state === 'awaiting_answers' ||
    state === 'awaiting_decision' ||
    state === 'awaiting_confirmation' ||
    state === 'awaiting_documents'
  )
    return 'waiting';
  return 'active';
}

export function RunView({ runId }: { runId: string }) {
  const [events, setEvents] = useState<StoredRunEvent[]>([]);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on state changes and document events, so the Documents card reloads.
  const [docsVersion, setDocsVersion] = useState(0);

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
      // A step's block that was published again keeps its id: update it where it is.
      setEvents((prev) =>
        prev.some((e) => e.id === stored.id)
          ? prev.map((e) => (e.id === stored.id ? stored : e))
          : [...prev, stored],
      );
      if (stored.event.type === 'state' || stored.event.type === 'questionnaire') refresh();
      if (stored.event.type === 'state' || stored.event.type === 'documents') setDocsVersion((v) => v + 1);
      // The header shows the Backlog tab once the backlog is in Jira.
      if (stored.event.type === 'backlog_ready' || stored.event.type === 'state')
        window.dispatchEvent(new Event(BACKLOG_CHANGED));
    });
    return () => source.close();
  }, [runId, refresh]);

  // The discovery decision belongs to the latest report.
  const lastReportId = [...events].reverse().find((e) => e.event.type === 'discovery_report')?.id;
  // The Documents card sits below the client's request to publish them, or below the latest
  // assessment until that request exists.
  const documentsAnchorId =
    [...events].reverse().find((e) => e.key === 'documents.request' || e.key === 'documents.request.late')
      ?.id ?? [...events].reverse().find((e) => e.event.type === 'assessment_ready')?.id;
  // Only the latest decision card takes a decision; earlier ones are history.
  const lastDecisionId = [...events].reverse().find((e) => e.event.type === 'decision_requested')?.id;
  // A step paused at the usage limit says so on its placeholder card.
  const lastStage = [...events].reverse().find((e) => e.event.type === 'stage')?.event;
  const paused =
    run && lastStage?.type === 'stage' && lastStage.stage === run.state && lastStage.status === 'paused'
      ? `Paused at the Claude usage limit; it resumes by itself${lastStage.detail ? ` (${lastStage.detail})` : ''}.`
      : null;

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
          <Fragment key={stored.id}>
            <EventItem
              stored={stored}
              run={run}
              lastReportId={lastReportId}
              lastDecisionId={lastDecisionId}
              docsVersion={docsVersion}
            />
            {stored.id === documentsAnchorId && <DocumentsCard runId={run.id} version={docsVersion} />}
          </Fragment>
        ))}
        {/* While a step works, a placeholder stands where its result will appear. */}
        <StepWaitingCard state={run.state} paused={paused} />
        {run.state === 'completed' && (
          <p className="banner ok">
            Approved: the Epic and its stories are in the Product Backlog. This conversation is closed.
          </p>
        )}
        {run.state === 'declined' && (
          <p className="banner stopped">
            Declined: nothing was added to the backlog. This conversation is closed.
          </p>
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
  lastDecisionId,
  docsVersion,
}: {
  stored: StoredRunEvent;
  run: RunSummary;
  lastReportId: number | undefined;
  lastDecisionId: number | undefined;
  docsVersion: number;
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
              {event.label}
            </span>
          </div>
          <ul>
            {event.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="actions">
            <a className="button go" href={`#/runs/${run.id}/analysis`}>
              Open the Analysis tab
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
          open={run.state === 'awaiting_decision' && stored.id === lastDecisionId}
          docsVersion={docsVersion}
        />
      );
    case 'stage':
      return event.status === 'retrying' || event.status === 'paused' || event.status === 'failed' ? (
        <p className={`system ${event.status}`}>
          {STAGES.find((s) => s.state === event.stage)?.label ?? event.stage} {event.status}
          {event.detail ? `: ${event.detail}` : ''}
        </p>
      ) : null;
    case 'presentation_ready':
      return <PresentationCard runId={run.id} label={event.label} version={docsVersion} />;
    case 'backlog_ready':
      return <BacklogCard runId={run.id} version={JSON.stringify(event)} />;
    case 'state':
    case 'documents':
      return null;
  }
}

function DecisionCard({
  runId,
  verdict,
  highlights,
  open,
  docsVersion,
}: {
  runId: string;
  verdict: string;
  highlights: string[];
  open: boolean;
  docsVersion: number;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Approve needs the documents in Confluence; rechecked when they change.
  const [docsPublished, setDocsPublished] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open) return;
    api(`/api/runs/${runId}/documents`, documentSetSchema)
      .then((set) => setDocsPublished(set.publishedAt !== null))
      .catch(() => setDocsPublished(null));
  }, [runId, open, docsVersion]);
  const approveLocked = docsPublished === false;

  const decide = async (decision: 'approve' | 'decline') => {
    setSending(true);
    setError(null);
    try {
      await api(`/api/runs/${runId}/decision`, z.object({ ok: z.boolean() }), {
        method: 'POST',
        body: JSON.stringify({ decision, comment: comment.trim() || undefined }),
      });
    } catch (err) {
      // A locked Approve is answered in the chat (what to do first); other errors show here.
      if (!(decision === 'approve' && approveLocked)) setError(errorText(err));
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
            <button type="button" className="stop" disabled={sending} onClick={() => void decide('decline')}>
              Decline
            </button>
            {approveLocked ? (
              // Still clickable, so the chat explains what to do; the hint says it on hover.
              <span className="hint-wrap">
                <button
                  type="button"
                  className="go locked"
                  aria-disabled="true"
                  aria-describedby={`approve-hint-${runId}`}
                  disabled={sending}
                  onClick={() => void decide('approve')}
                >
                  Approve
                </button>
                <span role="tooltip" id={`approve-hint-${runId}`} className="hint">
                  Publish the documents to proceed.
                </span>
              </span>
            ) : (
              <button type="button" className="go" disabled={sending} onClick={() => void decide('approve')}>
                Approve
              </button>
            )}
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
