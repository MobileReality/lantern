import { GROUP_GAP, GROUP_H, NAME_CHAR_W, NODE_H, PAD, PITCH, TOP } from './lanternlayout';
import type { Item, Layout } from './lanternlayout';
import type { EdgeCurve, Pos } from './lanternlayout';
import type { Arrow, LanternRelation } from '../../main/lantern';

const DENSE_COLUMN_RELATIONS = 25;
const ZONE_ROWS = 16;
const ZONE_MAX_COLUMNS = 3;
const ABOVE_MAX_COLUMNS = 6;
const ROW_GAP = 18;
const ZONE_GAP = 90;
const SUB_GAP = 22;
const AREA_THRESHOLD = 3;
const AREA_PAD = 7;
const ZONE_TOP = 10;
const ZONE_PAD = 14;
const CENTRE_GAP = 46;
const CENTRE_DROP_MAX = 260;
const CENTRE_HALO = 12;
const CENTRE_CAPTION = 28;
const MIN_COLUMN_W = 190;
const REL_PITCH = PITCH + 6;
const REL_GROUP_H = GROUP_H + 4;
const REL_GROUP_GAP = GROUP_GAP + 4;
const SPREAD = NODE_H - 8;

type Side = 'in' | 'out' | 'both';

type Refs = 'none' | 'mixed' | 'all';

interface Neighbour {
  item: Item;
  side: Side;
  relations: LanternRelation[];
  refs: boolean;
}

interface ZoneGroup {
  dir: string;
  x: number;
  y: number;
  w: number;
}

interface ZoneArea {
  key: string;
  dir: string;
  x: number;
  y: number;
  w: number;
  h: number;
  keys: string[];
}

type Placed = Pick<Pos, 'x' | 'y' | 'w' | 'h' | 'item'>;
type Box = Pick<Placed, 'x' | 'y' | 'w' | 'h'>;

interface Zone {
  side: Side | 'centre';
  refs: Refs;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
  groups: ZoneGroup[];
  areas: ZoneArea[];
}

interface RelationEdge {
  key: string;
  side: Side;
  ref: boolean;
  curve: EdgeCurve;
  relations: LanternRelation[];
  area?: { dir: string; count: number };
}

interface RelationLayout {
  centre: string;
  pos: Map<string, Placed>;
  zones: Zone[];
  edges: RelationEdge[];
  width: number;
  height: number;
  count: number;
}

interface DenseColumn {
  name: string;
  count: number;
}

function sideOfRelation(arrow: Arrow, outgoing: boolean): Side {
  if (arrow === '=') return 'both';
  const sends = arrow === '<' ? !outgoing : outgoing;
  return sends ? 'out' : 'in';
}

function sideOf(sides: Set<Side>): Side {
  if (sides.has('both') || (sides.has('in') && sides.has('out'))) return 'both';
  return sides.has('in') ? 'in' : 'out';
}

function refsOf(neighbours: Neighbour[]): Refs {
  const refs = neighbours.filter((n) => n.refs).length;
  if (!refs) return 'none';
  return refs === neighbours.length ? 'all' : 'mixed';
}

function neighboursOf(base: Layout, live: string) {
  const found = new Map<string, { sides: Set<Side>; relations: LanternRelation[] }>();
  for (const e of base.edges) {
    const outgoing = e.fromKey === live;
    if (!outgoing && e.toKey !== live) continue;
    const other = outgoing ? e.toKey : e.fromKey;
    if (other === live) continue;
    const entry = found.get(other) ?? { sides: new Set<Side>(), relations: [] };
    entry.sides.add(sideOfRelation(e.r.arrow, outgoing));
    entry.relations.push(e.r);
    found.set(other, entry);
  }
  const list: Neighbour[] = [];
  for (const [key, entry] of found) {
    const item = base.pos.get(key)?.item;
    if (item) list.push({ item, side: sideOf(entry.sides), relations: entry.relations, refs: entry.relations.every((r) => r.arrow === '@') });
  }
  return list;
}

function denseColumn(base: Layout, live: string): DenseColumn | null {
  const counts = new Map<string, DenseColumn>();
  const seen = new Set<string>();
  for (const e of base.edges) {
    const other = e.fromKey === live ? e.toKey : e.toKey === live ? e.fromKey : null;
    if (!other || other === live || seen.has(other)) continue;
    seen.add(other);
    const layer = base.pos.get(other)?.col.layer;
    if (!layer) continue;
    const entry = counts.get(layer.id) ?? { name: layer.name, count: 0 };
    entry.count += 1;
    counts.set(layer.id, entry);
  }
  let best: DenseColumn | null = null;
  for (const c of counts.values()) if (c.count >= DENSE_COLUMN_RELATIONS && (!best || c.count > best.count)) best = c;
  return best;
}

function cardWidth(longest: number) {
  return Math.max(150, Math.min(260, Math.round(longest * NAME_CHAR_W + 44)));
}

function byDirThenName(a: Item, b: Item) {
  if (a.dir !== b.dir) return a.dir < b.dir ? -1 : 1;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

interface FlowArea {
  dir: string;
  x: number;
  y: number;
  w: number;
  h: number;
  keys: string[];
}

interface Flow {
  w: number;
  cardW: number;
  bottom: number;
  placed: { item: Item; x: number; y: number }[];
  groups: ZoneGroup[];
  areas: FlowArea[];
}

function sectionsOf(items: Item[]) {
  const dirs: { dir: string; items: Item[] }[] = [];
  for (const it of [...items].sort(byDirThenName)) {
    const last = dirs[dirs.length - 1];
    if (last && last.dir === it.dir) last.items.push(it);
    else dirs.push({ dir: it.dir, items: [it] });
  }
  return dirs;
}

function areaSpan(count: number, columns: number, cardW: number) {
  const squarish = Math.round(Math.sqrt((count * REL_PITCH) / (cardW + SUB_GAP)));
  return Math.min(columns, Math.max(1, Math.ceil(count / ZONE_ROWS), squarish));
}

function shortestShelf(colY: number[], span: number) {
  let best = { col: 0, y: Infinity };
  for (let col = 0; col + span <= colY.length; col += 1) {
    const y = Math.max(...colY.slice(col, col + span));
    if (y < best.y) best = { col, y };
  }
  return best;
}

function flowZone(items: Item[], maxColumns: number): Flow {
  const sections = sectionsOf(items);
  const rows = sections.reduce((n, g) => n + 1 + g.items.length, 0);
  const cardW = cardWidth(items.reduce((m, it) => Math.max(m, it.label.length), 8));
  const columns = Math.min(maxColumns, Math.max(1, Math.ceil(rows / ZONE_ROWS)), Math.max(1, Math.round(Math.sqrt((rows * REL_PITCH) / (cardW + SUB_GAP)))));
  const colY: number[] = Array.from({ length: columns }, () => TOP);
  const placed: Flow['placed'] = [];
  const groups: ZoneGroup[] = [];
  const areas: FlowArea[] = [];
  let usedColumns = 1;
  let bottom = TOP;
  for (const g of sections) {
    const isArea = g.items.length > AREA_THRESHOLD;
    const span = isArea ? areaSpan(g.items.length, columns, cardW) : 1;
    const gridRows = Math.ceil(g.items.length / span);
    const h = isArea ? REL_GROUP_H + (gridRows - 1) * REL_PITCH + NODE_H + AREA_PAD : REL_GROUP_H + gridRows * REL_PITCH;
    const { col, y } = shortestShelf(colY, span);
    const x = col * (cardW + SUB_GAP);
    if (isArea) areas.push({ dir: g.dir, x: x - AREA_PAD, y, w: span * cardW + (span - 1) * SUB_GAP + 2 * AREA_PAD, h, keys: g.items.map((it) => it.key) });
    else groups.push({ dir: g.dir, x, y, w: cardW });
    g.items.forEach((it, i) => { placed.push({ item: it, x: x + Math.floor(i / gridRows) * (cardW + SUB_GAP), y: y + REL_GROUP_H + (i % gridRows) * REL_PITCH }); });
    for (let c = col; c < col + span; c += 1) colY[c] = y + h + REL_GROUP_GAP;
    usedColumns = Math.max(usedColumns, col + span);
    bottom = Math.max(bottom, y + h);
  }
  return { w: usedColumns * cardW + (usedColumns - 1) * SUB_GAP, cardW, bottom, placed, groups, areas };
}

function sideEdge(side: Side, node: Box, other: Box, index: number, total: number) {
  const spread = total > 1 ? (index / (total - 1) - 0.5) * SPREAD : 0;
  if (side === 'both') {
    const x1 = other.x + other.w / 2;
    const y1 = other.y + other.h;
    const x2 = node.x + (node.w * (index + 1)) / (total + 1);
    const y2 = node.y;
    const d = (y2 - y1) / 2;
    return { from: { x: x1, y: y1 }, control1: { x: x1, y: y1 + d }, control2: { x: x2, y: y2 - d }, to: { x: x2, y: y2 } };
  }
  const cy = node.y + node.h / 2 + spread;
  const oy = other.y + other.h / 2;
  const [xa, ya, xb, yb] = side === 'in' ? [other.x + other.w, oy, node.x, cy] : [node.x + node.w, cy, other.x, oy];
  const d = (xb - xa) / 2;
  return { from: { x: xa, y: ya }, control1: { x: xa + d, y: ya }, control2: { x: xb - d, y: yb }, to: { x: xb, y: yb } };
}

interface EdgeTarget {
  key: string;
  box: Box;
  relations: LanternRelation[];
  area?: RelationEdge['area'];
}

function relationEdges(zones: Zone[], all: Neighbour[], pos: Map<string, Placed>, centre: Box) {
  const byKey = new Map(all.map((n) => [n.item.key, n]));
  const edges: RelationEdge[] = [];
  for (const z of zones) {
    if (z.side === 'centre') continue;
    const inAreas = new Set(z.areas.flatMap((a) => a.keys));
    const targets: EdgeTarget[] = z.areas.map((a) => ({
      key: a.key,
      box: a,
      relations: a.keys.flatMap((k) => byKey.get(k)?.relations ?? []),
      area: { dir: a.dir, count: a.keys.length },
    }));
    for (const n of all) if (n.side === z.side && !inAreas.has(n.item.key)) targets.push({ key: n.item.key, box: pos.get(n.item.key) as Placed, relations: n.relations });
    const fan = z.side === 'both' ? (t: EdgeTarget) => [t.box.x, t.box.y] : (t: EdgeTarget) => [t.box.y, t.box.x];
    targets.sort((a, b) => fan(a)[0] - fan(b)[0] || fan(a)[1] - fan(b)[1]);
    targets.forEach((t, i) => { edges.push({ key: t.key, side: z.side as Side, ref: t.relations.every((r) => r.arrow === '@'), curve: sideEdge(z.side as Side, centre, t.box, i, targets.length), relations: t.relations, area: t.area }); });
  }
  return edges;
}

function relationLayout(base: Layout, live: string): RelationLayout {
  const centreItem = (base.pos.get(live) as Placed).item;
  const all = neighboursOf(base, live);
  const flows = new Map<Side, Flow>();
  for (const side of ['in', 'out', 'both'] as const) {
    const items = all.filter((n) => n.side === side).map((n) => n.item);
    if (items.length) flows.set(side, flowZone(items, side === 'both' ? ABOVE_MAX_COLUMNS : ZONE_MAX_COLUMNS));
  }
  const left = flows.get('in');
  const right = flows.get('out');
  const above = flows.get('both');

  const centreW = cardWidth(centreItem.label.length);
  const columnW = Math.max(MIN_COLUMN_W, centreW + 2 * SUB_GAP);
  const rowW = (left ? left.w + ZONE_GAP : 0) + columnW + (right ? ZONE_GAP + right.w : 0);
  const extra = Math.max(0, (above?.w ?? 0) - rowW);
  const shift = left && !right ? extra : !left && right ? 0 : extra / 2;
  const leftX = PAD + shift;
  const columnX = leftX + (left ? left.w + ZONE_GAP : 0);
  const rightX = columnX + columnW + ZONE_GAP;
  const rowRight = leftX + rowW;
  const centreMid = columnX + columnW / 2;
  const aboveX = above ? Math.min(Math.max(centreMid - above.w / 2, PAD), Math.max(PAD, rowRight - above.w)) : 0;

  const zones: Zone[] = [];
  const pos = new Map<string, Placed>();
  const place = (flow: Flow, side: Side, x: number, top: number) => {
    const dy = top - ZONE_TOP;
    for (const p of flow.placed) pos.set(p.item.key, { x: x + p.x, y: p.y + dy, w: flow.cardW, h: NODE_H, item: p.item });
    const areas = flow.areas.map((a) => ({ ...a, key: `area:${side}:${a.dir}`, x: x + a.x, y: a.y + dy }));
    zones.push({ side, refs: refsOf(all.filter((n) => n.side === side)), x, y: top, w: flow.w, h: flow.bottom - ZONE_TOP + ZONE_PAD, count: flow.placed.length, groups: flow.groups.map((g) => ({ ...g, x: x + g.x, y: g.y + dy })), areas });
  };
  if (above) place(above, 'both', aboveX, ZONE_TOP);
  const rowTop = above ? above.bottom + ZONE_PAD + ROW_GAP : ZONE_TOP;
  if (left) place(left, 'in', leftX, rowTop);
  if (right) place(right, 'out', rightX, rowTop);

  const itemsTop = rowTop + TOP - ZONE_TOP;
  const sideBottom = Math.max(left ? left.bottom + rowTop - ZONE_TOP : itemsTop, right ? right.bottom + rowTop - ZONE_TOP : itemsTop);
  const drop = above ? 0 : Math.max(0, Math.min((sideBottom - itemsTop - ZONE_PAD - NODE_H) / 2, CENTRE_DROP_MAX));
  const centreY = (above ? rowTop + CENTRE_HALO : itemsTop) + drop;
  const centre: Placed = { x: columnX + (columnW - centreW) / 2, y: centreY, w: centreW, h: NODE_H, item: centreItem };
  pos.set(live, centre);
  zones.push({ side: 'centre', refs: 'none', x: columnX, y: centreY - CENTRE_HALO, w: columnW, h: NODE_H + CENTRE_HALO + CENTRE_CAPTION, count: 1, groups: [], areas: [] });

  const edges = relationEdges(zones, all, pos, centre);

  const width = Math.max(rowRight, aboveX + (above?.w ?? 0)) + PAD;
  const height = Math.max(sideBottom + ZONE_PAD, centreY + NODE_H + CENTRE_CAPTION + ZONE_PAD) + 24;
  return { centre: live, pos, zones, edges, width, height, count: all.length + 1 };
}

export { AREA_THRESHOLD, DENSE_COLUMN_RELATIONS, denseColumn, neighboursOf, relationLayout };
export type { DenseColumn, Neighbour, RelationEdge, RelationLayout, Refs, Side, Zone, ZoneArea, ZoneGroup };
