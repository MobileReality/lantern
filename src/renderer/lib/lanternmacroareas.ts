import type { MacroEdge, MacroView } from '../../main/lantern-macro';
import type { AreaDetail, AreaLink, AreaMainLink, AreaStub, AreaSystem, MacroAreas } from '../../main/lantern-macro-areas';
import { SYSTEM_KEY, blockKey, plural, purposeOf } from './lanternmacro';
import type { GraphArea, GraphBlock, GraphEdge, GraphSystem, MacroGraph, MacroTexts } from './lanternmacro';
import { blockName, isFoundationId, systemName } from './lanternmacronames';
import { pairKey } from './lanternmacrorest';

const TO_ASSIGN_ID = 'to-assign';
const TO_ASSIGN_NOTE = 'Features that are not in an area yet.';
const NO_ARROWS = { '>': 0, '<': 0, '=': 0, '@': 0 };

interface DrawnEdge {
  from: string;
  to: string;
  count: number;
  arrows?: MacroEdge['arrows'];
  strong?: boolean;
}

function isToAssign(id: string) {
  return id === TO_ASSIGN_ID;
}

function areaIds(areas: MacroAreas): string[] {
  return Object.keys(areas.details);
}

function areasSignature(areas: MacroAreas | null): string {
  return areas ? areaIds(areas).join('|') : '';
}

function featureCaption(features: number, files: number) {
  return `${plural(features, 'feature')} · ${plural(files, 'file')}`;
}

function foundationBlocks(areas: MacroAreas): GraphBlock[] {
  return areas.level0.foundation.map((entry) => ({ key: blockKey(entry.id), id: entry.id, name: blockName(entry.id), purpose: '', files: entry.files, kind: 'core' as const }));
}

function areaCards(areas: MacroAreas): GraphBlock[] {
  const { level0 } = areas;
  const cards = level0.areas
    .map((area) => ({
      key: blockKey(area.id),
      id: area.id,
      name: area.name,
      purpose: area.purpose,
      files: area.files,
      kind: 'feature' as const,
      caption: featureCaption(area.features.length, area.files),
      members: area.features.map(blockName),
      opens: area.id,
      platforms: area.platforms,
      uses: area.uses,
    }));
  const pending = level0.toAssign;
  if (!pending) return cards;
  return [
    ...cards,
    { key: blockKey(pending.id), id: pending.id, name: pending.name, purpose: TO_ASSIGN_NOTE, files: pending.files, kind: 'feature', caption: featureCaption(pending.features.length, pending.files), unplaced: true, members: pending.features.map(blockName), opens: pending.id, platforms: pending.platforms, uses: pending.uses },
  ];
}

function edgeOf(edge: DrawnEdge, names: ReadonlyMap<string, string>, mains: ReadonlySet<string>, minStrongEdge: number): GraphEdge {
  const [fromKey, toKey] = [blockKey(edge.from), blockKey(edge.to)];
  return {
    key: `${fromKey}>${toKey}`,
    fromKey,
    toKey,
    from: edge.from,
    to: edge.to,
    fromName: names.get(edge.from) ?? blockName(edge.from),
    toName: names.get(edge.to) ?? blockName(edge.to),
    count: edge.count,
    strong: edge.strong ?? edge.count >= minStrongEdge,
    quiet: isFoundationId(edge.from) || isFoundationId(edge.to),
    main: mains.has(pairKey(edge.from, edge.to)),
    arrows: edge.arrows ?? NO_ARROWS,
  };
}

function mainPairs(links: readonly AreaMainLink[]): Set<string> {
  return new Set(links.map((link) => pairKey(link.a, link.b)));
}

function systemOf(system: string, links: GraphSystem['links']): GraphSystem {
  return { key: `${SYSTEM_KEY}${system}`, system, name: systemName(system), links };
}

function systemsOfNodes(perNode: Readonly<Record<string, readonly AreaSystem[]>>, names: ReadonlyMap<string, string>): GraphSystem[] {
  const links = new Map<string, GraphSystem['links']>();
  for (const [node, uses] of Object.entries(perNode)) {
    if (!names.has(node)) continue;
    for (const use of uses) links.set(use.system, [...(links.get(use.system) ?? []), { blockKey: blockKey(node), block: node, blockName: names.get(node) as string, count: use.count }]);
  }
  return [...links].map(([system, list]) => systemOf(system, list)).sort((a, b) => b.links.length - a.links.length || a.system.localeCompare(b.system));
}

function totals(graph: Pick<MacroGraph, 'blocks' | 'edges'>) {
  return { files: graph.blocks.reduce((sum, block) => sum + block.files, 0), relations: graph.edges.reduce((sum, edge) => sum + edge.count, 0) };
}

function areasGraph(areas: MacroAreas, view: MacroView, minStrongEdge: number): MacroGraph {
  const blocks = [...areaCards(areas), ...foundationBlocks(areas)];
  const names = new Map(blocks.map((block) => [block.id, block.name]));
  const mains = mainPairs(areas.level0.mainLinks);
  const edges = areas.level0.links.filter((link: AreaLink) => names.has(link.from) && names.has(link.to)).map((link) => edgeOf(link, names, mains, minStrongEdge));
  const { files, relations } = totals({ blocks, edges });
  return { level: 'areas', files, tests: view.testCount, relations, blocks, edges, systems: systemsOfNodes(areas.level0.systems, names), foundationLinks: areas.level0.foundationLinks };
}

function stubCard(stub: AreaStub, files: number): GraphBlock {
  return {
    key: blockKey(stub.id),
    id: stub.id,
    name: stub.name,
    purpose: '',
    files,
    kind: 'stub',
    caption: plural(stub.count, 'relation'),
    opens: stub.id,
    traffic: { out: stub.out, in: stub.in },
  };
}

function featureSystems(view: MacroView, inside: ReadonlySet<string>): GraphSystem[] {
  return view.external
    .map((entry) => systemOf(entry.system, entry.blocks.filter((link) => inside.has(link.block)).map((link) => ({ blockKey: blockKey(link.block), block: link.block, blockName: blockName(link.block), count: link.count }))))
    .filter((system) => system.links.length > 0);
}

function areaInfo(areas: MacroAreas, id: string): GraphArea {
  const known = areas.level0.areas.find((area) => area.id === id);
  const pending = isToAssign(id) ? areas.level0.toAssign : null;
  const source = known ?? pending;
  return { id, name: source?.name ?? blockName(id), purpose: known?.purpose ?? (pending ? TO_ASSIGN_NOTE : ''), files: source?.files ?? 0, features: source?.features.map(blockName) ?? [] };
}

function areaGraph(areas: MacroAreas, id: string, view: MacroView, texts: MacroTexts, minStrongEdge: number): MacroGraph | null {
  if (!Object.hasOwn(areas.details, id)) return null;
  const detail: AreaDetail = areas.details[id];
  const features: GraphBlock[] = detail.blocks.map((block) => ({ key: blockKey(block.id), id: block.id, name: blockName(block.id), purpose: purposeOf(block.id, texts), files: block.files, kind: 'feature', platforms: detail.featurePlatforms[block.id] ?? [], uses: detail.featureUses[block.id] ?? [] }));
  const filesOf = new Map([...areas.level0.areas, ...(areas.level0.toAssign ? [areas.level0.toAssign] : [])].map((area) => [area.id, area.files]));
  const stubs = detail.stubs.map((stub) => stubCard(stub, filesOf.get(stub.id) ?? 0));
  const blocks = [...features, ...foundationBlocks(areas), ...stubs];
  const names = new Map(blocks.map((block) => [block.id, block.name]));
  const mains = mainPairs(detail.mainLinks);
  const edges = detail.edges.map((edge) => edgeOf(edge, names, mains, minStrongEdge));
  const { files, relations } = totals({ blocks: features, edges });
  return { level: 'area', area: areaInfo(areas, id), files, tests: view.testCount, relations, blocks, edges, systems: featureSystems(view, new Set(features.map((block) => block.id))), foundationLinks: detail.foundationLinks };
}

function cardMembers(areas: MacroAreas | undefined): ReadonlyMap<string, readonly string[]> {
  const members = new Map<string, readonly string[]>();
  if (!areas) return members;
  for (const area of areas.level0.areas) members.set(area.id, area.features);
  if (areas.level0.toAssign) members.set(areas.level0.toAssign.id, areas.level0.toAssign.features);
  return members;
}

function areaOfFeature(areas: MacroAreas | undefined, feature: string): { id: string; name: string } | null {
  if (!areas) return null;
  const known = areas.level0.areas.find((area) => area.features.includes(feature));
  if (known) return { id: known.id, name: known.name };
  const pending = areas.level0.toAssign;
  return pending?.features.includes(feature) ? { id: pending.id, name: pending.name } : null;
}

export { TO_ASSIGN_ID, areaGraph, areaOfFeature, areasGraph, areasSignature, cardMembers };
