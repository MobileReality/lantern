import { MACRO_STYLE_CLASSES } from '../lanternmacrostyles';
import type { Point, Rect } from './camera';
import { centerOf } from './camera';
import type { MacroViewMarks } from './marks';
import type { MacroViewModel } from './model';
import { pairId } from './model';
import type { Scene } from './build';
import { el } from './svg';

const BEND = 0.14;
const MIN_WIDTH = 1.2;
const MAX_WIDTH = 4.2;

interface Ribbon {
  from: Rect;
  to: Rect;
  count: number;
  className: string;
}

function exitPoint(rect: Rect, toward: Point): Point {
  const middle = centerOf(rect);
  const dx = toward.x - middle.x;
  const dy = toward.y - middle.y;
  if (!dx && !dy) return middle;
  const scale = Math.min(dx ? rect.w / 2 / Math.abs(dx) : Infinity, dy ? rect.h / 2 / Math.abs(dy) : Infinity);
  return { x: middle.x + dx * scale, y: middle.y + dy * scale };
}

function ribbonPath(from: Rect, to: Rect): string {
  const a = exitPoint(from, centerOf(to));
  const b = exitPoint(to, centerOf(from));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const normal = length ? { x: -(b.y - a.y) / length, y: (b.x - a.x) / length } : { x: 0, y: 0 };
  const control = { x: mid.x + normal.x * length * BEND, y: mid.y + normal.y * length * BEND };
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function widthOf(count: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, 0.9 + Math.log2(Math.max(1, count)) * 0.45));
}

function draw(parent: Element, ribbons: readonly Ribbon[]) {
  parent.replaceChildren();
  for (const ribbon of ribbons) el('path', `mv-ribbon ${ribbon.className}`, { d: ribbonPath(ribbon.from, ribbon.to), 'stroke-width': widthOf(ribbon.count).toFixed(2) }, parent);
}

function rectsOf(scene: Scene) {
  return new Map([...scene.items].map(([key, item]) => [key, item.rect]));
}

function touchedAreaPairs(model: MacroViewModel, marks: MacroViewMarks) {
  const pairs = new Set<string>();
  for (const link of model.featureLinks) {
    if (!marks.featureEdges.has(pairId(link.from, link.to))) continue;
    const [a, b] = [model.features.get(link.from)?.areaId, model.features.get(link.to)?.areaId];
    if (a && b && a !== b) pairs.add(pairId(a, b));
  }
  return pairs;
}

function areaRibbons(model: MacroViewModel, rects: ReadonlyMap<string, Rect>, marks: MacroViewMarks): Ribbon[] {
  const touched = touchedAreaPairs(model, marks);
  return model.areaLinks.flatMap((link) => {
    const [from, to] = [model.areaById.get(link.from), model.areaById.get(link.to)];
    const lit = touched.has(pairId(link.from, link.to));
    const [a, b] = [from && rects.get(from.key), to && rects.get(to.key)];
    return a && b && (link.main || lit) ? [{ from: a, to: b, count: link.count, className: lit ? MACRO_STYLE_CLASSES.lit : MACRO_STYLE_CLASSES.main }] : [];
  });
}

function featureRibbons(model: MacroViewModel, rects: ReadonlyMap<string, Rect>, marks: MacroViewMarks): Ribbon[] {
  return model.featureLinks.flatMap((link) => {
    const lit = marks.featureEdges.has(pairId(link.from, link.to));
    const [a, b] = [rects.get(model.features.get(link.from)?.key ?? ''), rects.get(model.features.get(link.to)?.key ?? '')];
    return a && b && (link.main || lit) ? [{ from: a, to: b, count: link.count, className: lit ? MACRO_STYLE_CLASSES.lit : MACRO_STYLE_CLASSES.main }] : [];
  });
}

function drawLinks(scene: Scene, model: MacroViewModel, marks: MacroViewMarks) {
  const rects = rectsOf(scene);
  let areas = scene.links.querySelector<SVGGElement>('.mv-alinks');
  let features = scene.links.querySelector<SVGGElement>('.mv-flinks');
  areas ??= el('g', 'mv-alinks', {}, scene.links);
  features ??= el('g', 'mv-flinks', {}, scene.links);
  draw(areas, areaRibbons(model, rects, marks));
  draw(features, featureRibbons(model, rects, marks));
}

function partnersOf(links: readonly { from: string; to: string; count: number }[], id: string) {
  return links.flatMap((link) => (link.from === id ? [{ id: link.to, count: link.count }] : link.to === id ? [{ id: link.from, count: link.count }] : []));
}

function hotRibbons(scene: Scene, model: MacroViewModel, key: string | null): Ribbon[] {
  if (!key) return [];
  const rects = rectsOf(scene);
  const own = rects.get(key);
  if (!own) return [];
  const feature = [...model.features.values()].find((candidate) => candidate.key === key);
  const area = model.areas.find((candidate) => candidate.key === key);
  const partners = feature ? partnersOf(model.featureLinks, feature.id).map((partner) => ({ rect: rects.get(model.features.get(partner.id)?.key ?? ''), count: partner.count })) : area ? partnersOf(model.areaLinks, area.id).map((partner) => ({ rect: rects.get(model.areaById.get(partner.id)?.key ?? ''), count: partner.count })) : [];
  return partners.flatMap((partner) => (partner.rect ? [{ from: own, to: partner.rect, count: partner.count, className: MACRO_STYLE_CLASSES.hot }] : []));
}

function drawHot(scene: Scene, model: MacroViewModel, key: string | null) {
  draw(scene.hot, hotRibbons(scene, model, key));
}

export { drawHot, drawLinks, exitPoint, ribbonPath, widthOf };
