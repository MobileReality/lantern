import type { StateDef, StateMachine, StatesSection, StateTransition } from '../../../main/lantern';
import { esc } from '../lanternctx';
import { citesHtml, noteHtml } from './common';
import type { Renderer, SectionCtx } from './common';

const PAD = 30;
const GAP = 44;
const HEIGHT = 32;
const LEVEL = 20;

interface Slot {
  x: number;
  w: number;
  cx: number;
}

interface Arc {
  n: number;
  a: Slot;
  b: Slot;
  forward: boolean;
  self: boolean;
  lift: number;
}

function slots(states: StateDef[]) {
  const pos = new Map<string, Slot>();
  let x = PAD;
  for (const s of states) {
    const w = Math.max(80, s.id.length * 7.4 + 22);
    pos.set(s.id, { x, w, cx: x + w / 2 });
    x += w + GAP;
  }
  return { pos, width: x - GAP + PAD };
}

function arcs(states: StateDef[], transitions: StateTransition[], pos: Map<string, Slot>): Arc[] {
  const index = new Map(states.map((s, i) => [s.id, i]));
  const out: Arc[] = [];
  transitions.forEach((t, i) => {
    const a = pos.get(t.from);
    const b = pos.get(t.to);
    if (!a || !b) return;
    const span = Math.abs((index.get(t.to) ?? 0) - (index.get(t.from) ?? 0));
    out.push({ n: i + 1, a, b, forward: (index.get(t.to) ?? 0) > (index.get(t.from) ?? 0), self: span === 0, lift: LEVEL + LEVEL * Math.max(0, span - 1) * 0.9 });
  });
  return out;
}

function arcPath(arc: Arc, top: number) {
  const { a, b, lift } = arc;
  if (arc.self) {
    const sx = a.cx - 12;
    const ex = a.cx + 12;
    return { d: `M${sx},${top} C${sx - 10},${top - 34} ${ex + 10},${top - 34} ${ex},${top}`, lx: a.cx, ly: top - 28 };
  }
  if (arc.forward) {
    const x1 = a.cx + 10;
    const x2 = b.cx - 10;
    const y = top - lift * 1.6;
    return { d: `M${x1},${top} C${x1},${y} ${x2},${y} ${x2},${top}`, lx: (x1 + x2) / 2, ly: top - lift * 1.2 };
  }
  const x1 = a.cx - 10;
  const x2 = b.cx + 10;
  const y = top + HEIGHT + lift * 1.6;
  return { d: `M${x1},${top + HEIGHT} C${x1},${y} ${x2},${y} ${x2},${top + HEIGHT}`, lx: (x1 + x2) / 2, ly: top + HEIGHT + lift * 1.2 };
}

function stateShape(s: StateDef, p: Slot, top: number, marker: string) {
  const mid = top + HEIGHT / 2;
  let out = `<g class="sx-st${s.initial ? ' initial' : ''}${s.terminal ? ' terminal' : ''}">`;
  if (s.initial) out += `<circle class="sx-dot" cx="${p.x - 16}" cy="${mid}" r="4"/><path class="sx-arc" d="M${p.x - 12},${mid} H${p.x - 1}" marker-end="url(#${marker})"/>`;
  out += `<rect class="outer" x="${p.x}" y="${top}" width="${p.w}" height="${HEIGHT}" rx="15"/>`;
  if (s.terminal) out += `<rect class="inner" x="${p.x + 3}" y="${top + 3}" width="${p.w - 6}" height="${HEIGHT - 6}" rx="12"/>`;
  return `${out}<text x="${p.cx}" y="${mid + 4}" text-anchor="middle">${esc(s.id)}</text></g>`;
}

function diagram(ctx: SectionCtx, m: StateMachine) {
  const { pos, width } = slots(m.states);
  const list = arcs(m.states, m.transitions, pos);
  const up = Math.max(0, ...list.filter((a) => a.forward || a.self).map((a) => (a.self ? 22 : a.lift)));
  const down = Math.max(0, ...list.filter((a) => !a.forward && !a.self).map((a) => a.lift));
  const top = 18 + up * 1.6 + 10;
  const height = top + HEIGHT + down * 1.6 + 28;
  const marker = `sx-arrow-${ctx.sec.id}-${m.id}`;
  const label = `State diagram of ${m.id}`;
  let svg = `<svg class="sx-diagram" viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;max-width:${width}px;min-width:${Math.round(width * 0.72)}px" role="img" aria-label="${esc(label)}">`;
  svg += `<defs><marker id="${esc(marker)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="sx-dot" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
  for (const arc of list) {
    const { d, lx, ly } = arcPath(arc, top);
    svg += `<path class="sx-arc" d="${d}" marker-end="url(#${esc(marker)})"/><g class="sx-num"><circle cx="${lx}" cy="${ly}" r="8"/><text x="${lx}" y="${ly + 3.5}">${arc.n}</text></g>`;
  }
  for (const s of m.states) svg += stateShape(s, pos.get(s.id) as Slot, top, esc(marker));
  return `<div class="sx-table-wrap">${svg}</svg></div>`;
}

function stateRows(ctx: SectionCtx, m: StateMachine) {
  return m.states
    .map((s) => {
      const flags = `${s.initial ? '<span class="sx-flag">initial</span>' : ''}${s.terminal ? '<span class="sx-flag">final</span>' : ''}`;
      return `<tr><td><span class="sx-id">${esc(s.id)}</span>${flags}</td><td>${noteHtml(ctx, `state ${m.id} ${s.id}`, s.text)}</td><td>${citesHtml(ctx, s.cites)}</td></tr>`;
    })
    .join('');
}

function transitionRows(ctx: SectionCtx, m: StateMachine) {
  return m.transitions
    .map((t, i) => `<tr><td><span class="sx-n">${i + 1}</span></td><td><span class="sx-id">${esc(t.from)} → ${esc(t.to)}</span></td><td>${noteHtml(ctx, `tr ${m.id} ${t.from} ${t.to}`, t.text)}</td><td>${citesHtml(ctx, t.cites)}</td></tr>`)
    .join('');
}

function machine(ctx: SectionCtx, m: StateMachine) {
  const states = m.states.length ? `${diagram(ctx, m)}<div class="sx-table-wrap"><table class="sx-table"><thead><tr><th>State</th><th>Meaning</th><th>Files</th></tr></thead><tbody>${stateRows(ctx, m)}</tbody></table></div>` : '';
  const moves = m.transitions.length ? `<h3>Transitions</h3><div class="sx-table-wrap"><table class="sx-table"><thead><tr><th>#</th><th>From → to</th><th>Trigger</th><th>Files</th></tr></thead><tbody>${transitionRows(ctx, m)}</tbody></table></div>` : '';
  return `<div class="sx-machine"><h4><span class="sx-id">${esc(m.id)}</span>${noteHtml(ctx, `machine ${m.id}`, m.text)}${citesHtml(ctx, m.cites)}</h4>${states}${moves}</div>`;
}

const statesRenderer: Renderer<StatesSection> = {
  label: 'States',
  noun: 'machines',
  count: (sec) => sec.machines.length,
  body: (ctx, sec) => sec.machines.map((m) => machine(ctx, m)).join(''),
};

export { statesRenderer };
