import { NAME_CHAR_W, NODE_H, PAD, PITCH, TOP, edgeCurve } from './lanternlayout';
import type { BlockTile, Column, EdgeCurve, Item, Layout, Pos } from './lanternlayout';
import { profileFor } from './lanternprofile';
import type { Layer } from './lanternprofile';
import { LABEL_H, LabelPlacer, pointAt } from './lanternmacrolabels';
import type { EdgeLabel, Rect } from './lanternmacrolabels';
import { macroRowOrder } from './lanternmacroorder';
import { arcAnchors, arcPath } from './lanternmacropath';
import type { ArcRoute } from './lanternmacropath';
import { bandWidth, cardHeight, cardWidth, purposeLines, stubWidth } from './lanternmacrocards';
import { BAND_LAYER, STUBS_LAYER, blocksLayer } from './lanternmacrolayers';
import type { BlockKind, GraphBlock, GraphEdge, GraphLink, GraphSystem, MacroGraph } from './lanternmacro';
import { linkKeyOf } from './lanternmacrorest';

const BAND_GAP = 10;
const SYSTEM_GAP = 16;
const SYSTEM_MIN_W = 150;
const SYSTEM_MAX_W = 260;
const ROW_GAP = 22;
const PORT_GAP = 9;
const PORT_PAD = 14;
const BULGE_BASE = 26;
const LANE_W = 14;
const LANE_CLEARANCE = 4;
const COLUMN_GAP = 70;
const ABOVE_RANK = 1000;

type Side = 'left' | 'right';

interface Port {
  id: string;
  rank: number;
}

interface Row {
  y: number;
  h: number;
}

interface Card {
  kind: BlockKind;
  lines: string[];
  h: number;
}

interface Draft {
  edge: GraphEdge;
  side: Side;
  rows: number;
  y1: number;
  y2: number;
  top: number;
  bottom: number;
  lane: number;
}

interface ArcShape {
  edge: GraphEdge;
  path: EdgeCurve[];
  label: EdgeLabel;
}

interface LinkShape {
  key: string;
  system: GraphSystem;
  link: GraphLink;
  path: EdgeCurve[];
  label: EdgeLabel;
}

interface MacroLayout {
  graph: MacroGraph;
  layout: Layout;
  arcs: ArcShape[];
  links: LinkShape[];
}

const NO_LINKS: ReadonlySet<string> = new Set();

function sideOf(fromRow: number, toRow: number): Side {
  return fromRow < toRow ? 'right' : 'left';
}

function portY(top: number, height: number, index: number, total: number) {
  return top + (height - (total - 1) * PORT_GAP) / 2 + index * PORT_GAP;
}

function rankOf(row: number, otherRow: number) {
  const distance = Math.abs(otherRow - row);
  return otherRow < row ? distance - ABOVE_RANK : ABOVE_RANK - distance;
}

function sortedPorts(ports: Port[]) {
  return [...ports].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

function collectPorts(arcs: readonly GraphEdge[], rowOf: ReadonlyMap<string, number>) {
  const ports = new Map<string, Port[]>();
  const add = (key: string, side: Side, port: Port) => {
    const slot = `${key}|${side}`;
    ports.set(slot, [...(ports.get(slot) ?? []), port]);
  };
  for (const edge of arcs) {
    const fromRow = rowOf.get(edge.fromKey) as number;
    const toRow = rowOf.get(edge.toKey) as number;
    const side = sideOf(fromRow, toRow);
    add(edge.fromKey, side, { id: `${edge.key}:from`, rank: rankOf(fromRow, toRow) });
    add(edge.toKey, side, { id: `${edge.key}:to`, rank: rankOf(toRow, fromRow) });
  }
  return new Map([...ports].map(([slot, list]) => [slot, sortedPorts(list)]));
}

function rowBoxes(order: string[], ports: Map<string, Port[]>, cards: ReadonlyMap<string, Card>) {
  const boxes = new Map<string, Row>();
  let y = TOP;
  for (const key of order) {
    const card = cards.get(key) as Card;
    const crowd = Math.max(ports.get(`${key}|left`)?.length ?? 0, ports.get(`${key}|right`)?.length ?? 0);
    boxes.set(key, { y, h: Math.max(card.h, 2 * PORT_PAD + (crowd - 1) * PORT_GAP) });
    y += boxes.get(key)!.h + ROW_GAP;
  }
  return { boxes, bottom: y - ROW_GAP + 24 };
}

function bandBoxes(order: string[], cards: ReadonlyMap<string, Card>) {
  const boxes = new Map<string, Row>();
  let y = TOP;
  for (const key of order) {
    const h = (cards.get(key) as Card).h;
    boxes.set(key, { y, h });
    y += h + BAND_GAP;
  }
  return { boxes, bottom: order.length ? y - BAND_GAP + 24 : TOP };
}

function endY(boxes: Map<string, Row>, ports: Map<string, Port[]>, key: string, side: Side, id: string) {
  const list = ports.get(`${key}|${side}`) as Port[];
  const row = boxes.get(key) as Row;
  return portY(row.y, row.h, list.findIndex((port) => port.id === id), list.length);
}

function draftArcs(arcs: readonly GraphEdge[], rowOf: ReadonlyMap<string, number>, ports: Map<string, Port[]>, boxes: Map<string, Row>): Draft[] {
  return arcs.map((edge) => {
    const side = sideOf(rowOf.get(edge.fromKey) as number, rowOf.get(edge.toKey) as number);
    const y1 = endY(boxes, ports, edge.fromKey, side, `${edge.key}:from`);
    const y2 = endY(boxes, ports, edge.toKey, side, `${edge.key}:to`);
    return { edge, side, rows: Math.abs((rowOf.get(edge.toKey) as number) - (rowOf.get(edge.fromKey) as number)), y1, y2, top: Math.min(y1, y2), bottom: Math.max(y1, y2), lane: 0 };
  });
}

function assignLanes(drafts: Draft[]) {
  const taken = new Map<string, Draft[]>();
  const shortestFirst = [...drafts].sort((a, b) => a.rows - b.rows || a.bottom - a.top - (b.bottom - b.top) || b.edge.count - a.edge.count || a.edge.key.localeCompare(b.edge.key));
  for (const draft of shortestFirst) {
    let lane = 0;
    while ((taken.get(`${draft.side}|${lane}`) ?? []).some((other) => draft.top < other.bottom + LANE_CLEARANCE && other.top < draft.bottom + LANE_CLEARANCE)) lane += 1;
    draft.lane = lane;
    taken.set(`${draft.side}|${lane}`, [...(taken.get(`${draft.side}|${lane}`) ?? []), draft]);
  }
}

function bulgeOf(lane: number) {
  return BULGE_BASE + lane * LANE_W;
}

function routeOf(card: Pos, draft: Draft): ArcRoute {
  const toward = draft.side === 'right' ? 1 : -1;
  return { x: draft.side === 'right' ? card.x + card.w : card.x, toward, reach: bulgeOf(draft.lane), y1: draft.y1, y2: draft.y2 };
}

const LINK_STOPS = [0.5, 0.4, 0.6, 0.3, 0.7];

function shownSystems(graph: MacroGraph, shown: ReadonlySet<string>): GraphSystem[] {
  return graph.systems
    .map((system) => ({ ...system, links: system.links.filter((link) => shown.has(linkKeyOf(link.blockKey, system.key))) }))
    .filter((system) => system.links.length > 0);
}

function systemWidth(systems: readonly GraphSystem[]) {
  const longest = systems.reduce((max, s) => Math.max(max, s.name.length), 8);
  return Math.max(SYSTEM_MIN_W, Math.min(SYSTEM_MAX_W, Math.round(longest * NAME_CHAR_W + 44)));
}

interface SystemSpot {
  x: number;
  w: number;
  top: number;
  bottomOf: number;
}

function systemColumn(systems: readonly GraphSystem[], spot: SystemSpot) {
  const layer = profileFor('', false).layers.find((l) => l.id === 'system') as Layer;
  const col: Column = { layer, items: [], w: spot.w, x: spot.x, bottom: 0, groups: [], top: spot.top };
  const pos = new Map<string, Pos>();
  systems.forEach((system, index) => {
    const item: Item = { key: system.key, label: system.name, dir: 'external' };
    col.items.push(item);
    pos.set(system.key, { x: spot.x, y: spot.top + TOP + index * PITCH, w: spot.w, h: NODE_H, col, item });
  });
  col.bottom = Math.max(spot.bottomOf, spot.top + TOP + systems.length * PITCH);
  return { col, pos };
}

function tileOf(block: GraphBlock, lines: string[]): BlockTile {
  return {
    files: block.files,
    kind: block.kind,
    purpose: block.purpose,
    lines,
    ...(block.caption ? { caption: block.caption } : {}),
    ...(block.unplaced ? { unplaced: true } : {}),
    ...(block.opens ? { opens: true } : {}),
  };
}

function placeBlocks(blocks: readonly GraphBlock[], boxes: Map<string, Row>, cards: ReadonlyMap<string, Card>, x: number, w: number, col: Column) {
  const pos = new Map<string, Pos>();
  for (const block of blocks) {
    const row = boxes.get(block.key) as Row;
    const item: Item = { key: block.key, label: block.name, dir: '', block: tileOf(block, (cards.get(block.key) as Card).lines) };
    pos.set(block.key, { x, y: row.y, w, h: row.h, col, item });
    col.items.push(item);
  }
  return pos;
}

function blocksInOrder(graph: MacroGraph, order: readonly string[]) {
  const byKey = new Map(graph.blocks.map((block) => [block.key, block]));
  return order.map((key) => byKey.get(key) as GraphBlock);
}

function layoutMacro(graph: MacroGraph, shown: ReadonlySet<string> = NO_LINKS): MacroLayout {
  const order = macroRowOrder(graph);
  const features = blocksInOrder(graph, order.features);
  const foundation = blocksInOrder(graph, order.foundation);
  const stubs = blocksInOrder(graph, order.stubs);
  const lines = graph.edges.filter((edge) => !edge.quiet);
  const rowOf = new Map(order.features.map((key, row) => [key, row]));
  const ports = collectPorts(lines, rowOf);
  const cardW = cardWidth(graph);
  const cards = new Map(graph.blocks.map((block) => {
    const text = purposeLines(block, cardW);
    return [block.key, { kind: block.kind, lines: text, h: cardHeight(block, text) }];
  }));
  const rows = rowBoxes(order.features, ports, cards);
  const band = bandBoxes(order.foundation, cards);
  const stubRows = bandBoxes(order.stubs, cards);
  const drafts = draftArcs(lines, rowOf, ports, rows.boxes);
  assignLanes(drafts);
  const reach = { left: 0, right: COLUMN_GAP / 2 };
  for (const draft of drafts) reach[draft.side] = Math.max(reach[draft.side], bulgeOf(draft.lane));

  const cols: Column[] = [];
  const pos = new Map<string, Pos>();
  let width = PAD;
  const leftW = foundation.length ? Math.max(bandWidth(graph), systemWidth(graph.systems)) : 0;
  let belowBand: SystemSpot | null = null;
  if (foundation.length) {
    const bandCol: Column = { layer: BAND_LAYER, items: [], w: leftW, x: width, bottom: band.bottom, groups: [] };
    for (const [key, p] of placeBlocks(foundation, band.boxes, cards, bandCol.x, bandCol.w, bandCol)) pos.set(key, p);
    cols.push(bandCol);
    belowBand = { x: bandCol.x, w: bandCol.w, top: band.bottom + SYSTEM_GAP, bottomOf: 0 };
    width = bandCol.x + bandCol.w + COLUMN_GAP;
  }
  if (features.length || !foundation.length) {
    const blocksCol: Column = { layer: blocksLayer(graph), items: [], w: reach.left + cardW + reach.right, x: width, bottom: rows.bottom, groups: [] };
    for (const [key, p] of placeBlocks(features, rows.boxes, cards, blocksCol.x + reach.left, cardW, blocksCol)) pos.set(key, p);
    cols.push(blocksCol);
    width = blocksCol.x + blocksCol.w;
  }
  if (stubs.length) {
    const stubCol: Column = { layer: STUBS_LAYER, items: [], w: stubWidth(graph), x: width + COLUMN_GAP / 2, bottom: stubRows.bottom, groups: [] };
    for (const [key, p] of placeBlocks(stubs, stubRows.boxes, cards, stubCol.x, stubCol.w, stubCol)) pos.set(key, p);
    cols.push(stubCol);
    width = stubCol.x + stubCol.w;
  }
  const systems = shownSystems(graph, shown);
  if (systems.length) {
    const aside: SystemSpot = { x: width + COLUMN_GAP, w: systemWidth(systems), top: 0, bottomOf: cols.reduce((max, col) => Math.max(max, col.bottom), TOP) };
    const outside = systemColumn(systems, belowBand ?? aside);
    for (const [key, p] of outside.pos) pos.set(key, p);
    cols.push(outside.col);
    if (!belowBand) width = outside.col.x + outside.col.w;
  }

  const routes = drafts.map((draft) => ({ edge: draft.edge, route: routeOf(pos.get(draft.edge.fromKey) as Pos, draft) }));
  const drawnArcs = routes.map(({ edge, route }) => ({ edge, route, path: arcPath(route) }));
  const drawnLinks = systems.flatMap((system) => system.links.map((link) => {
    const curve = edgeCurve(pos.get(link.blockKey) as Pos, pos.get(system.key) as Pos);
    return { key: linkKeyOf(link.blockKey, system.key), system, link, path: [curve], anchors: LINK_STOPS.map((t) => pointAt(curve, t)) };
  }));

  const placer = new LabelPlacer([...pos.values()]);
  for (const arc of drawnArcs) placer.addPath(arc.edge.key, arc.path);
  for (const link of drawnLinks) placer.addPath(link.key, link.path);
  const strongestFirst = [...drawnArcs].sort((a, b) => b.edge.count - a.edge.count || a.edge.key.localeCompare(b.edge.key));
  const labelled = new Map(strongestFirst.map((arc) => [arc.edge.key, placer.place(arc.edge.key, arcAnchors(arc.route, LABEL_H), String(arc.edge.count))]));
  const arcs = drawnArcs.map(({ edge, path }) => ({ edge, path, label: labelled.get(edge.key) as EdgeLabel }));
  const links = drawnLinks.map(({ anchors, ...link }) => ({ ...link, label: placer.place(link.key, anchors, String(link.link.count)) }));

  const height = cols.reduce((max, col) => Math.max(max, col.bottom), TOP) + 24;
  const layout: Layout = { cols, pos, edges: [], width: width + PAD + 44, height, count: pos.size };
  return { graph, layout, arcs, links };
}

function shapeRects(shape: MacroLayout): Rect[] {
  return [...shape.arcs.map((arc) => arc.label), ...shape.links.map((link) => link.label)];
}

export { layoutMacro, shapeRects };
export type { MacroLayout };
