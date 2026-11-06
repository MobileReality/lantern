import { blockName, isFoundationId } from '../shared/lantern-names';
import { pairKey, selectMainLinks } from '../shared/lantern-main-links';
import type { LanternArea } from './lantern-areas';
import { deriveMacroView } from './lantern-macro';
import type { MacroBlock, MacroEdge, MacroGroups, MacroView } from './lantern-macro';
import { foundationLinksOf, platformFilesOf, platformUsesOf } from './lantern-macro-foundation';
import type { FoundationLink, PlatformFiles, PlatformUses } from './lantern-macro-foundation';
import type { ParsedRecord } from './lantern-parse';
import type { PlatformRule } from './lantern-platforms';

const TO_ASSIGN_ID = 'to-assign';
const TO_ASSIGN_NAME = 'To assign';
const MAX_AREAS = 7;
const TEST_ROLE = 'test';

interface AreaNode {
  id: string;
  name: string;
  purpose: string;
  features: string[];
  files: number;
  platforms: PlatformFiles[];
  uses: PlatformUses[];
}

interface ToAssignNode {
  id: typeof TO_ASSIGN_ID;
  name: string;
  features: string[];
  files: number;
  platforms: PlatformFiles[];
  uses: PlatformUses[];
}

interface AreaLink {
  from: string;
  to: string;
  count: number;
}

interface AreaMainLink {
  a: string;
  b: string;
  count: number;
}

interface AreaSystem {
  system: string;
  count: number;
}

interface AreaStub {
  id: string;
  name: string;
  out: number;
  in: number;
  count: number;
}

interface AreasLevel0 {
  areas: AreaNode[];
  toAssign: ToAssignNode | null;
  foundation: MacroBlock[];
  links: AreaLink[];
  foundationLinks: FoundationLink[];
  mainLinks: AreaMainLink[];
  systems: Record<string, AreaSystem[]>;
}

interface AreaDetail {
  blocks: MacroBlock[];
  edges: MacroEdge[];
  foundationLinks: FoundationLink[];
  featurePlatforms: Record<string, PlatformFiles[]>;
  featureUses: Record<string, PlatformUses[]>;
  mainLinks: AreaMainLink[];
  stubs: AreaStub[];
  systems: AreaSystem[];
}

interface MacroAreas {
  level0: AreasLevel0;
  details: Record<string, AreaDetail>;
}

type AreasDerivation = { ok: true; areas: MacroAreas } | { ok: false; warning: string };

interface Group {
  id: string;
  members: string[];
}

function areasProblem(areas: readonly LanternArea[], declared: ReadonlySet<string>): string | null {
  if (!areas.length) return 'the file lists no area';
  if (areas.length > MAX_AREAS) return `${areas.length} areas, at most ${MAX_AREAS} are allowed`;
  const seenAreas = new Set<string>();
  const seenFeatures = new Set<string>();
  for (const area of areas) {
    if (area.id === TO_ASSIGN_ID || seenAreas.has(area.id)) return `area "${area.id}" is reserved or declared twice`;
    if (declared.has(area.id)) return `area "${area.id}" is also a feature id`;
    seenAreas.add(area.id);
    if (!area.features.length) return `area "${area.id}" has no features`;
    for (const feature of area.features) {
      if (seenFeatures.has(feature)) return `feature "${feature}" is listed twice`;
      if (!declared.has(feature)) return `feature "${feature}" is not declared in .lantern/features`;
      seenFeatures.add(feature);
    }
  }
  return null;
}

function featuresWithRecords(records: readonly ParsedRecord[]) {
  const features = new Set<string>();
  for (const record of records) if (record.role !== TEST_ROLE && record.feature) features.add(record.feature);
  return features;
}

function groupsOf(groups: readonly Group[]): MacroGroups {
  return Object.fromEntries(groups.map((group) => [group.id, group.members]));
}

function byCountThenName<T extends { count: number }>(name: (item: T) => string) {
  return (a: T, b: T) => b.count - a.count || name(a).localeCompare(name(b));
}

function mainLinksOf(edges: readonly { from: string; to: string; count: number }[], nodes: number): AreaMainLink[] {
  const weights = new Map<string, number>();
  for (const edge of edges) {
    const key = pairKey(edge.from, edge.to);
    weights.set(key, (weights.get(key) ?? 0) + edge.count);
  }
  return [...selectMainLinks(weights, nodes)]
    .map((key) => {
      const [a, b] = key.split('|');
      return { a, b, count: weights.get(key) as number };
    })
    .sort(byCountThenName((link) => `${link.a}|${link.b}`));
}

function systemsOf(view: MacroView, inside: ReadonlySet<string>): AreaSystem[] {
  return view.external
    .map((external) => ({ system: external.system, count: external.blocks.filter((b) => inside.has(b.block)).reduce((sum, b) => sum + b.count, 0) }))
    .filter((use) => use.count > 0)
    .sort(byCountThenName((use) => use.system));
}

function systemsPerNode(view: MacroView, ids: readonly string[]): Record<string, AreaSystem[]> {
  return Object.fromEntries(ids.map((id) => [id, systemsOf(view, new Set([id]))]));
}

function levelZero(records: ParsedRecord[], platforms: PlatformRule[], areas: readonly LanternArea[], groups: readonly Group[]): AreasLevel0 {
  const view = deriveMacroView(records, { platforms, groups: groupsOf(groups) });
  const filesOf = new Map(view.blocks.map((block) => [block.id, block.files]));
  const files = (id: string) => filesOf.get(id) ?? 0;
  const membersOf = new Map(groups.map((group) => [group.id, group.members]));
  const nodeIds = groups.map((group) => group.id);
  const nodes = new Set(nodeIds);
  const links = view.edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)).map(({ from, to, count }) => ({ from, to, count }));
  const toAssign = membersOf.get(TO_ASSIGN_ID);
  const groupOfFeature = new Map(groups.flatMap((group) => group.members.map((member) => [member, group.id] as const)));
  const nodeOf = (record: ParsedRecord) => (record.feature ? (groupOfFeature.get(record.feature) ?? null) : null);
  const platformsOf = platformFilesOf(records, platforms, nodeOf);
  const usesOf = platformUsesOf(records, platforms, nodeOf, platformsOf);
  return {
    areas: areas
      .filter((area) => nodes.has(area.id))
      .map((area) => ({
        id: area.id,
        name: blockName(area.id),
        purpose: area.description,
        features: membersOf.get(area.id) ?? [],
        files: files(area.id),
        platforms: platformsOf.get(area.id) ?? [],
        uses: usesOf.get(area.id) ?? [],
      })),
    toAssign: toAssign ? { id: TO_ASSIGN_ID, name: TO_ASSIGN_NAME, features: toAssign, files: files(TO_ASSIGN_ID), platforms: platformsOf.get(TO_ASSIGN_ID) ?? [], uses: usesOf.get(TO_ASSIGN_ID) ?? [] } : null,
    foundation: view.blocks.filter((block) => isFoundationId(block.id)),
    links,
    foundationLinks: foundationLinksOf(view.edges, nodes),
    mainLinks: mainLinksOf(links, nodeIds.length),
    systems: systemsPerNode(view, nodeIds),
  };
}

function stubsOf(view: MacroView, inside: ReadonlySet<string>, others: ReadonlySet<string>): AreaStub[] {
  const stubs = new Map<string, AreaStub>();
  for (const edge of view.edges) {
    const leaving = inside.has(edge.from) && others.has(edge.to);
    const entering = others.has(edge.from) && inside.has(edge.to);
    if (!leaving && !entering) continue;
    const id = leaving ? edge.to : edge.from;
    const stub = stubs.get(id) ?? { id, name: id === TO_ASSIGN_ID ? TO_ASSIGN_NAME : blockName(id), out: 0, in: 0, count: 0 };
    if (leaving) stub.out += edge.count;
    else stub.in += edge.count;
    stub.count += edge.count;
    stubs.set(id, stub);
  }
  return [...stubs.values()].sort(byCountThenName((stub) => stub.id));
}

function levelOne(records: ParsedRecord[], platforms: PlatformRule[], group: Group, groups: readonly Group[]): AreaDetail {
  const others = groups.filter((other) => other.id !== group.id);
  const view = deriveMacroView(records, { platforms, groups: groupsOf(others) });
  const inside = new Set(group.members);
  const edges = view.edges.filter((edge) => inside.has(edge.from) && inside.has(edge.to));
  const nodeOf = (record: ParsedRecord) => (record.feature && inside.has(record.feature) ? record.feature : null);
  const platformsOf = platformFilesOf(records, platforms, nodeOf);
  return {
    blocks: view.blocks.filter((block) => inside.has(block.id)),
    edges,
    foundationLinks: foundationLinksOf(view.edges, inside),
    featurePlatforms: Object.fromEntries(platformsOf),
    featureUses: Object.fromEntries(platformUsesOf(records, platforms, nodeOf, platformsOf)),
    mainLinks: mainLinksOf(edges, inside.size),
    stubs: stubsOf(view, inside, new Set(others.map((other) => other.id))),
    systems: systemsOf(view, inside),
  };
}

function deriveMacroAreas(records: ParsedRecord[], platforms: PlatformRule[], areas: readonly LanternArea[], declared: ReadonlySet<string>): AreasDerivation {
  const problem = areasProblem(areas, declared);
  if (problem) return { ok: false, warning: problem };
  const withRecords = featuresWithRecords(records);
  const placed = new Set(areas.flatMap((area) => area.features));
  const unplaced = [...withRecords].filter((feature) => !placed.has(feature)).sort();
  const groups: Group[] = [
    ...areas.map((area) => ({ id: area.id, members: area.features.filter((feature) => withRecords.has(feature)) })),
    ...(unplaced.length ? [{ id: TO_ASSIGN_ID, members: unplaced }] : []),
  ];
  const nonEmpty = groups.filter((group) => group.members.length);
  return {
    ok: true,
    areas: {
      level0: levelZero(records, platforms, areas, nonEmpty),
      details: Object.fromEntries(nonEmpty.map((group) => [group.id, levelOne(records, platforms, group, nonEmpty)])),
    },
  };
}

export { TO_ASSIGN_ID, deriveMacroAreas };
export type { FoundationLink, PlatformFiles, PlatformUses };
export type { AreaDetail, AreaLink, AreaMainLink, AreaNode, AreaStub, AreaSystem, AreasDerivation, AreasLevel0, MacroAreas, ToAssignNode };
