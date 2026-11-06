import { Container, Graphics, Text } from 'pixi.js';
import type { EdgeCurve } from '../lanternlayout';
import type { EdgeLabel } from '../lanternmacrolabels';
import type { MacroLayout } from '../lanternmacrolayout';
import { edgeTitle, linkTitle } from '../lanternmacro';
import type { GraphEdge } from '../lanternmacro';
import type { MacroMarks } from '../lanternmacromarks';
import { FLAT_LINE } from '../lanternmacrostyles';
import { drawArrow, edgeGeometry, edgeKind } from './edge-graphics';
import { edgeColor } from './palette';
import type { PixiPalette } from './palette';

const { strongWidth: STRONG_WIDTH, weakWidth: WEAK_WIDTH, pickedWidth: PICKED_WIDTH, weakAlpha: WEAK_ALPHA, markedWidth: MARKED_WIDTH } = FLAT_LINE;
const PICKED_STRONG_WIDTH = 3.4;
const LINK_WIDTH = 1.5;
const QUIET_WIDTH = 0.9;
const QUIET_ALPHA = 0.22;
const FADED_ALPHA = 0.1;
const EDGE_ACCESS = 'lt-pixi-edge-access';
const NO_KEYS: ReadonlySet<string> = new Set();

interface MacroGraphicsOptions {
  shape: MacroLayout;
  palette: PixiPalette;
  selected: string | null;
  resolution: number;
  marks?: MacroMarks;
  current?: { keys: ReadonlySet<string> };
}

interface Stroke {
  path: EdgeCurve[];
  color: number;
  width: number;
  alpha: number;
  rank: number;
}

interface Tag {
  label: EdgeLabel;
  color: number;
  strong: boolean;
  rank: number;
}

function routedEdge(stroke: Stroke) {
  const { path, color, width, alpha } = stroke;
  const line = new Graphics();
  const geometry = edgeGeometry(path[path.length - 1], '>');
  line.moveTo(path[0].from.x, path[0].from.y);
  for (const piece of path.slice(0, -1)) line.bezierCurveTo(piece.control1.x, piece.control1.y, piece.control2.x, piece.control2.y, piece.to.x, piece.to.y);
  line.bezierCurveTo(geometry.shaft.control1.x, geometry.shaft.control1.y, geometry.shaft.control2.x, geometry.shaft.control2.y, geometry.shaft.to.x, geometry.shaft.to.y);
  line.stroke({ color, width, join: 'round' });
  if (geometry.endHead) drawArrow(line, geometry.endHead.tip, geometry.endHead.base, color);
  line.alpha = alpha;
  return line;
}

function countTag(tag: Tag, palette: PixiPalette, resolution: number) {
  const { label, strong } = tag;
  const display = new Container();
  display.addChild(new Graphics().roundRect(label.x, label.y, label.w, label.h, 4).fill({ color: palette.background, alpha: 0.96 }).stroke({ color: tag.color, width: strong ? 1.4 : 1, alpha: strong ? 1 : 0.7 }));
  const text = new Text({ text: label.text, resolution, style: { fontFamily: palette.mono, fontSize: strong ? 11.5 : 10, fontWeight: strong ? '700' : '400', fill: strong ? palette.ink : palette.ink3 } });
  text.anchor.set(0.5);
  text.position.set(label.x + label.w / 2, label.y + label.h / 2);
  display.addChild(text);
  return display;
}

function isPicked(picked: string | null, ...keys: string[]) {
  return picked !== null && keys.includes(picked);
}

type ArcMode = 'plain' | 'quiet' | 'marked' | 'reading' | 'picked' | 'faded' | null;

interface ArcView {
  selected: string | null;
  marks?: MacroMarks;
  reading?: ReadonlySet<string>;
}

function arcMode(edge: GraphEdge, view: ArcView): ArcMode {
  const { selected, marks, reading } = view;
  if (selected !== null) {
    if (isPicked(selected, edge.fromKey, edge.toKey)) return 'picked';
    return edge.main ? 'faded' : null;
  }
  if (reading) return reading.has(edge.fromKey) || reading.has(edge.toKey) ? 'reading' : edge.main ? 'quiet' : null;
  if (marks) return marks.edges.has(edge.key) ? 'marked' : edge.main ? 'quiet' : null;
  return edge.main ? 'plain' : null;
}

function macroGraphics({ shape, palette, selected, resolution, marks, current }: MacroGraphicsOptions) {
  const strokes: Stroke[] = [];
  const tags: Tag[] = [];
  const reading = current?.keys ?? NO_KEYS;
  const view: ArcView = { selected, marks, reading: current ? reading : undefined };
  for (const { edge, path, label } of shape.arcs) {
    const mode = arcMode(edge, view);
    if (mode === 'reading' || mode === 'marked') {
      const color = mode === 'reading' ? palette.ref : palette.glow;
      strokes.push({ path, color, width: MARKED_WIDTH, alpha: 1, rank: 3 });
      tags.push({ label, color, strong: true, rank: 3 });
    } else if (mode === 'quiet') strokes.push({ path, color: palette.ink3, width: QUIET_WIDTH, alpha: QUIET_ALPHA, rank: -1 });
    else if (mode === 'plain') {
      const color = edge.strong ? palette.ink : palette.ink3;
      strokes.push({ path, color, width: edge.strong ? STRONG_WIDTH : WEAK_WIDTH, alpha: edge.strong ? 1 : WEAK_ALPHA, rank: edge.strong ? 1 : 0 });
      tags.push({ label, color, strong: edge.strong, rank: edge.strong ? 1 : 0 });
    } else if (mode === 'picked') {
      const color = edgeColor(palette, edgeKind('>', edge.toKey === selected && edge.fromKey !== selected));
      strokes.push({ path, color, width: edge.strong ? PICKED_STRONG_WIDTH : PICKED_WIDTH, alpha: 1, rank: 2 });
      tags.push({ label, color, strong: edge.strong, rank: 2 });
    } else if (mode === 'faded') strokes.push({ path, color: palette.ink3, width: WEAK_WIDTH, alpha: FADED_ALPHA, rank: 0 });
  }
  for (const link of shape.links) {
    if (selected === null && current) {
      if (!reading.has(link.link.blockKey)) continue;
      strokes.push({ path: link.path, color: palette.ref, width: LINK_WIDTH, alpha: 1, rank: 3 });
      tags.push({ label: link.label, color: palette.ref, strong: false, rank: 3 });
      continue;
    }
    if (selected === null && marks?.links.has(link.key)) {
      strokes.push({ path: link.path, color: palette.glow, width: LINK_WIDTH, alpha: 1, rank: 3 });
      tags.push({ label: link.label, color: palette.glow, strong: false, rank: 3 });
      continue;
    }
    if (!isPicked(selected, link.link.blockKey, link.system.key)) continue;
    strokes.push({ path: link.path, color: palette.ink3, width: LINK_WIDTH, alpha: 1, rank: 2 });
    tags.push({ label: link.label, color: palette.ink3, strong: false, rank: 2 });
  }
  const container = new Container();
  const lines = new Container();
  const counts = new Container();
  container.addChild(lines, counts);
  for (const stroke of [...strokes].sort((a, b) => a.rank - b.rank)) lines.addChild(routedEdge(stroke));
  for (const tag of [...tags].sort((a, b) => a.rank - b.rank)) counts.addChild(countTag(tag, palette, resolution));
  return container;
}

function macroTitles(shape: MacroLayout | undefined, view: ArcView) {
  if (!shape) return [];
  const { selected } = view;
  const arcs = shape.arcs.filter((arc) => !['faded', null].includes(arcMode(arc.edge, view))).map((arc) => ({ path: arc.path, title: edgeTitle(arc.edge) }));
  const links = shape.links.filter((link) => isPicked(selected, link.link.blockKey, link.system.key)).map((link) => ({ path: link.path, title: linkTitle(link.link, link.system) }));
  return [...arcs, ...links];
}

function syncMacroAccess(host: HTMLElement, shape: MacroLayout | undefined, view: ArcView, calm = false) {
  const { marks } = view;
  const reachable = (shape?.arcs ?? []).filter((arc) => arcMode(arc.edge, view) !== null);
  const wanted = new Map(reachable.map((arc) => [arc.edge.key, arc.edge]));
  const present = new Map<string, HTMLElement>();
  for (const element of host.querySelectorAll<HTMLElement>(`.${EDGE_ACCESS}`)) {
    if (wanted.has(element.dataset.edge ?? '')) present.set(element.dataset.edge as string, element);
    else element.remove();
  }
  for (const [key, edge] of wanted) {
    const element = present.get(key) ?? Object.assign(document.createElement('div'), { className: EDGE_ACCESS });
    element.dataset.edge = key;
    element.dataset.count = String(edge.count);
    element.dataset.strong = String(edge.strong);
    if (marks) element.dataset.pr = String(!calm && marks.edges.has(key));
    else delete element.dataset.pr;
    element.textContent = edgeTitle(edge);
    if (!element.parentNode) host.appendChild(element);
  }
}

export { macroGraphics, macroTitles, syncMacroAccess };
export type { ArcView };
