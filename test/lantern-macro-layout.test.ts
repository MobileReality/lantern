import { describe, expect, it } from 'vitest';
import type { MacroView } from '../src/main/lantern-macro';
import { macroGraph } from '../src/renderer/lib/lanternmacro';
import { layoutMacro, shapeRects } from '../src/renderer/lib/lanternmacrolayout';
import { systemLinksFor } from '../src/renderer/lib/lanternmacrorest';
import type { MacroLayout } from '../src/renderer/lib/lanternmacrolayout';
import { overlaps, pathPoints } from '../src/renderer/lib/lanternmacrolabels';
import type { Rect } from '../src/renderer/lib/lanternmacrolabels';
import ownView from './fixtures/lantern-macro-own-view.json';
import { macroFixtureView } from './helpers/lantern-macro-fixture';

const ARROWHEAD_WIDTH = 7;
const CLEARANCE_PX = 3;

const rectOf = (p: { x: number; y: number; w: number; h: number }): Rect => ({ x: p.x, y: p.y, w: p.w, h: p.h });
const cards = (shape: MacroLayout) => [...shape.layout.pos.values()].map(rectOf);
const inside = (rect: Rect, p: { x: number; y: number }) => p.x > rect.x && p.x < rect.x + rect.w && p.y > rect.y && p.y < rect.y + rect.h;

function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPolyline(p: { x: number; y: number }, line: { x: number; y: number }[]) {
  return Math.min(...line.slice(1).map((next, index) => distanceToSegment(p, line[index], next)));
}

function pairs<T>(list: T[]): [T, T][] {
  return list.flatMap((a, i) => list.slice(i + 1).map((b): [T, T] => [a, b]));
}

function problemsOf(shape: MacroLayout) {
  const problems: string[] = [];
  const boxes = cards(shape);
  const keys = [...shape.layout.pos.keys()];
  pairs(boxes.map((box, index) => ({ box, key: keys[index] }))).forEach(([a, b]) => {
    if (overlaps(a.box, b.box, 0)) problems.push(`card ${a.key} overlaps card ${b.key}`);
  });
  for (const arc of shape.arcs) {
    const from = shape.layout.pos.get(arc.edge.fromKey) as Rect;
    const to = shape.layout.pos.get(arc.edge.toKey) as Rect;
    const points = pathPoints(arc.path);
    if (points.some((p) => boxes.some((box) => inside(box, p)))) problems.push(`arrow ${arc.edge.key} crosses a card`);
    if (!(arc.path[0].from.y >= from.y && arc.path[0].from.y <= from.y + from.h && arc.path[arc.path.length - 1].to.y >= to.y && arc.path[arc.path.length - 1].to.y <= to.y + to.h)) problems.push(`arrow ${arc.edge.key} does not start and end on its cards`);
  }
  const labels = shapeRects(shape);
  pairs(labels).forEach(([a, b]) => {
    if (overlaps(a, b, 0)) problems.push('two count labels overlap');
  });
  for (const label of labels) if (boxes.some((box) => overlaps(label, box, 0))) problems.push('a count label sits on a card');
  const curves = shape.arcs.map((arc) => ({ key: arc.edge.key, points: pathPoints(arc.path), ends: [arc.path[0].from, arc.path[arc.path.length - 1].to] }));
  pairs(curves).forEach(([a, b]) => {
    const shared = a.points.filter((p) => distanceToPolyline(p, b.points) < CLEARANCE_PX).length;
    if (shared > 4) problems.push(`arrows ${a.key} and ${b.key} run on top of each other`);
    for (const p of a.ends) for (const q of b.ends) if (p !== q && Math.hypot(p.x - q.x, p.y - q.y) < ARROWHEAD_WIDTH && p.x === q.x) problems.push(`arrowheads of ${a.key} and ${b.key} touch`);
  });
  return problems;
}

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function randomView(seed: number, blocks: number, edges: number): MacroView {
  const next = seeded(seed);
  const ids = Array.from({ length: blocks }, (_, i) => `block-${i}`);
  const taken = new Set<string>();
  const list: MacroView['edges'] = [];
  while (list.length < edges) {
    const from = ids[Math.floor(next() * blocks)];
    const to = ids[Math.floor(next() * blocks)];
    if (from === to || taken.has(`${from}>${to}`)) continue;
    taken.add(`${from}>${to}`);
    const count = 1 + Math.floor(next() * next() * 40);
    list.push({ from, to, count, arrows: { '>': count, '<': 0, '=': 0, '@': 0 }, strong: count >= 8 });
  }
  return {
    recordCount: blocks * 10,
    testCount: 0,
    blocks: ids.map((id, i) => ({ id, files: 5 + i })),
    edges: list,
    crossBlockRelations: list.reduce((sum, edge) => sum + edge.count, 0),
    external: [{ system: 'git', blocks: [{ block: ids[0], count: 2 }, { block: ids[1], count: 12 }] }],
  };
}

describe('macro layout is readable', () => {
  it('draws the pinned fixture (11 feature cards, 27 feature arrows) with no overlapping arrows, labels or cards', () => {
    const shape = layoutMacro(macroGraph(macroFixtureView()));

    expect(shape.arcs).toHaveLength(27);
    expect(problemsOf(shape)).toEqual([]);
  });

  it('draws this repo own map (12 feature cards, 32 feature arrows) with no overlapping arrows, labels or cards', () => {
    const view = ownView as unknown as MacroView;
    const shape = layoutMacro(macroGraph(view));

    expect(view.blocks).toHaveLength(15);
    expect(shape.arcs).toHaveLength(32);
    expect(problemsOf(shape)).toEqual([]);
  });

  it('draws the systems of any selected block or system clear of every card and label', () => {
    const graph = macroGraph(macroFixtureView());
    const problems = [...graph.blocks.map((block) => block.key), ...graph.systems.map((system) => system.key)].flatMap((key) => problemsOf(layoutMacro(graph, systemLinksFor(graph, key))).map((problem) => `${key}: ${problem}`));

    expect(problems).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('keeps a dense random graph clean (seed %i)', (seed) => {
    const view = randomView(seed, 15, 70);
    const shape = layoutMacro(macroGraph(view));

    expect(shape.arcs).toHaveLength(70);
    expect(problemsOf(shape)).toEqual([]);
  });

  it('is deterministic', () => {
    const graph = macroGraph(macroFixtureView());

    expect(JSON.stringify(layoutMacro(graph).arcs)).toBe(JSON.stringify(layoutMacro(graph).arcs));
  });
});
