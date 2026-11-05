import {
  type Assessment,
  assessmentSchema,
  type AssessmentSummary,
  assessmentSummarySchema,
  type EstimateItem,
} from '@ai-pm/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorText } from './api.js';
import { CashFlowChart, compactUsd, RiskMatrix, SegmentedBar, SprintHistogram } from './charts.js';

/** The Analysis tab: every number of the feature assessment, kept out of the chat. */

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const pct = (n: number) => `${Math.round(n * 100)} %`;
const date = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '–';

const DECISION_TONE = { go: 'ok', go_with_conditions: 'warn', no_go: 'err' } as const;
const DECISION_ICON = { go: '✓', go_with_conditions: '!', no_go: '✕' } as const;
const DISCIPLINE: Record<string, string> = {
  gameplay: 'Gameplay',
  backend: 'Backend',
  ui_art: 'UI & art',
  qa: 'QA',
  other: 'Other',
};
const KPI: Record<string, string> = {
  dau: 'DAU',
  d1_retention: 'D1 retention',
  d7_retention: 'D7 retention',
  d30_retention: 'D30 retention',
  session_minutes: 'Session length',
  payer_conversion: 'Payer conversion',
  rewarded_views_per_dau: 'Rewarded views per DAU',
  arpdau: 'ARPDAU',
};

export function AnalysisList() {
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api('/api/assessments', z.array(assessmentSummarySchema))
      .then(setItems)
      .catch((err: unknown) => setError(errorText(err)));
  }, []);

  if (error) return <p className="error">Could not load the assessments: {error}</p>;
  if (!items) return <p className="muted">Loading…</p>;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Feature assessments</h2>
      </div>
      {items.length === 0 ? (
        <p className="muted">
          No assessment yet. A feature request gets one after discovery and analysis; start one in the{' '}
          <a href="#/">chat</a>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Verdict</th>
              <th className="num">Done by (P85)</th>
              <th className="num">Cost (P85)</th>
              <th className="num">NPV (base)</th>
              <th className="num">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.runId}>
                <td>
                  <a href={`#/analysis/${a.runId}`}>{a.title}</a>
                </td>
                <td>
                  <VerdictTag decision={a.decision} label={a.label} />
                </td>
                <td className="num">{date(a.p85Date)}</td>
                <td className="num">{compactUsd(a.p85BudgetUsd)}</td>
                <td className="num">{compactUsd(a.baseNpvUsd)}</td>
                <td className="num">{new Date(a.updatedAt).toLocaleDateString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function VerdictTag({ decision, label }: { decision: Assessment['verdict']['decision']; label: string }) {
  return (
    <span className={`tag ${DECISION_TONE[decision]}`}>
      <span aria-hidden="true">{DECISION_ICON[decision]}</span> {label}
    </span>
  );
}

export function AnalysisView({ runId }: { runId: string }) {
  const [a, setA] = useState<Assessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api(`/api/runs/${runId}/assessment`, assessmentSchema)
      .then(setA)
      .catch((err: unknown) => setError(errorText(err)));
  }, [runId]);

  if (error)
    return (
      <section className="card">
        <p className="error">{error}</p>
        <p>
          <a href={`#/runs/${runId}`}>Back to the chat</a> · <a href="#/analysis">All assessments</a>
        </p>
      </section>
    );
  if (!a) return <p className="muted">Loading…</p>;

  const base = a.value.scenarios.find((s) => s.name === 'base')!;
  const dateOfSprints = (n: number) => sprintDate(a, n);
  const deadlineSprint =
    a.inputs.deadline.hard && a.inputs.deadline.date ? sprintsUntil(a, a.inputs.deadline.date) : null;

  return (
    <>
      <section className="card">
        <p className="crumbs">
          <a href="#/analysis">Analysis</a> › {a.title}
        </p>
        <div className="card-head">
          <h2>{a.title}</h2>
          <VerdictTag decision={a.verdict.decision} label={a.verdict.label} />
        </div>
        <p className="meta">
          Assessed {new Date(a.createdAt).toLocaleString('en-GB')} · {a.inputs.magnitude.replace('_', ' ')} ·{' '}
          <a href={`#/runs/${a.runId}`}>Open the chat</a>
        </p>
        {a.preliminary && (
          <p className="banner warn">
            <strong>Preliminary.</strong> {a.preliminaryReasons.join('; ')}. Figures that depend on open
            points are not final.
          </p>
        )}
        <p className="banner muted-banner">
          All estimates are AI estimates and stay preliminary until the development team re-estimates the
          story map.
        </p>
        <div className="stats">
          <Stat
            label="MVP done by (P85)"
            value={date(a.forecast.mvp.dates.p85)}
            note={`P50 ${date(a.forecast.mvp.dates.p50)}`}
          />
          <Stat
            label="Full scope done by (P85)"
            value={date(a.forecast.full.dates.p85)}
            note={`P50 ${date(a.forecast.full.dates.p50)}`}
          />
          <Stat
            label="Cost (P85)"
            value={compactUsd(a.budget.total.p85)}
            note={`${pct(a.budget.limitUsage)} of the limit`}
          />
          <Stat label="NPV, base case" value={compactUsd(base.npvUsd)} note={`ROI ${pct(base.roi)}`} />
          <Stat label="WSJF" value={String(a.wsjf.score)} note={`job size ${a.wsjf.jobSize}`} />
        </div>
      </section>

      <section className="card">
        <h3>Verdict</h3>
        <div className="two-col">
          <div>
            <h4>Why</h4>
            <ul>
              {a.verdict.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Conditions</h4>
            {a.verdict.conditions.length ? (
              <ol>
                {a.verdict.conditions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
            ) : (
              <p className="muted">None.</p>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Planning inputs</h3>
        <dl className="facts">
          <dt>Start</dt>
          <dd>
            Sprint {a.inputs.startSprint} ({date(a.inputs.startDate)}), {pct(a.inputs.capacityShare)} of the
            team
          </dd>
          <dt>Velocity</dt>
          <dd>{a.inputs.averageVelocity} points per sprint on average (team history)</dd>
          <dt>Cost</dt>
          <dd>
            {usd(a.inputs.teamCostPerSprintUsd)} per team sprint · {usd(a.inputs.costPerPointUsd)} per story
            point
          </dd>
          <dt>Deadline</dt>
          <dd>
            {a.inputs.deadline.date
              ? `${date(a.inputs.deadline.date)} (${a.inputs.deadline.hard ? 'hard' : 'soft'}; ${
                  a.inputs.deadline.source === 'ai_interpretation'
                    ? `AI reading of "${a.inputs.deadline.text}"`
                    : a.inputs.deadline.source
                })`
              : a.inputs.deadline.text
                ? `"${a.inputs.deadline.text}" (no date)`
                : 'None'}
          </dd>
          <dt>Budget limit</dt>
          <dd>
            {usd(a.inputs.budgetLimit.amountUsd)} (
            {a.inputs.budgetLimit.source === 'client'
              ? 'given by the client'
              : 'remaining approved project budget'}
            )
          </dd>
          <dt>Discovery</dt>
          <dd>
            Confidence {a.inputs.discoveryConfidence ?? '–'}; evidence behind the request: {a.inputs.evidence}
          </dd>
          <dt>Forecast</dt>
          <dd>
            Monte Carlo, {a.inputs.trials.toLocaleString('en-US')} trials, seed {a.inputs.seed}
          </dd>
        </dl>
      </section>

      <section className="card">
        <h3>Release forecast</h3>
        <div className="two-col">
          <SprintHistogram
            title={`MVP: ${a.storyMap.totals.mvp.items} items, ${a.storyMap.totals.mvp.mean} ± ${a.storyMap.totals.mvp.sd} points`}
            histogram={a.forecast.mvp.histogram}
            p50={a.forecast.mvp.sprints.p50}
            p85={a.forecast.mvp.sprints.p85}
            deadlineSprint={deadlineSprint}
            dateOf={dateOfSprints}
          />
          <SprintHistogram
            title={`Full scope: ${a.storyMap.totals.full.items} items, ${a.storyMap.totals.full.mean} ± ${a.storyMap.totals.full.sd} points`}
            histogram={a.forecast.full.histogram}
            p50={a.forecast.full.sprints.p50}
            p85={a.forecast.full.sprints.p85}
            deadlineSprint={deadlineSprint}
            dateOf={dateOfSprints}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>Slice</th>
              <th className="num">Points P50 / P85</th>
              <th className="num">Sprints P50 / P85 / P95</th>
              <th className="num">Done by P50</th>
              <th className="num">P85</th>
              <th className="num">P95</th>
            </tr>
          </thead>
          <tbody>
            {(['mvp', 'full'] as const).map((k) => {
              const f = a.forecast[k];
              return (
                <tr key={k}>
                  <td>{k === 'mvp' ? 'MVP' : 'Full scope'}</td>
                  <td className="num">
                    {f.points.p50} / {f.points.p85}
                  </td>
                  <td className="num">
                    {f.sprints.p50} / {f.sprints.p85} / {f.sprints.p95}
                  </td>
                  <td className="num">{date(f.dates.p50)}</td>
                  <td className="num">{date(f.dates.p85)}</td>
                  <td className="num">{date(f.dates.p95)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {a.roadmapImpact.release && (
          <p className={a.roadmapImpact.launchAtRisk ? 'banner warn' : 'muted'}>
            <strong>Roadmap impact:</strong> {a.roadmapImpact.release} has {a.roadmapImpact.remainingPoints}{' '}
            points left.
            {a.roadmapImpact.delaySprints > 0
              ? ` With this feature taking ${pct(a.inputs.capacityShare)} of the team it finishes ${date(a.roadmapImpact.finishWith)} instead of ${date(a.roadmapImpact.finishWithout)} (${a.roadmapImpact.delaySprints} sprint${a.roadmapImpact.delaySprints === 1 ? '' : 's'} later; launch target ${date(a.roadmapImpact.launchTarget)}).`
              : ' The feature does not delay it.'}
          </p>
        )}
      </section>

      <section className="card">
        <h3>Story map</h3>
        <StoryMap items={a.storyMap.items} />
        {a.storyMap.assumptions.length > 0 && (
          <details>
            <summary>Estimation assumptions ({a.storyMap.assumptions.length})</summary>
            <ul>
              {a.storyMap.assumptions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <h3>Resources</h3>
        <table>
          <thead>
            <tr>
              <th>Discipline</th>
              <th className="num">Share of points</th>
              <th className="num">Needs (FTE)</th>
              <th className="num">Has (FTE)</th>
              <th className="num">Own work (sprints)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {a.resources.map((r) => (
              <tr key={r.discipline}>
                <td>{DISCIPLINE[r.discipline]}</td>
                <td className="num">{pct(r.pointsShare)}</td>
                <td className="num">{r.demandFte}</td>
                <td className="num">{r.availableFte}</td>
                <td className="num">{r.sprintsNeeded ?? '–'}</td>
                <td>
                  {r.bottleneck && (
                    <span
                      className="tag neutral"
                      title="Its own work takes longest; the forecast already uses its pace"
                    >
                      sets the pace
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Budget</h3>
        <SegmentedBar
          label="Total cost at P85"
          parts={[
            { name: 'Labour (P85)', value: a.budget.labour.p85, mark: 'mark-1' },
            { name: 'Non-labour', value: a.budget.nonLabourTotal, mark: 'mark-2' },
            { name: 'Risk contingency (EMV)', value: a.budget.contingency, mark: 'mark-3' },
          ]}
        />
        <table>
          <thead>
            <tr>
              <th>Cost line</th>
              <th className="num">P50</th>
              <th className="num">P85</th>
            </tr>
          </thead>
          <tbody>
            {a.budget.byRole.map((r) => (
              <tr key={r.role}>
                <td>
                  {r.role}{' '}
                  <span className="muted small">
                    ({r.fte} FTE × ${r.rate}/h × {pct(a.inputs.capacityShare)})
                  </span>
                </td>
                <td className="num">{usd(r.p50)}</td>
                <td className="num">{usd(r.p85)}</td>
              </tr>
            ))}
            {a.budget.nonLabour.map((n) => (
              <tr key={n.description}>
                <td>
                  {n.description}{' '}
                  <span className="muted small">
                    (
                    {n.kind === 'monthly'
                      ? `${usd(n.amountUsd)}/month × ${a.value.horizonMonths}`
                      : 'one-off'}
                    ; {n.basis})
                  </span>
                </td>
                <td className="num">{usd(n.totalUsd)}</td>
                <td className="num">{usd(n.totalUsd)}</td>
              </tr>
            ))}
            <tr>
              <td>
                Risk contingency{' '}
                <span className="muted small">
                  (
                  {a.budget.contingencyCapped
                    ? `risk EMV ${usd(a.budget.emvTotal)}, capped at ${pct(a.budget.contingency / Math.max(1, a.budget.labour.p50))} of labour`
                    : 'sum of risk EMV'}
                  )
                </span>
              </td>
              <td className="num">{usd(a.budget.contingency)}</td>
              <td className="num">{usd(a.budget.contingency)}</td>
            </tr>
            <tr className="total">
              <td>Total</td>
              <td className="num">{usd(a.budget.total.p50)}</td>
              <td className="num">{usd(a.budget.total.p85)}</td>
            </tr>
            <tr>
              <td>
                Budget limit (
                {a.inputs.budgetLimit.source === 'client' ? 'client' : 'remaining project budget'})
              </td>
              <td className="num" />
              <td className="num">
                {usd(a.inputs.budgetLimit.amountUsd)} ({pct(a.budget.limitUsage)} used)
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Risks</h3>
        <div className="two-col risk-layout">
          <RiskMatrix
            risks={a.risks}
            levels={(score) =>
              score >= 20 ? 'critical' : score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low'
            }
          />
          <p className="muted small">
            {a.risks.length} risks,{' '}
            {a.risks.filter((r) => r.level === 'high' || r.level === 'critical').length} high or critical.
            Expected cost (EMV) {usd(a.budget.emvTotal)}
            {a.budget.contingencyCapped
              ? `; the budget carries ${usd(a.budget.contingency)} of it as contingency (capped, because overlapping risks double-count).`
              : ', carried as contingency in the budget.'}
          </p>
        </div>
        <table className="risks">
          <thead>
            <tr>
              <th>Risk</th>
              <th className="num">P × I</th>
              <th>Response</th>
              <th className="num">EMV</th>
            </tr>
          </thead>
          <tbody>
            {a.risks.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>
                    {r.id} {r.title}
                  </strong>
                  {r.existingRiskId && <span className="muted small"> · updates {r.existingRiskId}</span>}
                  <div className="small">
                    Because {lowerFirst(r.cause)}, {lowerFirst(r.event)}, which would lead to{' '}
                    {lowerFirst(r.effect)}
                  </div>
                  <div className="muted small">
                    {r.category} · owner {r.owner} · trigger: {r.trigger}
                  </div>
                </td>
                <td className="num">
                  {r.probability} × {r.impact} = {r.score}
                  <br />
                  <span
                    className={`tag ${r.level === 'critical' ? 'err' : r.level === 'high' ? 'warn' : 'neutral'}`}
                  >
                    {r.level}
                  </span>
                </td>
                <td className="small">
                  <strong>{r.strategy}:</strong> {r.response}
                </td>
                <td className="num">
                  {usd(r.emvUsd)}
                  <div className="muted small">of {usd(r.costImpactUsd)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Business value</h3>
        <p>{a.value.drivers}</p>
        <p className="small">
          Primary KPI: <strong>{KPI[a.value.primaryKpi] ?? a.value.primaryKpi}</strong>. Benefits from{' '}
          {date(a.value.benefitStart)} (the month after the MVP at P50), over {a.value.horizonMonths} months.
        </p>
        <CashFlowChart
          series={a.value.scenarios.map((s, i) => ({
            name: capitalize(s.name),
            mark: `mark-${i + 1}`,
            values: s.cumulative,
          }))}
          monthLabel={(i) =>
            i === 0 ? 'Investment' : `Month ${i} (${monthName(a.value.benefitStart, i - 1)})`
          }
        />
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>KPI effect</th>
              <th className="num">Revenue / month</th>
              <th className="num">ROI</th>
              <th className="num">NPV</th>
              <th className="num">Payback</th>
            </tr>
          </thead>
          <tbody>
            {a.value.scenarios.map((s) => (
              <tr key={s.name}>
                <td>
                  {capitalize(s.name)}
                  <div className="muted small">reach {pct(s.reach)}</div>
                </td>
                <td className="small">
                  {s.kpiChanges.length
                    ? s.kpiChanges
                        .map(
                          (c) =>
                            `${KPI[c.kpi] ?? c.kpi} ${c.change >= 0 ? '+' : ''}${c.change}${c.unit === '%' ? ' %' : ` ${c.unit}`}${c.capped ? ' (capped)' : ''}`,
                        )
                        .join(', ')
                    : 'no effect'}
                  <div className="muted">{s.rationale}</div>
                </td>
                <td className="num">{usd(s.monthlyRevenueUsd)}</td>
                <td className="num">{pct(s.roi)}</td>
                <td className="num">{usd(s.npvUsd)}</td>
                <td className="num">{s.paybackMonth ? `month ${s.paybackMonth}` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="banner muted-banner">
          <strong>Break-even:</strong> {a.value.breakEvenText}
        </p>
        <p className="small">
          <strong>How to validate:</strong> {a.value.validation}
        </p>
        <h4>WSJF</h4>
        <p className="small">
          (business value {a.wsjf.businessValue} + time criticality {a.wsjf.timeCriticality} + risk reduction{' '}
          {a.wsjf.riskReduction}) ÷ job size {a.wsjf.jobSize} = <strong>{a.wsjf.score}</strong>.{' '}
          {a.wsjf.rationale}
        </p>
        {a.value.assumptions.length > 0 && (
          <details>
            <summary>Value assumptions ({a.value.assumptions.length})</summary>
            <ul>
              {a.value.assumptions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

function StoryMap({ items }: { items: EstimateItem[] }) {
  const activities = [...new Set(items.map((i) => i.activity))];
  return (
    <table className="story-map">
      <thead>
        <tr>
          <th>Item</th>
          <th>Release</th>
          <th className="num">O / M / P</th>
          <th className="num">PERT</th>
        </tr>
      </thead>
      {activities.map((activity) => (
        <tbody key={activity}>
          <tr className="group">
            <th colSpan={4}>{activity}</th>
          </tr>
          {items
            .filter((i) => i.activity === activity)
            .map((i) => (
              <tr key={i.ref}>
                <td>
                  <details>
                    <summary>
                      <span className="muted">{i.ref}</span> {i.title}{' '}
                      <span className="muted small">
                        · {i.type} · {DISCIPLINE[i.discipline]}
                      </span>
                    </summary>
                    <p className="small">
                      {i.rationale}
                      {i.referenceStory ? ` Sized against ${i.referenceStory}.` : ''}
                    </p>
                    {i.requirementCodes.length > 0 && (
                      <p className="muted small">{i.requirementCodes.join(', ')}</p>
                    )}
                  </details>
                </td>
                <td>
                  {i.release === 'mvp' ? (
                    <span className="tag ok">MVP</span>
                  ) : (
                    <span className="tag neutral">later</span>
                  )}
                </td>
                <td className="num">
                  {i.optimistic} / {i.mostLikely} / {i.pessimistic}
                </td>
                <td className="num">
                  {i.mean} ± {i.sd}
                </td>
              </tr>
            ))}
        </tbody>
      ))}
    </table>
  );
}

// ---- helpers ----

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, '');
const DAY = 86_400_000;

/** End date after n sprints, from the start sprint (two-week sprints). */
function sprintDate(a: Assessment, n: number) {
  const start = new Date(`${a.inputs.startDate}T00:00:00Z`).getTime();
  return date(new Date(start + n * 14 * DAY - DAY).toISOString().slice(0, 10));
}

/** How many sprints fit before a date. */
function sprintsUntil(a: Assessment, iso: string) {
  const start = new Date(`${a.inputs.startDate}T00:00:00Z`).getTime();
  return Math.floor((new Date(`${iso}T00:00:00Z`).getTime() - start + DAY) / (14 * DAY));
}

function monthName(startIso: string, offset: number) {
  const d = new Date(`${startIso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
