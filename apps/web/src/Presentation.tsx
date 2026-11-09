import { type Deck, type Presentation, presentationSchema } from '@ai-pm/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorText } from './api.js';
import { PublishButton } from './Documents.js';
import { FeatureTitle } from './FeatureTitle.js';

/**
 * The client deck: three 16:9 slides with a professional dark look and subtle game touches
 * (a running lane, coin accents, pixel steps, HUD counters). Same content as the PPTX.
 */

const LEVEL_CLASS: Record<string, string> = { critical: 'high', high: 'high', medium: 'medium', low: 'low' };

function Frame({
  deck,
  n,
  kicker,
  heading,
  children,
}: {
  deck: Deck;
  n: number;
  kicker: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="slide" aria-label={`Slide ${n}: ${kicker}`}>
      <span className="pixels" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p className="kicker">
        {String(n).padStart(2, '0')} · {kicker}
      </p>
      <h2>{heading}</h2>
      <div className="slide-body">{children}</div>
      <footer>
        <span>{deck.label}</span>
        <span>Preliminary AI-assisted assessment · not a delivery commitment</span>
      </footer>
    </section>
  );
}

function KpiChart({ chart }: { chart: Deck['opportunity']['chart'] }) {
  const max = Math.max(...chart.bars.map((b) => b.value), 0) || 1;
  return (
    <figure className="kpi-chart">
      <figcaption>{chart.kpi}: today and with the feature</figcaption>
      <div
        className="bars"
        role="img"
        aria-label={chart.bars.map((b) => `${b.label} ${b.display}`).join(', ')}
      >
        {chart.bars.map((b, i) => (
          <div key={b.label} className={`bar ${i === 0 ? 'today' : ''}`} title={`${b.label}: ${b.display}`}>
            <span className="value">{b.display}</span>
            <span className="fill" style={{ height: `${Math.max(4, (b.value / max) * 100)}%` }} />
            <span className="label">{b.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Slides({ deck }: { deck: Deck }) {
  const o = deck.opportunity;
  const s = deck.solution;
  const f = deck.feasibility;
  return [
    <Frame key="1" deck={deck} n={1} kicker="Business opportunity" heading={o.heading}>
      <div className="two-col">
        <dl className="panel coin">
          <dt>Primary objective</dt>
          <dd>{o.objective}</dd>
          <dt>Target KPI</dt>
          <dd>
            {o.targetKpi.name}
            <small>
              Today {o.targetKpi.baseline}
              {o.targetKpi.clientTarget ? ` · your target: ${o.targetKpi.clientTarget}` : ''}
            </small>
          </dd>
          <dt>Expected impact</dt>
          <dd>
            {o.impact.base}
            <small>Range {o.impact.range}</small>
          </dd>
          <dt>Target audience</dt>
          <dd>{o.audience}</dd>
          <dt>Business value</dt>
          <dd>
            {o.value.base}
            <small>
              {o.value.range} · {o.value.payback}
            </small>
          </dd>
        </dl>
        <div className="panel lane">
          <KpiChart chart={o.chart} />
          {o.caution && <p className="caution">⚑ {o.caution}</p>}
        </div>
      </div>
    </Frame>,
    <Frame key="2" deck={deck} n={2} kicker="Proposed solution & scope" heading={s.heading}>
      <ol className="flow">
        {s.flow.map((step, i) => (
          <li key={step} className={i === s.flow.length - 1 ? 'goal' : undefined}>
            <span className="dot">{i + 1}</span>
            <span className="step">{step}</span>
          </li>
        ))}
      </ol>
      <div className="capabilities">
        {s.capabilities.map((c) => (
          <div key={c.title} className="panel lane">
            <strong>{c.title}</strong>
            <span>{c.detail}</span>
          </div>
        ))}
      </div>
      <div className="hud">
        {s.counts.map((c) => (
          <div key={c.label}>
            <b>{c.value}</b>
            <span>{c.label}</span>
          </div>
        ))}
      </div>
      <p className="boundary">Not in this release: {s.boundary}</p>
    </Frame>,
    <Frame key="3" deck={deck} n={3} kicker="Delivery feasibility & recommendation" heading={f.heading}>
      <div className="tiles">
        <div className="panel lane">
          <h3>Estimated delivery · forecast range</h3>
          <b>{f.delivery.range}</b>
          <small>{f.delivery.detail}</small>
        </div>
        <div className="panel coin">
          <h3>Estimated budget · preliminary</h3>
          <b>{f.budget.range}</b>
          <small>{f.budget.detail}</small>
        </div>
        <div className="panel risk">
          <h3>Major risks</h3>
          {f.risks.note && <small>{f.risks.note}</small>}
          <ul>
            {f.risks.items.map((r) => (
              <li key={r.title} className={LEVEL_CLASS[r.level] ?? ''}>
                {r.title} <em>({r.level})</em>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel lane">
          <h3>Key dependencies</h3>
          <ul className="deps">
            {(f.dependencies.length ? f.dependencies : ['No external dependencies found']).map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className={`verdict ${f.verdict.decision}`}>
        <span className="badge">{f.verdict.label}</span>
        <p>{f.verdict.sentence}</p>
      </div>
    </Frame>,
  ];
}

/** #/runs/<id>/presentation/slides: the slide viewer with the PPTX download. */
export function PresentationView({ runId }: { runId: string }) {
  const [p, setP] = useState<Presentation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    api(`/api/runs/${runId}/presentation`, presentationSchema)
      .then(setP)
      .catch((err: unknown) => setError(errorText(err)));
  }, [runId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(2, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) return <p className="error">Could not load the presentation: {error}</p>;
  if (!p) return <p className="muted">Loading…</p>;
  const slides = Slides({ deck: p.deck });
  return (
    <>
      <p className="actions start">
        <a href={`#/runs/${runId}/presentation`}>← Back to the presentation</a>
      </p>
      <div className="deck-viewer">{slides[index]}</div>
      <div className="actions deck-nav">
        <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          ← Previous
        </button>
        <span className="muted">
          Slide {index + 1} of {slides.length}
        </span>
        <button type="button" disabled={index === slides.length - 1} onClick={() => setIndex(index + 1)}>
          Next →
        </button>
        <a className="button primary" href={`/api/runs/${runId}/presentation.pptx`}>
          Download PPTX
        </a>
      </div>
      {p.attachment && (
        <p className="muted">
          {p.attachment.fileName} in Confluence:{' '}
          {p.attachment.url ? (
            <a href={p.attachment.url} target="_blank" rel="noreferrer">
              {p.attachment.status.replace('_', ' ')}
            </a>
          ) : (
            p.attachment.status.replace('_', ' ')
          )}
        </p>
      )}
    </>
  );
}

/**
 * The chat card: the deck is ready, with the viewer, the PPTX, and the optional, one-time
 * "Publish to Confluence" (onto the Feature Brief, so only once the documents are published).
 * The run does not wait for it: the decision comes right after.
 */
export function PresentationCard({ runId, label, version = 0 }: { runId: string; label: string; version?: number }) {
  const [p, setP] = useState<Presentation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api(`/api/runs/${runId}/presentation`, presentationSchema)
      .then(setP)
      .catch(() => setP(null));
  }, [runId, label, version, tick]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/runs/${runId}/presentation/publish`, z.object({ ok: z.boolean() }), {
        method: 'POST',
        body: '{}',
      });
      setTick((t) => t + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const attachment = p?.attachment ?? null;
  return (
    <div className="card presentation-ready">
      <div className="card-head">
        <h3>Proposal ready: three slides</h3>
        <span className="tag neutral">Preliminary</span>
      </div>
      <p className="muted">{label}</p>
      {attachment?.url && (
        <p className="muted">
          {attachment.fileName} is on the Feature Brief in Confluence:{' '}
          <a href={attachment.url} target="_blank" rel="noreferrer">
            open it in Confluence
          </a>
          .
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions doc-actions">
        <a className="button light" href={`#/runs/${runId}/presentation/slides`}>
          View slides
        </a>
        <a className="button light" href={`/api/runs/${runId}/presentation.pptx`}>
          Download PPTX
        </a>
        {/* Optional and once: gone after the publish; the decision never waits for it. */}
        {p && !attachment && (
          <PublishButton
            id={`publish-deck-${runId}`}
            canPublish={p.canPublish}
            lockedReason={p.lockedReason}
            busy={busy}
            note="Optional"
            onPublish={() => void publish()}
          />
        )}
      </div>
    </div>
  );
}

/** #/runs/<id>/presentation: the Proposal card on its own. */
export function PresentationTab({ runId }: { runId: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api(`/api/runs/${runId}/presentation`, presentationSchema)
      .then((p) => setLabel(p.deck.label))
      .catch(() => setMissing(true));
  }, [runId]);
  return (
    <>
      <FeatureTitle runId={runId} />
      {label && <PresentationCard runId={runId} label={label} />}
      {missing && (
        <p className="card muted">
          No presentation yet. It is prepared after the documents step.
        </p>
      )}
    </>
  );
}
