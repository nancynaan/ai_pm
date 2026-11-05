import { type MouseEvent, type ReactNode, useRef, useState } from 'react';

/**
 * Small SVG charts for the Analysis tab: thin marks, rounded data ends, recessive axes, a hover
 * tooltip on every chart, and a legend whenever there is more than one series. Colors come from
 * CSS tokens (--series-n, --status-*), so light and dark modes are both defined in styles.css.
 */

export const compactUsd = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
};

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

/** A positioned container whose children can show a tooltip at the pointer. */
function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: MouseEvent, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  };
  const hide = () => setTip(null);
  const layer = tip ? (
    <div
      className="chart-tip"
      role="status"
      style={{
        left: Math.min(tip.x + 12, (ref.current?.clientWidth ?? 400) - 190),
        top: Math.max(0, tip.y - 12),
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { ref, show, hide, layer };
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

/** Column path with a 4px rounded top and a square base. */
function column(x: number, y: number, w: number, h: number) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ---- forecast histogram ---------------------------------------------------------------------

export function SprintHistogram({
  title,
  histogram,
  p50,
  p85,
  deadlineSprint,
  dateOf,
}: {
  title: string;
  histogram: { sprints: number; share: number }[];
  p50: number;
  p85: number;
  /** Sprint count that still meets the deadline, if there is one. */
  deadlineSprint: number | null;
  dateOf: (sprints: number) => string;
}) {
  const tip = useTooltip();
  const W = 420;
  const H = 190;
  const pad = { l: 36, r: 8, t: 18, b: 34 };
  const min = Math.max(1, Math.min(...histogram.map((h) => h.sprints), p50, deadlineSprint ?? Infinity));
  const max = Math.max(...histogram.map((h) => h.sprints), p85, deadlineSprint ?? 0);
  const n = max - min + 1;
  const band = (W - pad.l - pad.r) / n;
  const bar = Math.min(24, band - 2);
  const top = niceMax(Math.max(...histogram.map((h) => h.share)));
  const y = (share: number) => pad.t + (H - pad.t - pad.b) * (1 - share / top);
  const xOf = (s: number) => pad.l + (s - min) * band + (band - bar) / 2;
  const centre = (s: number) => pad.l + (s - min) * band + band / 2;
  let cumulative = 0;
  const cum = new Map(histogram.map((h) => [h.sprints, (cumulative += h.share)]));
  return (
    <figure className="chart" ref={tip.ref} onMouseLeave={tip.hide}>
      <figcaption>{title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}: P50 ${p50} sprints, P85 ${p85} sprints`}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} />
            <text className="tick" x={pad.l - 6} y={y(top * f) + 4} textAnchor="end">
              {Math.round(top * f * 100)}%
            </text>
          </g>
        ))}
        {histogram.map((h) => (
          <path
            key={h.sprints}
            className="mark-1"
            d={column(xOf(h.sprints), y(h.share), bar, H - pad.b - y(h.share))}
          />
        ))}
        {/* The whole band is the hover target, not just the thin bar. */}
        {histogram.map((h) => (
          <rect
            key={`hit-${h.sprints}`}
            x={pad.l + (h.sprints - min) * band}
            y={pad.t}
            width={band}
            height={H - pad.t - pad.b}
            fill="transparent"
            onMouseMove={(e) =>
              tip.show(
                e,
                <>
                  <strong>
                    {h.sprints} sprint{h.sprints === 1 ? '' : 's'}
                  </strong>{' '}
                  (done by {dateOf(h.sprints)})
                  <br />
                  {(h.share * 100).toFixed(1)} % of trials · {Math.round((cum.get(h.sprints) ?? 0) * 100)} %
                  done by then
                </>,
              )
            }
          />
        ))}
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
        {Array.from({ length: n }, (_, i) => min + i).map((s) => (
          <text key={s} className="tick" x={centre(s)} y={H - pad.b + 14} textAnchor="middle">
            {s}
          </text>
        ))}
        <text className="tick" x={(W + pad.l) / 2} y={H - 4} textAnchor="middle">
          sprints
        </text>
        {[
          { s: p50, label: 'P50' },
          { s: p85, label: 'P85' },
        ].map((m, i) => (
          <g key={m.label}>
            <line className="marker" x1={centre(m.s)} x2={centre(m.s)} y1={pad.t - 4} y2={H - pad.b} />
            <text
              className="tick strong"
              x={centre(m.s) + (i && p50 === p85 ? 22 : 0)}
              y={pad.t - 6}
              textAnchor="middle"
            >
              {m.label}
            </text>
          </g>
        ))}
        {deadlineSprint !== null && (
          <g>
            <line
              className="deadline"
              x1={centre(deadlineSprint) + band / 2}
              x2={centre(deadlineSprint) + band / 2}
              y1={pad.t}
              y2={H - pad.b}
            />
            <text className="tick" x={centre(deadlineSprint) + band / 2 - 4} y={pad.t + 10} textAnchor="end">
              deadline
            </text>
          </g>
        )}
      </svg>
      {tip.layer}
    </figure>
  );
}

// ---- cumulative cash flow -------------------------------------------------------------------

export interface LineSeries {
  name: string;
  /** CSS class with the series stroke (mark-1 … mark-3). */
  mark: string;
  values: number[];
}

export function CashFlowChart({
  series,
  monthLabel,
}: {
  series: LineSeries[];
  monthLabel: (i: number) => string;
}) {
  const tip = useTooltip();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 240;
  const pad = { l: 56, r: 90, t: 12, b: 28 };
  const all = series.flatMap((s) => s.values);
  // The axis ends at zero on the side with no values (all-negative or all-positive cash flows).
  const top = Math.max(0, ...all);
  const bottom = Math.max(0, ...all.map((v) => -v));
  const hi = top > 0 ? niceMax(top) : 0;
  const lo = bottom > 0 ? -niceMax(bottom) : 0;
  const months = Math.max(...series.map((s) => s.values.length)) - 1;
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, months);
  const y = (v: number) => pad.t + ((H - pad.t - pad.b) * (hi - v)) / (hi - lo || 1);
  const ticks = [lo, lo / 2, 0, hi / 2, hi].filter((v, i, a) => a.indexOf(v) === i);
  const ends = series.map((s) => ({ s, y: y(s.values.at(-1) ?? 0) })).sort((a, b) => a.y - b.y);
  const labelsFit = ends.every((e, i) => i === 0 || e.y - ends[i - 1]!.y >= 14);

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(months, Math.round(((sx - pad.l) / (W - pad.l - pad.r)) * months)));
    setHover(i);
    tip.show(
      e,
      <>
        <strong>{monthLabel(i)}</strong>
        {series.map((s) => (
          <div key={s.name}>
            <span className={`key ${s.mark}`} /> {s.name}: {compactUsd(s.values[i] ?? 0)}
          </div>
        ))}
      </>,
    );
  };

  return (
    <figure
      className="chart"
      ref={tip.ref}
      onMouseLeave={() => {
        tip.hide();
        setHover(null);
      }}
    >
      <figcaption>Cumulative cash flow after the investment</figcaption>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}>
            <span className={`key ${s.mark}`} /> {s.name}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Cumulative cash flow per scenario; the table below has the values"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? 'axis' : 'grid'} x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text className="tick" x={pad.l - 6} y={y(v) + 4} textAnchor="end">
              {compactUsd(v)}
            </text>
          </g>
        ))}
        {Array.from({ length: months + 1 }, (_, i) => i)
          .filter((i) => i % 3 === 0 || i === months)
          .map((i) => (
            <text key={i} className="tick" x={x(i)} y={H - 8} textAnchor="middle">
              {i === 0 ? 'start' : `M${i}`}
            </text>
          ))}
        {hover !== null && (
          <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
        )}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              className={`line ${s.mark}`}
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            />
            <circle
              className={`dot ${s.mark}`}
              cx={x(s.values.length - 1)}
              cy={y(s.values.at(-1) ?? 0)}
              r={4}
            />
            {hover !== null && s.values[hover] !== undefined && (
              <circle className={`dot ${s.mark}`} cx={x(hover)} cy={y(s.values[hover]!)} r={4} />
            )}
          </g>
        ))}
        {labelsFit &&
          ends.map(({ s, y: ey }) => (
            <text key={s.name} className="tick strong" x={W - pad.r + 8} y={ey + 4}>
              {s.name}
            </text>
          ))}
        <rect
          x={pad.l}
          y={pad.t}
          width={W - pad.l - pad.r}
          height={H - pad.t - pad.b}
          fill="transparent"
          onMouseMove={onMove}
        />
      </svg>
      {tip.layer}
    </figure>
  );
}

// ---- segmented bar --------------------------------------------------------------------------

export function SegmentedBar({
  parts,
  label,
}: {
  parts: { name: string; value: number; mark: string }[];
  label: string;
}) {
  const tip = useTooltip();
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <figure className="chart" ref={tip.ref} onMouseLeave={tip.hide}>
      <div
        className="segbar"
        role="img"
        aria-label={`${label}: ${shown.map((p) => `${p.name} ${compactUsd(p.value)}`).join(', ')}`}
      >
        {shown.map((p) => {
          const share = p.value / total;
          const text = `${Math.round(share * 100)}%`;
          return (
            <div
              key={p.name}
              className={`seg ${p.mark}`}
              style={{ flexGrow: share }}
              tabIndex={0}
              aria-label={`${p.name}: ${compactUsd(p.value)} (${text})`}
              onMouseMove={(e) =>
                tip.show(
                  e,
                  <>
                    <strong>{p.name}</strong>
                    <br />
                    {compactUsd(p.value)} · {text}
                  </>,
                )
              }
            >
              {share >= 0.12 && <span>{text}</span>}
            </div>
          );
        })}
      </div>
      <div className="legend">
        {shown.map((p) => (
          <span key={p.name}>
            <span className={`key ${p.mark}`} /> {p.name}
          </span>
        ))}
      </div>
      {tip.layer}
    </figure>
  );
}

// ---- risk matrix ----------------------------------------------------------------------------

export function RiskMatrix({
  risks,
  levels,
}: {
  risks: { id: string; title: string; probability: number; impact: number; level: string }[];
  levels: (score: number) => string;
}) {
  const tip = useTooltip();
  const rows = [5, 4, 3, 2, 1];
  const cols = [1, 2, 3, 4, 5];
  return (
    <figure className="chart" ref={tip.ref} onMouseLeave={tip.hide}>
      <figcaption>Probability × impact (score = P × I)</figcaption>
      <div className="risk-matrix" role="table" aria-label="Risk matrix">
        <div className="rm-axis-y">Probability</div>
        <div className="rm-grid">
          {rows.map((p) =>
            cols.map((i) => {
              const here = risks.filter((r) => r.probability === p && r.impact === i);
              return (
                <div key={`${p}-${i}`} className={`rm-cell zone-${levels(p * i)}`} role="cell">
                  <span className="rm-score">{p * i}</span>
                  {here.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="rm-chip"
                      onMouseMove={(e) =>
                        tip.show(
                          e,
                          <>
                            <strong>{r.id}</strong> {r.title}
                            <br />P{r.probability} × I{r.impact} = {r.probability * r.impact} ({r.level})
                          </>,
                        )
                      }
                      onFocus={(e) => tip.show(e as unknown as MouseEvent, `${r.id} ${r.title}`)}
                    >
                      {r.id.replace('F-', '')}
                    </button>
                  ))}
                </div>
              );
            }),
          )}
        </div>
        <div className="rm-ticks-y">
          {rows.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
        <div className="rm-ticks-x">
          {cols.map((i) => (
            <span key={i}>{i}</span>
          ))}
        </div>
        <div className="rm-axis-x">Impact</div>
      </div>
      {tip.layer}
    </figure>
  );
}
