import { fileLabel } from './util';
import { platformLabel, profileOf } from './lanternscope';
import { dirTileKey } from './lanterncollapse';
import type { CollapseGroup } from './lanterncollapse';
import type { Layer } from './lanternprofile';
import type { Arrow, LanternMap, LanternNode, LanternRelation } from '../../main/lantern';

const NAME_CHAR_W = 6.9;
const GROUP_CHAR_W = 5.9;

const NO_FEATURE = '-';

interface Filters {
  platform: string;
  roles: string[];
  features: string[];
  dirs: string[];
  kinds: Arrow[];
  q: string;
  wip: boolean;
  missing: boolean;
  only: ReadonlySet<string> | null;
}

interface Boundary {
  platform: string;
  path: string;
}

interface DirTile {
  count: number;
  keys: string[];
}

interface BlockTile {
  files: number;
  kind: 'feature' | 'core' | 'stub';
  purpose: string;
  lines: string[];
  caption?: string;
  unplaced?: boolean;
  opens?: boolean;
}

interface Item {
  key: string;
  label: string;
  dir: string;
  node?: LanternNode;
  boundary?: Boundary;
  tile?: DirTile;
  block?: BlockTile;
}

interface Column {
  layer: Layer;
  items: Item[];
  w: number;
  x: number;
  bottom: number;
  groups: { dir: string; y: number }[];
  top?: number;
}

interface Pos {
  x: number;
  y: number;
  w: number;
  h: number;
  col: Column;
  item: Item;
}

interface Edge {
  r: LanternRelation;
  fromKey: string;
  toKey: string;
}

interface Layout {
  cols: Column[];
  pos: Map<string, Pos>;
  edges: Edge[];
  width: number;
  height: number;
  count: number;
  tileOf?: ReadonlyMap<string, string>;
}

function isWip(n: LanternNode) {
  return n.marker !== '.';
}

function isMissing(n: LanternNode) {
  return n.freshness === 'gone';
}

function emptyFilters(): Filters {
  return { platform: '', roles: [], features: [], dirs: [], kinds: [], q: '', wip: false, missing: false, only: null };
}

function activeGroups(f: Filters, showUnmapped: boolean) {
  return [f.q.trim() !== '', f.kinds.length > 0, f.roles.length > 0, f.features.length > 0, f.wip || f.missing || showUnmapped, f.dirs.length > 0, f.only !== null].filter(Boolean).length;
}

function resetFilters(f: Filters) {
  Object.assign(f, emptyFilters(), { platform: f.platform });
}

function inDirs(n: LanternNode, dirs: string[]) {
  if (!dirs.length) return true;
  return dirs.some((d) => (d === '.' ? n.dir === '.' : n.dir === d || n.dir.startsWith(`${d}/`)));
}

function isVisible(n: LanternNode, f: Filters) {
  if (f.only && !f.only.has(n.path)) return false;
  if (f.platform && n.platform !== f.platform) return false;
  if (f.roles.length && !f.roles.includes(n.role)) return false;
  if (!inDirs(n, f.dirs)) return false;
  if (f.features.length && !f.features.includes(n.feature ?? NO_FEATURE)) return false;
  if (f.wip && !isWip(n)) return false;
  if (f.missing && !isMissing(n)) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!n.path.toLowerCase().includes(q) && !n.purpose.toLowerCase().includes(q)) return false;
  }
  return true;
}

const PAD = 28;
const GAP = 60;
const TOP = 78;
const PITCH = 26;
const NODE_H = 22;
const TILE_H = 40;
const GROUP_H = 24;
const GROUP_GAP = 10;
const RELATED_DIR = '↑ related';
const RELATED_ROOM = GROUP_H + GROUP_GAP;

interface SystemItem {
  name: string;
  dir: string;
  boundary?: Boundary;
}

function collectEdges(data: LanternMap, f: Filters, visSet: Set<string>) {
  const byPath = new Map(data.nodes.map((n) => [n.path, n]));
  const edges: Edge[] = [];
  const systems = new Map<string, SystemItem>();
  const allowed = (path: string) => !f.only || f.only.has(path);
  const boundary = (path: string) => {
    const other = byPath.get(path) as LanternNode;
    const key = `p:${path}`;
    systems.set(key, { name: fileLabel(path), dir: `↗ ${platformLabel(data, other.platform)}`, boundary: { platform: other.platform ?? '', path } });
    return key;
  };
  for (const r of data.relations) {
    if (f.kinds.length && !f.kinds.includes(r.arrow)) continue;
    const fromNode = byPath.get(r.from);
    if (!visSet.has(r.from)) {
      const enters = f.platform && fromNode && fromNode.platform !== f.platform && r.to && visSet.has(r.to) && allowed(r.from);
      if (enters) edges.push({ r, fromKey: boundary(r.from), toKey: r.to as string });
      continue;
    }
    if (r.to && !byPath.has(r.to)) {
      systems.set(`?${r.to}`, { name: r.to, dir: 'not in the map' });
      edges.push({ r, fromKey: r.from, toKey: `?${r.to}` });
    } else if (r.to) {
      const target = byPath.get(r.to) as LanternNode;
      if (visSet.has(r.to)) edges.push({ r, fromKey: r.from, toKey: r.to });
      else if (f.platform && target.platform !== f.platform && allowed(r.to)) edges.push({ r, fromKey: r.from, toKey: boundary(r.to) });
    } else {
      systems.set(`ext:${r.ext}`, { name: r.ext ?? '', dir: 'external' });
      edges.push({ r, fromKey: r.from, toKey: `ext:${r.ext}` });
    }
  }
  return { edges, systems };
}

function layoutGraph(data: LanternMap, f: Filters): Layout {
  const vis = data.nodes.filter((n) => isVisible(n, f));
  const visSet = new Set(vis.map((n) => n.path));
  const { edges, systems } = collectEdges(data, f, visSet);
  const profile = profileOf(data, f.platform);

  const all: Column[] = profile.layers.map((layer) => ({ layer, items: [], w: 0, x: 0, bottom: 0, groups: [] }));
  const colOf = new Map(all.map((c) => [c.layer.id, c]));
  for (const n of vis) colOf.get(profile.layerOf(n.role).id)?.items.push({ node: n, key: n.path, label: fileLabel(n.path), dir: n.dir });
  for (const k of [...systems.keys()].sort()) {
    const s = systems.get(k) as SystemItem;
    colOf.get('system')?.items.push({ key: k, label: s.name, dir: s.dir, boundary: s.boundary });
  }
  const cols = all.filter((c) => c.items.length);
  for (const c of cols) {
    c.items.sort((a, b) => (a.dir !== b.dir ? (a.dir < b.dir ? -1 : 1) : a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  }

  let x = PAD;
  let maxY = TOP;
  const pos = new Map<string, Pos>();
  for (const c of cols) {
    const longest = c.items.reduce((m, it) => Math.max(m, it.label.length), 8);
    c.w = Math.max(150, Math.min(260, Math.round(longest * NAME_CHAR_W + 44)));
    c.x = x;
    x += c.w + GAP;
    placeColumn(c, c.items, pos);
    maxY = Math.max(maxY, c.bottom);
  }
  return { cols, pos, edges, width: x - GAP + PAD + 44, height: maxY + 24 + RELATED_ROOM, count: vis.length };
}

const TILE_RUN = '\0tiles';

function placeColumn(c: Column, items: Item[], pos: Map<string, Pos>, liftedCount = 0) {
  let y = TOP;
  let last: string | null = null;
  c.groups = [];
  items.forEach((it, i) => {
    const dir = i < liftedCount ? RELATED_DIR : it.dir;
    if (it.tile && i >= liftedCount) {
      if (last !== null && last !== TILE_RUN) y += GROUP_GAP;
      last = TILE_RUN;
    } else if (dir !== last) {
      if (last !== null) y += GROUP_GAP;
      c.groups.push({ dir, y });
      y += GROUP_H;
      last = dir;
    }
    const h = it.tile ? TILE_H : NODE_H;
    pos.set(it.key, { x: c.x, y, w: c.w, h, col: c, item: it });
    y += h + PITCH - NODE_H;
  });
  c.bottom = y;
}

function dirGroups(base: Layout): CollapseGroup[] {
  const groups = new Map<string, string[]>();
  for (const c of base.cols) {
    for (const it of c.items) {
      if (!it.node) continue;
      const id = dirTileKey(c.layer.id, it.dir);
      const keys = groups.get(id);
      if (keys) keys.push(it.key);
      else groups.set(id, [it.key]);
    }
  }
  return [...groups].map(([id, keys]) => ({ id, keys }));
}

function collapseLayout(base: Layout, collapsed: ReadonlySet<string>): Layout {
  if (!collapsed.size) return base;
  const tileOf = new Map<string, string>();
  const pos = new Map<string, Pos>();
  const cols = base.cols.map((c) => {
    const runs = new Map<string, string[]>();
    for (const it of c.items) {
      if (!it.node) continue;
      const id = dirTileKey(c.layer.id, it.dir);
      if (!collapsed.has(id)) continue;
      const keys = runs.get(id);
      if (keys) keys.push(it.key);
      else runs.set(id, [it.key]);
    }
    const items: Item[] = [];
    for (const it of c.items) {
      const id = it.node ? dirTileKey(c.layer.id, it.dir) : '';
      const keys = runs.get(id);
      if (!keys) items.push(it);
      else if (!tileOf.has(keys[0])) {
        for (const key of keys) tileOf.set(key, id);
        items.push({ key: id, label: `${it.dir} · ${keys.length}`, dir: it.dir, tile: { count: keys.length, keys } });
      }
    }
    const col: Column = { ...c, items, groups: [], bottom: 0 };
    placeColumn(col, items, pos);
    return col;
  });
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const e of base.edges) {
    const fromKey = tileOf.get(e.fromKey) ?? e.fromKey;
    const toKey = tileOf.get(e.toKey) ?? e.toKey;
    if (fromKey === e.fromKey && toKey === e.toKey) edges.push(e);
    else if (fromKey !== toKey) {
      const id = `${fromKey}\0${toKey}\0${e.r.arrow}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ ...e, fromKey, toKey });
    }
  }
  const maxY = cols.reduce((m, c) => Math.max(m, c.bottom), TOP);
  return { ...base, cols, pos, edges, height: maxY + 24 + RELATED_ROOM, tileOf };
}

function arrangeLayout(base: Layout, lifted: ReadonlySet<string>): Layout {
  const pos = new Map<string, Pos>();
  const cols = base.cols.map((c) => {
    const col: Column = { ...c, groups: c.groups, bottom: c.bottom };
    const first = c.items.filter((it) => lifted.has(it.key));
    if (first.length) placeColumn(col, [...first, ...c.items.filter((it) => !lifted.has(it.key))], pos, first.length);
    else for (const it of c.items) pos.set(it.key, { ...(base.pos.get(it.key) as Pos), col });
    return col;
  });
  return { ...base, cols, pos };
}

interface EdgeCurve {
  from: { x: number; y: number };
  control1: { x: number; y: number };
  control2: { x: number; y: number };
  to: { x: number; y: number };
}

function edgeCurve(a: Pos, b: Pos): EdgeCurve {
  const ay = a.y + a.h / 2;
  const by = b.y + b.h / 2;
  if (a.col === b.col) {
    const x1 = a.x + a.w;
    const bulge = 16 + Math.min(34, Math.abs(ay - by) * 0.1);
    return { from: { x: x1, y: ay }, control1: { x: x1 + bulge, y: ay }, control2: { x: x1 + bulge, y: by }, to: { x: x1, y: by } };
  }
  const right = b.x > a.x;
  const xa = right ? a.x + a.w : a.x;
  const xb = right ? b.x : b.x + b.w;
  const d = (xb - xa) / 2;
  return { from: { x: xa, y: ay }, control1: { x: xa + d, y: ay }, control2: { x: xb - d, y: by }, to: { x: xb, y: by } };
}

function edgePath(a: Pos, b: Pos) {
  const curve = edgeCurve(a, b);
  return `M${curve.from.x},${curve.from.y} C${curve.control1.x},${curve.control1.y} ${curve.control2.x},${curve.control2.y} ${curve.to.x},${curve.to.y}`;
}

export { NAME_CHAR_W, GROUP_CHAR_W, NO_FEATURE, RELATED_DIR, PAD, GAP, TOP, PITCH, NODE_H, TILE_H, GROUP_H, GROUP_GAP, layoutGraph, arrangeLayout, dirGroups, collapseLayout, edgeCurve, edgePath, emptyFilters, isVisible, isWip, isMissing, activeGroups, resetFilters };
export type { BlockTile, Column, DirTile, Edge, EdgeCurve, Filters, Item, Layout, Layer, Pos };
