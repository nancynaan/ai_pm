import type { Deck } from '@ai-pm/shared';
import { proposalFileName } from './storage.js';
import pptxgenModule from 'pptxgenjs';

// Depending on the loader the default import is the class itself or the module object.
const PptxGenJS: typeof pptxgenModule.default =
  (pptxgenModule as unknown as { default?: typeof pptxgenModule.default }).default ??
  (pptxgenModule as unknown as typeof pptxgenModule.default);
type PptxGenJS = InstanceType<typeof PptxGenJS>;

/**
 * The client deck as PPTX (16:9): a professional dark layout with subtle game touches (a running
 * lane, coin accents, pixel steps, HUD-style tiles). The KPI chart is a native PowerPoint chart,
 * so the client can edit it. Same content as the in-app slides.
 */

const C = {
  bg: '0E1A2B',
  panel: '16263D',
  line: '24395A',
  text: 'F2F5FA',
  muted: '93A3BC',
  coin: 'F5B83D',
  lane: '35C9B8',
  high: 'E5644E',
} as const;
const FONT = 'Segoe UI';
const W = 13.333;

type Slide = ReturnType<PptxGenJS['addSlide']>;

const LEVEL_COLOUR: Record<string, string> = { critical: C.high, high: C.high, medium: C.coin, low: C.lane };
const VERDICT_COLOUR: Record<string, string> = { go: C.lane, go_with_conditions: C.coin, no_go: C.high };

function frame(pptx: PptxGenJS, deck: Deck, n: number, kicker: string, heading: string): Slide {
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  // Pixel steps, top right: the game hint.
  [0, 1, 2].forEach((i) =>
    s.addShape(pptx.ShapeType.rect, {
      x: W - 0.95 + i * 0.22,
      y: 0.42 - i * 0.07,
      w: 0.12 + i * 0.03,
      h: 0.12 + i * 0.03,
      fill: { color: i === 2 ? C.coin : C.line },
      line: { color: i === 2 ? C.coin : C.line },
    }),
  );
  s.addText(`${String(n).padStart(2, '0')} · ${kicker.toUpperCase()}`, {
    x: 0.6,
    y: 0.35,
    w: 9,
    h: 0.3,
    fontFace: FONT,
    fontSize: 11,
    color: C.coin,
    bold: true,
    charSpacing: 2,
  });
  s.addText(heading, {
    x: 0.6,
    y: 0.7,
    w: 11.6,
    h: 0.9,
    fontFace: FONT,
    fontSize: 26,
    color: C.text,
    bold: true,
    valign: 'top',
  });
  // Footer: the running lane, the deliverable label and the disclaimer.
  s.addShape(pptx.ShapeType.line, {
    x: 0.6,
    y: 6.85,
    w: W - 1.2,
    h: 0,
    line: { color: C.lane, width: 1.25, dashType: 'dash' },
  });
  s.addText(deck.label, { x: 0.6, y: 6.92, w: 6.5, h: 0.35, fontFace: FONT, fontSize: 9, color: C.muted });
  s.addText('Preliminary AI-assisted assessment · not a delivery commitment', {
    x: 6.6,
    y: 6.92,
    w: 6.13,
    h: 0.35,
    fontFace: FONT,
    fontSize: 9,
    color: C.muted,
    align: 'right',
  });
  return s;
}

function panel(
  pptx: PptxGenJS,
  s: Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string = C.line,
) {
  s.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    fill: { color: C.panel },
    line: { color: C.line, width: 0.75 },
    rectRadius: 0.08,
  });
  s.addShape(pptx.ShapeType.rect, {
    x,
    y: y + 0.12,
    w: 0.06,
    h: h - 0.24,
    fill: { color: accent },
    line: { color: accent },
  });
}

function metric(
  s: Slide,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
  sub?: string | null,
) {
  s.addText(label.toUpperCase(), {
    x,
    y,
    w,
    h: 0.25,
    fontFace: FONT,
    fontSize: 9,
    color: C.muted,
    bold: true,
    charSpacing: 1,
  });
  s.addText(value, {
    x,
    y: y + 0.24,
    w,
    h: 0.38,
    fontFace: FONT,
    fontSize: 15,
    color: C.text,
    bold: true,
    valign: 'top',
  });
  if (sub)
    s.addText(sub, { x, y: y + 0.6, w, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, valign: 'top' });
}

function opportunity(pptx: PptxGenJS, deck: Deck) {
  const o = deck.opportunity;
  const s = frame(pptx, deck, 1, 'Business opportunity', o.heading);
  panel(pptx, s, 0.6, 1.75, 6.1, 4.75, C.coin);
  const rows: [string, string, string | null][] = [
    ['Primary objective', o.objective, null],
    [
      'Target KPI',
      o.targetKpi.name,
      `Today ${o.targetKpi.baseline}${o.targetKpi.clientTarget ? ` · your target: ${o.targetKpi.clientTarget}` : ''}`,
    ],
    ['Expected impact', o.impact.base, `Range ${o.impact.range}`],
    ['Target audience', o.audience, null],
    ['Business value', o.value.base, `${o.value.range} · ${o.value.payback}`],
  ];
  rows.forEach(([label, value, sub], i) => metric(s, 0.9, 1.95 + i * 0.9, 5.6, label, value, sub));

  panel(pptx, s, 6.95, 1.75, 5.78, 4.75, C.lane);
  s.addText(`${o.chart.kpi}: today and with the feature`, {
    x: 7.25,
    y: 1.9,
    w: 5.3,
    h: 0.3,
    fontFace: FONT,
    fontSize: 11,
    color: C.muted,
    bold: true,
  });
  if (o.chart.bars.length) {
    s.addChart(
      pptx.ChartType.bar,
      [
        {
          name: o.chart.kpi,
          labels: o.chart.bars.map((b) => b.label),
          values: o.chart.bars.map((b) => b.value),
        },
      ],
      {
        x: 7.15,
        y: 2.25,
        w: 5.4,
        h: 3.35,
        barDir: 'col',
        chartColors: [C.muted, C.line, C.lane, C.coin].map(() => C.lane),
        catAxisLabelColor: C.muted,
        valAxisLabelColor: C.muted,
        valAxisHidden: true,
        valGridLine: { style: 'none' },
        showValue: true,
        dataLabelColor: C.text,
        dataLabelFontSize: 10,
        catAxisLabelFontFace: FONT,
        catAxisLabelFontSize: 10,
        dataLabelFormatCode: '0.00',
        barGapWidthPct: 60,
      },
    );
  }
  if (o.caution)
    s.addText(`⚑ ${o.caution}`, {
      x: 7.25,
      y: 5.75,
      w: 5.3,
      h: 0.6,
      fontFace: FONT,
      fontSize: 10,
      color: C.coin,
      valign: 'top',
    });
}

function solution(pptx: PptxGenJS, deck: Deck) {
  const o = deck.solution;
  const s = frame(pptx, deck, 2, 'Proposed solution & scope', o.heading);
  // The player flow on a running lane.
  const n = o.flow.length;
  const x0 = 1.2;
  const span = W - 2.4;
  s.addShape(pptx.ShapeType.line, {
    x: x0,
    y: 2.25,
    w: span,
    h: 0,
    line: { color: C.lane, width: 2, dashType: 'dash' },
  });
  o.flow.forEach((step, i) => {
    const cx = x0 + (n === 1 ? 0 : (span * i) / (n - 1));
    s.addShape(pptx.ShapeType.ellipse, {
      x: cx - 0.2,
      y: 2.05,
      w: 0.4,
      h: 0.4,
      fill: { color: i === n - 1 ? C.coin : C.bg },
      line: { color: i === n - 1 ? C.coin : C.lane, width: 2 },
    });
    s.addText(String(i + 1), {
      x: cx - 0.2,
      y: 2.05,
      w: 0.4,
      h: 0.4,
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      color: i === n - 1 ? C.bg : C.lane,
      align: 'center',
      valign: 'middle',
    });
    s.addText(step, {
      x: cx - 1.1,
      y: 2.5,
      w: 2.2,
      h: 0.55,
      fontFace: FONT,
      fontSize: 12,
      color: C.text,
      align: 'center',
      valign: 'top',
    });
  });
  // Four core capabilities.
  const cw = (W - 1.2 - 0.45) / 4;
  o.capabilities.forEach((c, i) => {
    const x = 0.6 + i * (cw + 0.15);
    panel(pptx, s, x, 3.25, cw, 1.6, C.lane);
    s.addText(c.title, {
      x: x + 0.25,
      y: 3.38,
      w: cw - 0.4,
      h: 0.5,
      fontFace: FONT,
      fontSize: 13,
      bold: true,
      color: C.text,
      valign: 'top',
    });
    s.addText(c.detail, {
      x: x + 0.25,
      y: 3.88,
      w: cw - 0.4,
      h: 0.9,
      fontFace: FONT,
      fontSize: 10.5,
      color: C.muted,
      valign: 'top',
    });
  });
  // HUD counters.
  const tw = (W - 1.2 - 0.15 * (o.counts.length - 1)) / o.counts.length;
  o.counts.forEach((c, i) => {
    const x = 0.6 + i * (tw + 0.15);
    s.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 5.05,
      w: tw,
      h: 0.95,
      fill: { color: C.bg },
      line: { color: C.line, width: 1 },
      rectRadius: 0.06,
    });
    s.addText(String(c.value), {
      x,
      y: 5.08,
      w: tw,
      h: 0.5,
      fontFace: FONT,
      fontSize: 22,
      bold: true,
      color: C.coin,
      align: 'center',
    });
    s.addText(c.label, {
      x,
      y: 5.55,
      w: tw,
      h: 0.35,
      fontFace: FONT,
      fontSize: 9.5,
      color: C.muted,
      align: 'center',
    });
  });
  s.addText(`Not in this release: ${o.boundary}`, {
    x: 0.6,
    y: 6.2,
    w: W - 1.2,
    h: 0.45,
    fontFace: FONT,
    fontSize: 11,
    color: C.muted,
    italic: true,
  });
}

function feasibility(pptx: PptxGenJS, deck: Deck) {
  const o = deck.feasibility;
  const s = frame(pptx, deck, 3, 'Delivery feasibility & recommendation', o.heading);
  const w = (W - 1.2 - 0.2) / 2;
  const tile = (x: number, y: number, label: string, accent: string) => {
    panel(pptx, s, x, y, w, 1.95, accent);
    s.addText(label.toUpperCase(), {
      x: x + 0.3,
      y: y + 0.15,
      w: w - 0.5,
      h: 0.25,
      fontFace: FONT,
      fontSize: 9,
      bold: true,
      color: C.muted,
      charSpacing: 1,
    });
  };
  tile(0.6, 1.75, 'Estimated delivery · forecast range', C.lane);
  s.addText(o.delivery.range, {
    x: 0.9,
    y: 2.1,
    w: w - 0.5,
    h: 0.45,
    fontFace: FONT,
    fontSize: 18,
    bold: true,
    color: C.text,
  });
  s.addText(o.delivery.detail, {
    x: 0.9,
    y: 2.6,
    w: w - 0.5,
    h: 1.0,
    fontFace: FONT,
    fontSize: 10,
    color: C.muted,
    valign: 'top',
  });

  tile(0.8 + w, 1.75, 'Estimated budget · preliminary', C.coin);
  s.addText(o.budget.range, {
    x: 1.1 + w,
    y: 2.1,
    w: w - 0.5,
    h: 0.45,
    fontFace: FONT,
    fontSize: 18,
    bold: true,
    color: C.text,
  });
  s.addText(o.budget.detail, {
    x: 1.1 + w,
    y: 2.6,
    w: w - 0.5,
    h: 1.0,
    fontFace: FONT,
    fontSize: 10,
    color: C.muted,
    valign: 'top',
  });

  tile(0.6, 3.85, 'Major risks', C.high);
  const risks = [
    ...(o.risks.note
      ? [{ text: o.risks.note, options: { color: C.muted, fontSize: 10, breakLine: true } }]
      : []),
    ...o.risks.items.map((r) => ({
      text: `■ ${r.title}  (${r.level})`,
      options: { color: LEVEL_COLOUR[r.level] ?? C.text, fontSize: 11, breakLine: true },
    })),
  ];
  s.addText(risks, { x: 0.9, y: 4.2, w: w - 0.5, h: 1.45, fontFace: FONT, valign: 'top' });

  tile(0.8 + w, 3.85, 'Key dependencies', C.lane);
  s.addText(
    (o.dependencies.length ? o.dependencies : ['No external dependencies found']).map((d) => ({
      text: `▸ ${d}`,
      options: { color: C.text, fontSize: 11, breakLine: true },
    })),
    { x: 1.1 + w, y: 4.2, w: w - 0.5, h: 1.45, fontFace: FONT, valign: 'top' },
  );

  const colour = VERDICT_COLOUR[o.verdict.decision] ?? C.coin;
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 5.95,
    w: W - 1.2,
    h: 0.78,
    fill: { color: C.panel },
    line: { color: colour, width: 1.5 },
    rectRadius: 0.08,
  });
  s.addText(o.verdict.label, {
    x: 0.8,
    y: 6.08,
    w: 2.3,
    h: 0.5,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: C.bg,
    align: 'center',
    valign: 'middle',
    fill: { color: colour },
  });
  s.addText(o.verdict.sentence, {
    x: 3.3,
    y: 6.0,
    w: W - 4.1,
    h: 0.7,
    fontFace: FONT,
    fontSize: 12,
    color: C.text,
    valign: 'middle',
  });
}

export async function deckToPptx(deck: Deck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = deck.label;
  pptx.company = 'AI PM';
  opportunity(pptx, deck);
  solution(pptx, deck);
  feasibility(pptx, deck);
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}

export const deckFileName = (_deck: Deck, faNumber: number | null) => proposalFileName(faNumber);
