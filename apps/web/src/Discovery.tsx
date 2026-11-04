import {
  DISCOVERY_AREAS,
  type DiscoveryArea,
  type DiscoveryReport,
  type InformationKind,
  type Question,
  type Questionnaire,
} from '@ai-pm/shared';
import { type FormEvent, useState } from 'react';
import { z } from 'zod';
import { api, errorText } from './api.js';

const ok = z.object({ ok: z.boolean() });
const detailKey = (questionId: string, value: string) => `${questionId}:${value}`;

const AREA_LABEL: Record<DiscoveryArea, string> = {
  business_justification: 'Business justification',
  product_context: 'Product context',
  scope: 'First release',
  feasibility: 'Feasibility',
  decision_readiness: 'Decision-making',
};

function hint(q: Question) {
  if (q.kind === 'single') return 'Select one.';
  if (q.maxSelections === 1) return 'Select one.';
  if (q.maxSelections === 2) return 'Select up to two.';
  if (q.maxSelections) return `Select up to ${q.maxSelections}.`;
  return 'Select all that apply.';
}

/** Applies a click: single choice replaces, exclusive options clear the rest, excluded pairs swap. */
function nextSelection(q: Question, current: string[], value: string): string[] {
  const option = q.options.find((o) => o.value === value);
  if (!option) return current;
  if (q.kind === 'single') return [value];
  if (current.includes(value)) return current.filter((v) => v !== value);
  if (option.exclusive || value === 'not_sure') return [value];
  const kept = current.filter((v) => {
    const other = q.options.find((o) => o.value === v);
    return (
      !other?.exclusive &&
      v !== 'not_sure' &&
      !option.excludes?.includes(v) &&
      !other?.excludes?.includes(value)
    );
  });
  return [...kept, value];
}

export function QuestionnaireCard({ runId, questionnaire }: { runId: string; questionnaire: Questionnaire }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [details, setDetails] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const answeredCount = questionnaire.questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length;
  const complete = answeredCount === questionnaire.questions.length;

  const choose = (q: Question, value: string) =>
    setAnswers((prev) => ({ ...prev, [q.id]: nextSelection(q, prev[q.id] ?? [], value) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    // Only send details for options that are still selected.
    const selectedDetails = Object.fromEntries(
      Object.entries(details).filter(([key, text]) => {
        const [qid, value] = key.split(':');
        return text.trim() && answers[qid!]?.includes(value!);
      }),
    );
    try {
      await api(`/api/runs/${runId}/answers`, ok, {
        method: 'POST',
        body: JSON.stringify({
          questionnaireId: questionnaire.id,
          answers,
          details: selectedDetails,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      });
    } catch (err) {
      setError(errorText(err));
      setSending(false);
    }
  };

  const sections = questionnaire.sections?.length
    ? questionnaire.sections
    : [{ id: '', title: questionnaire.round > 1 ? 'Clarification' : 'A few questions' }];
  let number = 0;

  return (
    <form className="card questionnaire" onSubmit={(e) => void submit(e)}>
      <h3>{questionnaire.round > 1 ? 'Clarification questions' : 'Discovery questionnaire'}</h3>
      {sections.map((section) => {
        const questions = questionnaire.questions.filter((q) =>
          section.id ? q.section === section.id : true,
        );
        if (!questions.length) return null;
        return (
          <section key={section.id || 'all'} className="q-section">
            {questionnaire.sections?.length ? <h4>{section.title}</h4> : null}
            {'description' in section && section.description ? (
              <p className="muted small">{section.description}</p>
            ) : null}
            {questions.map((q) => {
              number++;
              const selected = answers[q.id] ?? [];
              const atLimit = q.kind === 'multi' && !!q.maxSelections && selected.length >= q.maxSelections;
              return (
                <fieldset key={q.id}>
                  <legend>
                    {number}. {q.text}
                  </legend>
                  <p className="muted small">
                    {hint(q)}
                    {q.why ? ` ${q.why}` : ''}
                  </p>
                  {q.options.map((option) => {
                    const checked = selected.includes(option.value);
                    const key = detailKey(q.id, option.value);
                    return (
                      <div key={option.value}>
                        <label className={`option${atLimit && !checked ? ' disabled' : ''}`}>
                          <input
                            type={q.kind === 'single' ? 'radio' : 'checkbox'}
                            name={q.id}
                            value={option.value}
                            checked={checked}
                            disabled={atLimit && !checked}
                            onChange={() => choose(q, option.value)}
                          />
                          {option.label}
                        </label>
                        {checked && option.detail && (
                          <input
                            className="detail"
                            type="text"
                            maxLength={1000}
                            placeholder={option.detail}
                            aria-label={option.detail}
                            value={details[key] ?? ''}
                            onChange={(e) => setDetails((prev) => ({ ...prev, [key]: e.target.value }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </fieldset>
              );
            })}
          </section>
        );
      })}
      {questionnaire.allowComment && (
        <section className="q-section">
          <h4>Additional comments (optional)</h4>
          <textarea
            rows={3}
            maxLength={3000}
            placeholder="Anything else that could help us assess the feature: expectations, concerns, context."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </section>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <span className="muted small">
          {answeredCount} of {questionnaire.questions.length} answered
        </span>
        <button type="submit" className="primary" disabled={!complete || sending}>
          {sending ? 'Sending…' : 'Send answers'}
        </button>
      </div>
    </form>
  );
}

const RESULT_LABEL: Record<DiscoveryReport['result'], string> = {
  complete: 'Complete',
  complete_with_assumptions: 'Complete with assumptions',
  needs_clarification: 'Needs clarification',
  insufficient: 'Insufficient',
};

const RESULT_TONE: Record<DiscoveryReport['result'], string> = {
  complete: 'ok',
  complete_with_assumptions: 'ok',
  needs_clarification: 'warn',
  insufficient: 'err',
};

const KIND_LABEL: Record<InformationKind, string> = {
  confirmed: 'Confirmed by you',
  client_assumption: 'Your assumptions (to validate)',
  ai_hypothesis: 'AI hypotheses (to validate)',
  missing: 'Missing information',
};

export function DiscoveryReportCard({ report }: { report: DiscoveryReport }) {
  const contradictions = report.contradictions;
  return (
    <div className="card report">
      <div className="card-head">
        <h3>Discovery completeness report{report.round > 1 ? ` (round ${report.round})` : ''}</h3>
        <span className={`tag ${RESULT_TONE[report.result]}`}>{RESULT_LABEL[report.result]}</span>
      </div>
      <p>{report.summary}</p>
      <p className="small">
        <strong>Confidence: {report.confidence}.</strong> {report.confidenceReason}
      </p>

      <table className="coverage">
        <tbody>
          {DISCOVERY_AREAS.map((area) => {
            const row = report.coverage.find((c) => c.area === area);
            if (!row) return null;
            return (
              <tr key={area}>
                <th scope="row">{AREA_LABEL[area]}</th>
                <td>
                  <span
                    className={`tag ${row.status === 'covered' ? 'ok' : row.status === 'partial' ? 'warn' : 'err'}`}
                  >
                    {row.status}
                  </span>
                </td>
                <td className="small">{row.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {contradictions.length > 0 && (
        <>
          <h4>Contradictions</h4>
          <ul>
            {contradictions.map((c) => (
              <li key={c.id}>
                <span className={`tag ${c.resolved ? 'ok' : c.severity === 'blocking' ? 'err' : 'warn'}`}>
                  {c.resolved ? 'resolved' : c.severity}
                </span>{' '}
                {c.text}
              </li>
            ))}
          </ul>
        </>
      )}

      {report.gaps.length > 0 && (
        <>
          <h4>Gaps</h4>
          <ul>
            {report.gaps.map((g) => (
              <li key={g.text}>
                {g.critical && <span className="tag err">critical</span>} {g.text}
              </li>
            ))}
          </ul>
        </>
      )}

      <details>
        <summary>What we know, what we assume, what is missing</summary>
        {(['confirmed', 'client_assumption', 'ai_hypothesis', 'missing'] as const).map((kind) => {
          const items = report.findings.filter((f) => f.kind === kind);
          return items.length ? (
            <div key={kind}>
              <h5>{KIND_LABEL[kind]}</h5>
              <ul>
                {items.map((f) => (
                  <li key={`${f.source}-${f.text}`}>{f.text}</li>
                ))}
              </ul>
            </div>
          ) : null;
        })}
      </details>

      <p className="small">
        <strong>Decision readiness:</strong> {report.readiness.note}
      </p>
      <p className="next-action">
        <strong>Next:</strong> {report.nextAction.text}
      </p>
    </div>
  );
}

export function DiscoveryDecisionCard({ runId }: { runId: string }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const decide = async (proceed: boolean) => {
    setSending(true);
    setError(null);
    try {
      await api(`/api/runs/${runId}/discovery-decision`, ok, {
        method: 'POST',
        body: JSON.stringify({ proceed, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
      });
    } catch (err) {
      setError(errorText(err));
      setSending(false);
    }
  };

  return (
    <div className="card decision">
      <h3>How do you want to continue?</h3>
      <p className="small">
        A preliminary assessment uses the documented assumptions for the open points. Every figure that
        depends on them is marked preliminary until the open points are settled.
      </p>
      <textarea
        rows={2}
        maxLength={2000}
        placeholder="Optional: anything that helps with the open points"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" disabled={sending} onClick={() => void decide(false)}>
          Stop for now
        </button>
        <button type="button" className="primary" disabled={sending} onClick={() => void decide(true)}>
          Continue with a preliminary assessment
        </button>
      </div>
    </div>
  );
}
