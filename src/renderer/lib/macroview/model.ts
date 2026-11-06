import { SYSTEM_KEY, blockKey } from '../lanternmacro';
import { blockName, isFoundationId, systemName } from '../lanternmacronames';
import type { AreasPayload } from './types';

const TO_ASSIGN_NOTE = 'Features that are not in an area yet.';

interface ModelFeature {
  id: string;
  key: string;
  areaId: string;
  name: string;
  purpose: string;
  files: number;
}

interface ModelArea {
  id: string;
  key: string;
  name: string;
  purpose: string;
  files: number;
  pending: boolean;
  features: ModelFeature[];
}

interface ModelEntry {
  id: string;
  key: string;
  name: string;
  files: number;
}

interface ModelLink {
  from: string;
  to: string;
  count: number;
  main: boolean;
}

type Uses = ReadonlyMap<string, number>;

interface ModelSystem {
  id: string;
  key: string;
  name: string;
  total: number;
  features: Uses;
  foundation: Uses;
  areas: Uses;
}

interface MacroViewModel {
  areas: ModelArea[];
  foundation: ModelEntry[];
  systems: ModelSystem[];
  areaLinks: ModelLink[];
  featureLinks: ModelLink[];
  features: ReadonlyMap<string, ModelFeature>;
  areaById: ReadonlyMap<string, ModelArea>;
  filesOf: ReadonlyMap<string, readonly string[]>;
  foundationUsers: ReadonlyMap<string, ReadonlySet<string>>;
  usesOfBlock: ReadonlyMap<string, Uses>;
  usesOfFile: ReadonlyMap<string, Uses>;
}

function pairId(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function areaOf(id: string, name: string, purpose: string, files: number, pending: boolean, featureIds: readonly string[], payload: AreasPayload): ModelArea {
  const detail = Object.hasOwn(payload.areas.details, id) ? payload.areas.details[id] : null;
  const sizes = new Map((detail?.blocks ?? []).map((block) => [block.id, block.files]));
  const features = featureIds.map((feature) => ({
    id: feature,
    key: blockKey(feature),
    areaId: id,
    name: blockName(feature),
    purpose: Object.hasOwn(payload.texts, feature) ? payload.texts[feature].trim() : '',
    files: sizes.get(feature) ?? 0,
  }));
  return { id, key: blockKey(id), name, purpose, files, pending, features };
}

function areasOf(payload: AreasPayload): ModelArea[] {
  const { level0 } = payload.areas;
  const placed = level0.areas.map((area) => areaOf(area.id, area.name, area.purpose, area.files, false, area.features, payload));
  const pending = level0.toAssign;
  return pending ? [...placed, areaOf(pending.id, pending.name, TO_ASSIGN_NOTE, pending.files, true, pending.features, payload)] : placed;
}

function areaLinksOf(payload: AreasPayload): ModelLink[] {
  const mains = new Set(payload.areas.level0.mainLinks.map((link) => pairId(link.a, link.b)));
  const sums = new Map<string, ModelLink>();
  for (const link of payload.areas.level0.links) {
    const id = pairId(link.from, link.to);
    const known = sums.get(id);
    if (known) known.count += link.count;
    else sums.set(id, { from: link.from, to: link.to, count: link.count, main: mains.has(id) });
  }
  return [...sums.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function featureLinksOf(payload: AreasPayload, features: ReadonlyMap<string, ModelFeature>): ModelLink[] {
  const mains = new Set<string>();
  for (const detail of Object.values(payload.areas.details)) for (const link of detail.mainLinks) mains.add(pairId(link.a, link.b));
  const sums = new Map<string, ModelLink>();
  for (const edge of payload.view.edges) {
    if (!features.has(edge.from) || !features.has(edge.to)) continue;
    const id = pairId(edge.from, edge.to);
    const known = sums.get(id);
    if (known) known.count += edge.count;
    else sums.set(id, { from: edge.from, to: edge.to, count: edge.count, main: mains.has(id) });
  }
  return [...sums.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function foundationUsersOf(payload: AreasPayload, features: ReadonlyMap<string, ModelFeature>) {
  const users = new Map<string, Set<string>>();
  for (const edge of payload.view.edges) {
    const [feature, core] = features.has(edge.from) && isFoundationId(edge.to) ? [edge.from, edge.to] : features.has(edge.to) && isFoundationId(edge.from) ? [edge.to, edge.from] : [null, null];
    if (feature && core) users.set(core, (users.get(core) ?? new Set()).add(feature));
  }
  return users;
}

function sumByArea(links: readonly { block: string; count: number }[], features: ReadonlyMap<string, ModelFeature>): Uses {
  const areas = new Map<string, number>();
  for (const link of links) {
    const area = features.get(link.block)?.areaId;
    if (area) areas.set(area, (areas.get(area) ?? 0) + link.count);
  }
  return areas;
}

function systemsOf(payload: AreasPayload, features: ReadonlyMap<string, ModelFeature>): ModelSystem[] {
  const entries = new Set(payload.areas.level0.foundation.map((entry) => entry.id));
  return payload.view.external
    .map((entry) => {
      const inFeatures = entry.blocks.filter((link) => features.has(link.block));
      const inFoundation = entry.blocks.filter((link) => entries.has(link.block));
      const total = [...inFeatures, ...inFoundation].reduce((sum, link) => sum + link.count, 0);
      return {
        id: entry.system,
        key: `${SYSTEM_KEY}${entry.system}`,
        name: systemName(entry.system),
        total,
        features: new Map(inFeatures.map((link): [string, number] => [link.block, link.count])),
        foundation: new Map(inFoundation.map((link): [string, number] => [link.block, link.count])),
        areas: sumByArea(inFeatures, features),
      };
    })
    .filter((system) => system.total > 0)
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

function usesOfBlocks(systems: readonly ModelSystem[]): ReadonlyMap<string, Uses> {
  const byBlock = new Map<string, Map<string, number>>();
  for (const system of systems) {
    for (const [block, count] of [...system.features, ...system.foundation]) byBlock.set(block, (byBlock.get(block) ?? new Map()).set(system.key, count));
  }
  return byBlock;
}

function usesOfFiles(payload: AreasPayload, systems: readonly ModelSystem[]): ReadonlyMap<string, Uses> {
  const known = new Set(systems.map((system) => system.id));
  const byFile = new Map<string, Uses>();
  for (const [path, uses] of Object.entries(payload.systemsByPath)) {
    const listed = uses.filter((use) => known.has(use.system));
    if (listed.length) byFile.set(path, new Map(listed.map((use): [string, number] => [`${SYSTEM_KEY}${use.system}`, use.count])));
  }
  return byFile;
}

function filesByFeature(blockByPath: AreasPayload['blockByPath']) {
  const grouped = new Map<string, string[]>();
  for (const path of Object.keys(blockByPath).sort()) {
    const block = blockByPath[path];
    const list = grouped.get(block);
    if (list) list.push(path);
    else grouped.set(block, [path]);
  }
  return grouped;
}

function buildModel(payload: AreasPayload): MacroViewModel {
  const areas = areasOf(payload);
  const features = new Map(areas.flatMap((area) => area.features.map((feature): [string, ModelFeature] => [feature.id, feature])));
  const systems = systemsOf(payload, features);
  return {
    areas,
    foundation: payload.areas.level0.foundation.map((entry) => ({ id: entry.id, key: blockKey(entry.id), name: blockName(entry.id), files: entry.files })),
    systems,
    areaLinks: areaLinksOf(payload),
    featureLinks: featureLinksOf(payload, features),
    features,
    areaById: new Map(areas.map((area) => [area.id, area])),
    filesOf: filesByFeature(payload.blockByPath),
    foundationUsers: foundationUsersOf(payload, features),
    usesOfBlock: usesOfBlocks(systems),
    usesOfFile: usesOfFiles(payload, systems),
  };
}

export { buildModel, pairId };
export type { ModelArea, ModelEntry, ModelFeature, ModelLink, ModelSystem, Uses, MacroViewModel };
