#!/usr/bin/env node
// Generates BPMN 2.0 XML (semantic model + diagram interchange) for the AI PM pipeline
// processes defined in ./processes.mjs, plus a self-contained HTML viewer.
//
//   node docs/bpmn/generator/build.mjs
//
// Layout is grid based: every element sits in a lane at (column, row). Sequence flows
// are routed orthogonally; message flows run vertically between pools.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagrams } from './processes.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BPMN_JS = 'https://unpkg.com/bpmn-js@18.6.2/dist';

const L = {
  poolX: 40, topY: 40, poolHeader: 30, laneHeader: 30, padLeft: 20, padRight: 40,
  colW: 170, rowH: 120, poolGap: 56, collapsedH: 60,
};
const SIZE = {
  event: { w: 36, h: 36 }, gateway: { w: 50, h: 50 }, activity: { w: 130, h: 80 }, dataStore: { w: 50, h: 50 },
};
const KIND = {
  startEvent: 'event', endEvent: 'event', intermediateCatchEvent: 'event', intermediateThrowEvent: 'event',
  exclusiveGateway: 'gateway', parallelGateway: 'gateway', eventBasedGateway: 'gateway', inclusiveGateway: 'gateway',
  task: 'activity', userTask: 'activity', manualTask: 'activity', serviceTask: 'activity', scriptTask: 'activity',
  sendTask: 'activity', receiveTask: 'activity', businessRuleTask: 'activity', callActivity: 'activity',
  dataStoreReference: 'dataStore', textAnnotation: 'annotation',
};
const EVENT_DEF = {
  message: 'messageEventDefinition', timer: 'timerEventDefinition', terminate: 'terminateEventDefinition',
  error: 'errorEventDefinition', signal: 'signalEventDefinition', conditional: 'conditionalEventDefinition',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const box = (x, y, w, h) => ({ x, y, w, h, l: x, r: x + w, t: y, b: y + h, cx: x + w / 2, cy: y + h / 2 });
const textW = (s) => Math.min(90, Math.ceil(s.length * 6.2) + 4);
const textLines = (s) => Math.max(1, Math.ceil((s.length * 6.2) / 86));
const bounds = (b) => `<dc:Bounds x="${Math.round(b.x)}" y="${Math.round(b.y)}" width="${Math.round(b.w)}" height="${Math.round(b.h)}" />`;
const waypoints = (pts) => pts.map(([x, y]) => `<di:waypoint x="${Math.round(x)}" y="${Math.round(y)}" />`).join('');

function build(d) {
  const pools = d.pools.map((p) => ({
    ...p, isPool: true,
    lanes: p.collapsed ? [] : (p.lanes ?? [{ id: p.id, implicit: true }]).map((ln) => ({ ...ln })),
  }));
  const laneOf = new Map();
  for (const p of pools) for (const ln of p.lanes) laneOf.set(ln.id, { pool: p, lane: ln });

  const elements = [
    ...d.nodes,
    ...(d.dataStores ?? []).map((s) => ({ ...s, t: 'dataStoreReference' })),
    ...(d.annotations ?? []).map((a) => ({ ...a, t: 'textAnnotation' })),
  ];
  const byId = new Map();
  for (const e of elements) {
    if (!laneOf.has(e.lane)) throw new Error(`${d.key}: unknown lane "${e.lane}" for ${e.id}`);
    if (byId.has(e.id)) throw new Error(`${d.key}: duplicate id ${e.id}`);
    if (!KIND[e.t]) throw new Error(`${d.key}: unknown type ${e.t}`);
    byId.set(e.id, e);
  }

  // Horizontal grid shared by all pools so columns line up across pools.
  const maxCol = Math.max(...elements.map((e) => e.c));
  const colX0 = L.poolX + L.poolHeader + L.laneHeader + L.padLeft;
  const poolW = L.poolHeader + L.laneHeader + L.padLeft + (maxCol + 1) * L.colW + L.padRight;
  const cx = (c) => colX0 + c * L.colW + L.colW / 2;

  // Vertical layout: pools stacked top to bottom, lanes sized by the rows they use.
  let y = L.topY;
  for (const p of pools) {
    if (p.collapsed) {
      p.b = box(L.poolX, y, poolW, L.collapsedH);
    } else {
      let ly = y;
      for (const ln of p.lanes) {
        const rows = ln.rows ?? Math.max(1, ...elements.filter((e) => e.lane === ln.id).map((e) => (e.r ?? 0) + 1));
        ln.padTop = ln.padTop ?? 0;
        ln.b = box(L.poolX + L.poolHeader, ly, poolW - L.poolHeader, ln.padTop + rows * L.rowH + (ln.padBottom ?? 0));
        ly = ln.b.b;
      }
      p.b = box(L.poolX, y, poolW, ly - y);
    }
    y = p.b.b + L.poolGap;
  }

  for (const e of elements) {
    const { pool, lane } = laneOf.get(e.lane);
    e.kind = KIND[e.t];
    e.pool = pool;
    const size = e.kind === 'annotation' ? { w: e.w ?? 180, h: e.h ?? 60 } : SIZE[e.kind];
    const ccx = cx(e.c) + (e.dx ?? 0);
    const ccy = lane.b.y + lane.padTop + ((e.r ?? 0) + 0.5) * L.rowH + (e.dy ?? 0);
    e.b = box(ccx - size.w / 2, ccy - size.h / 2, size.w, size.h);
  }

  // ---- sequence flows -------------------------------------------------------------
  const flows = d.flows.map(([from, to, name, opt = {}], i) => {
    const s = byId.get(from), t = byId.get(to);
    if (!s || !t) throw new Error(`${d.key}: flow ${from} -> ${to} references unknown node`);
    if (s.pool !== t.pool) throw new Error(`${d.key}: sequence flow ${from} -> ${to} crosses pools; use a message flow`);
    const pts = route(s, t, opt, cx);
    return { id: `Flow_${d.key}_${i + 1}`, from, to, name, pool: s.pool, pts, label: name ? flowLabel(pts, name, opt.lseg ?? 0) : null };
  });

  // ---- message flows ----------------------------------------------------------------
  const poolById = new Map(pools.map((p) => [p.id, p]));
  const resolve = (ref) => byId.get(ref) ?? poolById.get(ref) ?? (() => { throw new Error(`${d.key}: unknown message ref ${ref}`); })();
  const messages = (d.messages ?? []).map((m, i) => {
    const src = resolve(m.from), tgt = resolve(m.to);
    const pts = messageRoute(src, tgt, m);
    const srcPool = src.isPool ? src : src.pool;
    return {
      id: `Message_${d.key}_${i + 1}`, name: m.n, pts,
      srcRef: src.isPool ? participantId(d, src) : src.id,
      tgtRef: tgt.isPool ? participantId(d, tgt) : tgt.id,
      label: m.n ? messageLabel(pts, m, srcPool) : null,
    };
  });

  // ---- data associations & annotation associations ------------------------------------
  const dataLinks = (d.data ?? []).map(([a, b], i) => {
    const ea = byId.get(a), eb = byId.get(b);
    const store = ea.kind === 'dataStore' ? ea : eb;
    const activity = store === ea ? eb : ea;
    return {
      id: `DataAssoc_${d.key}_${i + 1}`, dir: store === eb ? 'out' : 'in', store, activity,
      pts: straight(ea, eb),
    };
  });
  const associations = (d.annotations ?? []).filter((a) => a.attach).map((a, i) => ({
    id: `Assoc_${d.key}_${i + 1}`, from: a.attach, to: a.id, pool: byId.get(a.id).pool,
    pts: annotationLine(byId.get(a.attach), byId.get(a.id), a.ax ?? 0),
  }));

  return { pools, elements, byId, flows, messages, dataLinks, associations, width: poolW + 2 * L.poolX, height: y };
}

function route(s, t, o, cx) {
  const a = s.b, b = t.b;
  if (o.points) return o.points;
  const loop = o.via ?? (b.cx < a.cx - 1 ? 'bottom' : null);
  if (loop) {
    const top = loop === 'top', g = o.gap ?? 20;
    const y = top ? Math.min(a.t, b.t) - g : Math.max(a.b, b.b) + g;
    return [[a.cx, top ? a.t : a.b], [a.cx, y], [b.cx, y], [b.cx, top ? b.t : b.b]];
  }
  if (Math.abs(a.cy - b.cy) < 1) return [[a.r, a.cy], [b.l, b.cy]];
  const down = b.cy > a.cy;
  if (Math.abs(a.cx - b.cx) < 1) return [[a.cx, down ? a.b : a.t], [b.cx, down ? b.t : b.b]];
  const mode = o.mode ?? (s.kind === 'gateway' ? 'exitV' : t.kind === 'gateway' ? 'enterV' : 'mid');
  if (mode === 'exitV') return [[a.cx, down ? a.b : a.t], [a.cx, b.cy], [b.l, b.cy]];
  if (mode === 'enterV') return [[a.r, a.cy], [b.cx, a.cy], [b.cx, down ? b.t : b.b]];
  const mx = o.bendX != null ? cx(o.bendX) : (a.r + b.l) / 2;
  return [[a.r, a.cy], [mx, a.cy], [mx, b.cy], [b.l, b.cy]];
}

function messageRoute(src, tgt, m) {
  const A = src.b, B = tgt.b, dx = m.dx ?? 0;
  const down = B.cy > A.cy;
  const x1 = (src.isPool ? B.cx : A.cx) + dx;
  const x2 = (tgt.isPool ? x1 - dx : B.cx) + dx;
  const y1 = down ? A.b : A.t, y2 = down ? B.t : B.b;
  if (Math.abs(x1 - x2) < 1) return [[x1, y1], [x2, y2]];
  const srcPool = src.isPool ? src : src.pool;
  const yMid = down ? srcPool.b.b + L.poolGap / 2 : srcPool.b.t - L.poolGap / 2;
  return [[x1, y1], [x1, yMid], [x2, yMid], [x2, y2]];
}

function straight(ea, eb) {
  const A = ea.b, B = eb.b;
  if (B.t >= A.b) return [[A.cx, A.b], [B.cx, B.t]];
  if (B.b <= A.t) return [[A.cx, A.t], [B.cx, B.b]];
  if (B.l >= A.r) return [[A.r, A.cy], [B.l, B.cy]];
  return [[A.l, A.cy], [B.r, B.cy]];
}

function annotationLine(node, ann, ax) {
  const A = node.b, B = ann.b;
  const below = B.t >= A.cy;
  const sx = A.cx + ax, sy = below ? A.b : A.t;
  if (sx >= B.l && sx <= B.r) return [[sx, sy], [sx, below ? B.t : B.b]];
  return [[sx, sy], [sx < B.l ? B.l : B.r, B.cy]];
}

// Label of a sequence flow: next to its first segment, close to the source.
function flowLabel(pts, name, seg) {
  const [[x0, y0], [x1, y1]] = pts.slice(seg, seg + 2);
  const w = textW(name), h = textLines(name) * 14;
  if (Math.abs(x0 - x1) < 1) {
    const up = y1 < y0;
    return box(x0 + 6, up ? y0 - h - 6 : y0 + 6, w, h);
  }
  return box(x0 + 8, y0 - h - 4, w, h);
}

// Label of a message flow: inside the gap between the source pool and its neighbour.
function messageLabel(pts, m, srcPool) {
  const [[x0, y0], [, y1]] = pts;
  const w = textW(m.n), h = textLines(m.n) * 14;
  const down = y1 > y0;
  const gapMid = down ? srcPool.b.b + L.poolGap / 2 : srcPool.b.t - L.poolGap / 2;
  const x = m.lside === 'left' ? x0 - 6 - w : x0 + 6;
  return box(x, gapMid - h / 2, w, h);
}

function externalLabel(e) {
  if (!e.n || e.kind === 'activity' || e.kind === 'annotation') return '';
  const w = textW(e.n), h = textLines(e.n) * 14, B = e.b;
  const pos = e.lp ?? (e.kind === 'gateway' ? 't' : 'b');
  let lb;
  if (pos === 't') lb = box(B.cx - w / 2, B.t - h - 4, w, h);
  else if (pos === 'tl') lb = box(B.l - w + 4, B.t - h + 2, w, h);
  else if (pos === 'tr') lb = box(B.r - 4, B.t - h + 2, w, h);
  else lb = box(B.cx - w / 2, B.b + 4, w, h);
  return `<bpmndi:BPMNLabel>${bounds(lb)}</bpmndi:BPMNLabel>`;
}

const participantId = (d, p) => `Participant_${d.key}_${p.id}`;
const processId = (d, p) => `Process_${d.key}_${p.id}`;

function toXml(d, g) {
  const { pools, elements, flows, messages, dataLinks, associations } = g;
  const x = [];
  x.push('<?xml version="1.0" encoding="UTF-8"?>');
  x.push('<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'
    + ` id="Definitions_${d.key}" targetNamespace="https://github.com/ai-pm/bpmn" exporter="ai-pm bpmn generator" exporterVersion="1.0">`);
  x.push(`  <bpmn:collaboration id="Collaboration_${d.key}">`);
  if (d.doc) x.push(`    <bpmn:documentation>${esc(d.doc)}</bpmn:documentation>`);
  for (const p of pools) {
    x.push(`    <bpmn:participant id="${participantId(d, p)}" name="${esc(p.name)}"${p.collapsed ? '' : ` processRef="${processId(d, p)}"`} />`);
  }
  for (const m of messages) {
    x.push(`    <bpmn:messageFlow id="${m.id}"${m.name ? ` name="${esc(m.name)}"` : ''} sourceRef="${m.srcRef}" targetRef="${m.tgtRef}" />`);
  }
  x.push('  </bpmn:collaboration>');

  for (const p of pools.filter((pp) => !pp.collapsed)) {
    const own = (e) => e.pool === p;
    x.push(`  <bpmn:process id="${processId(d, p)}" name="${esc(p.name)}" isExecutable="false">`);
    if (!p.lanes[0].implicit) {
      x.push(`    <bpmn:laneSet id="LaneSet_${d.key}_${p.id}">`);
      for (const ln of p.lanes) {
        x.push(`      <bpmn:lane id="Lane_${d.key}_${ln.id}" name="${esc(ln.name)}">`);
        for (const e of elements.filter((ee) => ee.lane === ln.id && ['event', 'gateway', 'activity'].includes(ee.kind))) {
          x.push(`        <bpmn:flowNodeRef>${e.id}</bpmn:flowNodeRef>`);
        }
        x.push('      </bpmn:lane>');
      }
      x.push('    </bpmn:laneSet>');
    }
    for (const e of elements.filter((ee) => own(ee) && ['event', 'gateway', 'activity'].includes(ee.kind))) {
      x.push(nodeXml(e, flows, dataLinks));
    }
    for (const s of elements.filter((ee) => own(ee) && ee.kind === 'dataStore')) {
      x.push(`    <bpmn:dataStoreReference id="${s.id}" name="${esc(s.n)}" />`);
    }
    for (const f of flows.filter((ff) => ff.pool === p)) {
      x.push(`    <bpmn:sequenceFlow id="${f.id}"${f.name ? ` name="${esc(f.name)}"` : ''} sourceRef="${f.from}" targetRef="${f.to}" />`);
    }
    for (const a of elements.filter((ee) => own(ee) && ee.kind === 'annotation')) {
      x.push(`    <bpmn:textAnnotation id="${a.id}"><bpmn:text>${esc(a.text)}</bpmn:text></bpmn:textAnnotation>`);
    }
    for (const a of associations.filter((aa) => aa.pool === p)) {
      x.push(`    <bpmn:association id="${a.id}" associationDirection="None" sourceRef="${a.from}" targetRef="${a.to}" />`);
    }
    x.push('  </bpmn:process>');
  }

  x.push(`  <bpmndi:BPMNDiagram id="Diagram_${d.key}" name="${esc(d.title)}">`);
  x.push(`    <bpmndi:BPMNPlane id="Plane_${d.key}" bpmnElement="Collaboration_${d.key}">`);
  for (const p of pools) {
    x.push(`      <bpmndi:BPMNShape id="${participantId(d, p)}_di" bpmnElement="${participantId(d, p)}" isHorizontal="true">${bounds(p.b)}</bpmndi:BPMNShape>`);
    if (p.collapsed || p.lanes[0].implicit) continue;
    for (const ln of p.lanes) {
      x.push(`      <bpmndi:BPMNShape id="Lane_${d.key}_${ln.id}_di" bpmnElement="Lane_${d.key}_${ln.id}" isHorizontal="true">${bounds(ln.b)}</bpmndi:BPMNShape>`);
    }
  }
  for (const e of elements) {
    const extra = e.t === 'exclusiveGateway' ? ' isMarkerVisible="true"' : '';
    x.push(`      <bpmndi:BPMNShape id="${e.id}_di" bpmnElement="${e.id}"${extra}>${bounds(e.b)}${externalLabel(e)}</bpmndi:BPMNShape>`);
  }
  for (const f of flows) {
    const label = f.label ? `<bpmndi:BPMNLabel>${bounds(f.label)}</bpmndi:BPMNLabel>` : '';
    x.push(`      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">${waypoints(f.pts)}${label}</bpmndi:BPMNEdge>`);
  }
  for (const m of messages) {
    const label = m.label ? `<bpmndi:BPMNLabel>${bounds(m.label)}</bpmndi:BPMNLabel>` : '';
    x.push(`      <bpmndi:BPMNEdge id="${m.id}_di" bpmnElement="${m.id}">${waypoints(m.pts)}${label}</bpmndi:BPMNEdge>`);
  }
  for (const l of [...dataLinks, ...associations]) {
    x.push(`      <bpmndi:BPMNEdge id="${l.id}_di" bpmnElement="${l.id}">${waypoints(l.pts)}</bpmndi:BPMNEdge>`);
  }
  x.push('    </bpmndi:BPMNPlane>');
  x.push('  </bpmndi:BPMNDiagram>');
  x.push('</bpmn:definitions>');
  return x.join('\n') + '\n';
}

function nodeXml(e, flows, dataLinks) {
  const attrs = [`id="${e.id}"`];
  if (e.n) attrs.push(`name="${esc(e.n)}"`);
  if (e.t === 'callActivity' && e.called) attrs.push(`calledElement="${e.called}"`);
  const body = [];
  for (const f of flows.filter((ff) => ff.to === e.id)) body.push(`<bpmn:incoming>${f.id}</bpmn:incoming>`);
  for (const f of flows.filter((ff) => ff.from === e.id)) body.push(`<bpmn:outgoing>${f.id}</bpmn:outgoing>`);
  const inputs = dataLinks.filter((l) => l.activity === e && l.dir === 'in');
  const outputs = dataLinks.filter((l) => l.activity === e && l.dir === 'out');
  if (inputs.length) body.push(`<bpmn:property id="Property_${e.id}" name="__targetRef_placeholder" />`);
  for (const l of inputs) {
    body.push(`<bpmn:dataInputAssociation id="${l.id}"><bpmn:sourceRef>${l.store.id}</bpmn:sourceRef><bpmn:targetRef>Property_${e.id}</bpmn:targetRef></bpmn:dataInputAssociation>`);
  }
  for (const l of outputs) {
    body.push(`<bpmn:dataOutputAssociation id="${l.id}"><bpmn:targetRef>${l.store.id}</bpmn:targetRef></bpmn:dataOutputAssociation>`);
  }
  if (e.mi === 'parallel') body.push('<bpmn:multiInstanceLoopCharacteristics />');
  if (e.mi === 'sequential') body.push('<bpmn:multiInstanceLoopCharacteristics isSequential="true" />');
  if (e.mi === 'loop') body.push('<bpmn:standardLoopCharacteristics />');
  if (e.ev) body.push(`<bpmn:${EVENT_DEF[e.ev]} id="${e.id}_def" />`);
  return `    <bpmn:${e.t} ${attrs.join(' ')}>${body.length ? `\n      ${body.join('\n      ')}\n    ` : ''}</bpmn:${e.t}>`;
}

function viewerHtml(items) {
  const data = JSON.stringify(items).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI PM BPMN Models</title>
<link rel="stylesheet" href="${BPMN_JS}/assets/diagram-js.css">
<link rel="stylesheet" href="${BPMN_JS}/assets/bpmn-js.css">
<style>
  :root { --bg:#f5f6f8; --surface:#ffffff; --text:#1b2130; --muted:#5a6375; --border:#dadfe6; --accent:#2b59c3; --accent-soft:#e7eefc; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#13161b; --surface:#1c2027; --text:#e5e8ee; --muted:#9aa3b3; --border:#2d333d; --accent:#86a8ff; --accent-soft:#233154; } }
  :root[data-theme="dark"] { --bg:#13161b; --surface:#1c2027; --text:#e5e8ee; --muted:#9aa3b3; --border:#2d333d; --accent:#86a8ff; --accent-soft:#233154; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { padding:18px 20px 6px; }
  h1 { font-size:18px; margin:0 0 2px; }
  header p { margin:0; color:var(--muted); }
  nav { display:flex; flex-wrap:wrap; gap:6px; padding:10px 20px 0; }
  nav button { border:1px solid var(--border); background:var(--surface); color:var(--text); border-radius:999px; padding:5px 12px; font:inherit; font-size:13px; cursor:pointer; }
  nav button[aria-selected="true"] { background:var(--accent-soft); border-color:var(--accent); color:var(--accent); font-weight:600; }
  .bar { display:flex; flex-wrap:wrap; align-items:flex-start; gap:12px; padding:12px 20px; }
  #summary { flex:1 1 520px; color:var(--muted); max-width:1100px; }
  #summary strong { color:var(--text); }
  .tools { display:flex; gap:6px; }
  .tools button, .tools a { border:1px solid var(--border); background:var(--surface); color:var(--text); border-radius:6px; padding:4px 10px; font:inherit; font-size:13px; cursor:pointer; text-decoration:none; }
  #canvas { margin:0 20px 20px; height:calc(100vh - 210px); min-height:440px; background:#fff; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  .legend { padding:0 20px 20px; color:var(--muted); font-size:12.5px; }
</style>
</head>
<body>
<header>
  <h1>AI PM Pipeline: BPMN process models</h1>
  <p>Endless-runner project, Scrum. Drag to pan, Ctrl + scroll to zoom. The same files open in Camunda Modeler or demo.bpmn.io.</p>
</header>
<nav id="tabs" role="tablist"></nav>
<div class="bar">
  <div id="summary"></div>
  <div class="tools">
    <button id="fit" type="button">Fit</button>
    <button id="zin" type="button" aria-label="Zoom in">+</button>
    <button id="zout" type="button" aria-label="Zoom out">&minus;</button>
    <a id="dl" href="#" download>Download .bpmn</a>
  </div>
</div>
<p id="error" class="legend" role="alert" hidden></p>
<div id="canvas"></div>
<p class="legend">Lanes split each pipeline pool into the <strong>Pipeline engine</strong> (deterministic TypeScript: orchestration, validation, calculations, Jira/Confluence writes) and <strong>Agents</strong> (Claude calls that load skills and return schema-validated JSON). Thick-bordered boxes in the overview are call activities that point to the detailed diagrams.</p>
<script src="${BPMN_JS}/bpmn-navigated-viewer.production.min.js"></script>
<script>
  const DIAGRAMS = ${data};
  const viewer = new BpmnJS({ container: '#canvas' });
  const tabs = document.getElementById('tabs');
  let current = 0;
  DIAGRAMS.forEach((d, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.role = 'tab'; b.textContent = d.title;
    b.addEventListener('click', () => show(i));
    tabs.appendChild(b);
  });
  async function show(i) {
    current = i;
    const d = DIAGRAMS[i];
    [...tabs.children].forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    document.getElementById('summary').innerHTML = '<strong>' + d.title + '.</strong> ' + d.summary;
    const dl = document.getElementById('dl');
    dl.href = URL.createObjectURL(new Blob([d.xml], { type: 'application/xml' }));
    dl.download = d.file;
    const error = document.getElementById('error');
    error.hidden = true;
    try { await viewer.importXML(d.xml); fitted = false; fit(); }
    catch (err) { error.hidden = false; error.textContent = 'Failed to render: ' + err.message; }
    history.replaceState(null, '', '#' + d.key);
  }
  // The pane may have no size yet (hidden tab); fit once it has one.
  let fitted = false;
  function fit() {
    const el = document.getElementById('canvas');
    if (!el.clientWidth || !el.clientHeight) return;
    const c = viewer.get('canvas');
    c.resized();
    c.zoom('fit-viewport', 'auto');
    fitted = true;
  }
  new ResizeObserver(() => { if (!fitted) fit(); }).observe(document.getElementById('canvas'));
  const zoom = (f) => { const c = viewer.get('canvas'); c.zoom(c.zoom() * f); };
  document.getElementById('fit').onclick = fit;
  document.getElementById('zin').onclick = () => zoom(1.2);
  document.getElementById('zout').onclick = () => zoom(1 / 1.2);
  const fromHash = DIAGRAMS.findIndex((d) => '#' + d.key === location.hash);
  show(fromHash >= 0 ? fromHash : 0);
</script>
</body>
</html>
`;
}

mkdirSync(OUT_DIR, { recursive: true });
const items = [];
for (const d of diagrams) {
  const g = build(d);
  const xml = toXml(d, g);
  writeFileSync(join(OUT_DIR, d.file), xml);
  items.push({ key: d.key, title: d.title, summary: d.summary, file: d.file, xml });
  console.log(`wrote ${d.file}  (${g.elements.length} elements, ${g.flows.length} flows, ${g.messages.length} messages, ${Math.round(g.width)}x${Math.round(g.height)})`);
}
writeFileSync(join(OUT_DIR, 'viewer.html'), viewerHtml(items));
console.log('wrote viewer.html');
