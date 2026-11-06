import type { ParsedRecord } from './lantern-parse';
import { resolvePlatform } from './lantern-platforms';
import type { PlatformRule } from './lantern-platforms';
import type { Arrow } from './lantern-types';

const TEST_ROLE = 'test';
const ENTRY_ROLE = 'entry';
const CORE_PREFIX = 'core:';
const MIN_STRONG_EDGE = 8;
const ARROWS: readonly Arrow[] = ['>', '<', '=', '@'];

type MacroGroups = Readonly<Record<string, readonly string[]>>;

interface MacroOptions {
  platforms: PlatformRule[];
  groups?: MacroGroups;
  dropEntryRelations?: boolean;
  minStrongEdge?: number;
}

interface MacroBlock {
  id: string;
  files: number;
}

interface MacroEdge {
  from: string;
  to: string;
  count: number;
  arrows: Record<Arrow, number>;
  strong: boolean;
}

interface MacroExternal {
  system: string;
  blocks: { block: string; count: number }[];
}

interface MacroView {
  recordCount: number;
  testCount: number;
  blocks: MacroBlock[];
  edges: MacroEdge[];
  crossBlockRelations: number;
  external: MacroExternal[];
}

function groupOf(block: string, groups: MacroGroups) {
  const found = Object.entries(groups).find(([, members]) => members.includes(block));
  return found ? found[0] : block;
}

function blockOf(record: ParsedRecord, platforms: PlatformRule[], groups: MacroGroups) {
  const feature = record.feature ?? `${CORE_PREFIX}${resolvePlatform(platforms, record.path)}`;
  return groupOf(feature, groups);
}

function bump(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function emptyArrows(): Record<Arrow, number> {
  return Object.fromEntries(ARROWS.map((arrow) => [arrow, 0])) as Record<Arrow, number>;
}

function byCountThenName(a: { count: number; name: string }, b: { count: number; name: string }) {
  return b.count - a.count || a.name.localeCompare(b.name);
}

function addEdge(edges: Map<string, MacroEdge>, from: string, to: string, arrow: Arrow) {
  const key = `${from} -> ${to}`;
  const edge = edges.get(key) ?? { from, to, count: 0, arrows: emptyArrows(), strong: false };
  edge.count += 1;
  edge.arrows[arrow] += 1;
  edges.set(key, edge);
}

function addExternal(external: Map<string, Map<string, number>>, system: string, block: string) {
  const perBlock = external.get(system) ?? new Map<string, number>();
  bump(perBlock, block);
  external.set(system, perBlock);
}

function listBlocks(sizes: Map<string, number>): MacroBlock[] {
  return [...sizes]
    .map(([id, files]) => ({ id, files }))
    .sort((a, b) => byCountThenName({ count: a.files, name: a.id }, { count: b.files, name: b.id }));
}

function listEdges(edges: Map<string, MacroEdge>, minStrongEdge: number): MacroEdge[] {
  return [...edges]
    .map(([name, edge]) => ({ name, edge: { ...edge, strong: edge.count >= minStrongEdge } }))
    .sort((a, b) => byCountThenName({ count: a.edge.count, name: a.name }, { count: b.edge.count, name: b.name }))
    .map(({ edge }) => edge);
}

function listExternal(external: Map<string, Map<string, number>>): MacroExternal[] {
  return [...external]
    .map(([system, perBlock]) => ({
      system,
      blocks: [...perBlock].map(([block, count]) => ({ block, count })).sort((a, b) => a.block.localeCompare(b.block)),
    }))
    .sort((a, b) => b.blocks.length - a.blocks.length || a.system.localeCompare(b.system));
}

function deriveMacroView(records: ParsedRecord[], options: MacroOptions): MacroView {
  const groups = options.groups ?? {};
  const minStrongEdge = options.minStrongEdge ?? MIN_STRONG_EDGE;
  const shipped = records.filter((record) => record.role !== TEST_ROLE);
  const blockByPath = new Map(shipped.map((record) => [record.path, blockOf(record, options.platforms, groups)]));
  const sizes = new Map<string, number>();
  const edges = new Map<string, MacroEdge>();
  const external = new Map<string, Map<string, number>>();

  for (const record of shipped) {
    const from = blockByPath.get(record.path) as string;
    bump(sizes, from);
    if (options.dropEntryRelations && record.role === ENTRY_ROLE) continue;
    for (const relation of record.relations) {
      if (relation.ext !== null) {
        addExternal(external, relation.ext, from);
        continue;
      }
      const to = relation.to === null ? undefined : blockByPath.get(relation.to);
      if (to === undefined || to === from) continue;
      addEdge(edges, from, to, relation.arrow);
    }
  }

  const listedEdges = listEdges(edges, minStrongEdge);
  return {
    recordCount: records.length,
    testCount: records.length - shipped.length,
    blocks: listBlocks(sizes),
    edges: listedEdges,
    crossBlockRelations: listedEdges.reduce((sum, edge) => sum + edge.count, 0),
    external: listExternal(external),
  };
}

export { MIN_STRONG_EDGE, deriveMacroView };
export type { MacroBlock, MacroEdge, MacroExternal, MacroGroups, MacroOptions, MacroView };
