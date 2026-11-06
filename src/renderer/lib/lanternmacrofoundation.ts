import type { MacroAreas } from '../../main/lantern-macro-areas';
import type { FoundationLink, PlatformFiles, PlatformUses } from '../../main/lantern-macro-foundation';
import type { Arrow } from '../../main/lantern-types';
import { FOUNDATION_KEY, blockKey } from './lanternmacro';
import type { GraphBlock, MacroGraph } from './lanternmacro';
import { platformOfFoundation } from './lanternmacronames';

type Standing = 'uses' | 'used by' | 'connects to';

interface FoundationPartner {
  id: string;
  count: number;
  out: number;
  in: number;
  standing: Standing;
  arrows: Record<Arrow, number>;
}

interface FoundationFocus {
  ids: ReadonlySet<string>;
  partners: ReadonlySet<string>;
  platformFeatures: ReadonlySet<string>;
  platformAreas: ReadonlySet<string>;
  usesFeatures: ReadonlySet<string>;
  usesAreas: ReadonlySet<string>;
}

const ARROW_LIST: readonly Arrow[] = ['>', '<', '=', '@'];

function standingOf(out: number, incoming: number): Standing {
  if (out > 0 && incoming > 0) return 'connects to';
  return out > 0 ? 'uses' : 'used by';
}

function foundationPartners(links: readonly FoundationLink[], id: string): FoundationPartner[] {
  const partners = new Map<string, FoundationPartner>();
  for (const link of links) {
    const outgoing = link.from === id;
    if (!outgoing && link.to !== id) continue;
    const other = outgoing ? link.to : link.from;
    const partner = partners.get(other) ?? { id: other, count: 0, out: 0, in: 0, standing: 'uses' as Standing, arrows: { '>': 0, '<': 0, '=': 0, '@': 0 } };
    if (outgoing) partner.out += link.count;
    else partner.in += link.count;
    partner.count += link.count;
    for (const arrow of ARROW_LIST) partner.arrows[arrow] += link.arrows[arrow];
    partners.set(other, partner);
  }
  return [...partners.values()]
    .map((partner) => ({ ...partner, standing: standingOf(partner.out, partner.in) }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

function filesOnPlatform(platforms: readonly PlatformFiles[] | undefined, platform: string) {
  return platforms?.find((entry) => entry.platform === platform)?.files ?? 0;
}

function relationsOnPlatform(uses: readonly PlatformUses[] | undefined, platform: string) {
  return uses?.find((entry) => entry.platform === platform)?.count ?? 0;
}

function platformCarriers(blocks: readonly GraphBlock[], platform: string): { block: GraphBlock; files: number }[] {
  return blocks
    .filter((block) => block.kind === 'feature')
    .map((block) => ({ block, files: filesOnPlatform(block.platforms, platform) }))
    .filter((carrier) => carrier.files > 0)
    .sort((a, b) => b.files - a.files || a.block.id.localeCompare(b.block.id));
}

function platformReached(blocks: readonly GraphBlock[], platform: string): { block: GraphBlock; relations: number }[] {
  return blocks
    .filter((block) => block.kind === 'feature')
    .map((block) => ({ block, relations: relationsOnPlatform(block.uses, platform) }))
    .filter((reached) => reached.relations > 0)
    .sort((a, b) => b.relations - a.relations || a.block.id.localeCompare(b.block.id));
}

function selectedFoundation(areas: MacroAreas, selection: string | null): string[] {
  if (selection === null) return [];
  if (selection === FOUNDATION_KEY) return areas.level0.foundation.map((entry) => entry.id);
  return areas.level0.foundation.filter((entry) => blockKey(entry.id) === selection).map((entry) => entry.id);
}

function foundationFocus(scene: Pick<MacroGraph, 'level' | 'area'>, areas: MacroAreas, selection: string | null): FoundationFocus | null {
  const ids = selectedFoundation(areas, selection);
  if (!ids.length) return null;
  const links = scene.level === 'area' && scene.area && Object.hasOwn(areas.details, scene.area.id) ? areas.details[scene.area.id].foundationLinks : areas.level0.foundationLinks;
  const partners = new Set(ids.flatMap((id) => foundationPartners(links, id).map((partner) => partner.id)));
  for (const id of ids) partners.delete(id);
  const platform = ids.length === 1 ? platformOfFoundation(ids[0]) : null;
  const platformFeatures = new Set<string>();
  const platformAreas = new Set<string>();
  const usesFeatures = new Set<string>();
  const usesAreas = new Set<string>();
  if (platform !== null) {
    for (const detail of Object.values(areas.details)) {
      for (const [feature, platforms] of Object.entries(detail.featurePlatforms)) if (filesOnPlatform(platforms, platform) > 0) platformFeatures.add(feature);
    }
    const allAreas = [...areas.level0.areas, ...(areas.level0.toAssign ? [areas.level0.toAssign] : [])];
    for (const area of allAreas) if (filesOnPlatform(area.platforms, platform) > 0) platformAreas.add(area.id);
    for (const detail of Object.values(areas.details)) {
      for (const [feature, uses] of Object.entries(detail.featureUses)) if (relationsOnPlatform(uses, platform) > 0 && !partners.has(feature)) usesFeatures.add(feature);
    }
    for (const area of allAreas) if (relationsOnPlatform(area.uses, platform) > 0 && !partners.has(area.id)) usesAreas.add(area.id);
  }
  return { ids: new Set(ids), partners, platformFeatures, platformAreas, usesFeatures, usesAreas };
}

function foundationNear(scene: MacroGraph, selection: string | null): Set<string> {
  const near = new Set<string>();
  const block = scene.blocks.find((candidate) => candidate.key === selection);
  if (!block || block.kind !== 'core') return near;
  const present = new Map(scene.blocks.map((candidate) => [candidate.id, candidate.key]));
  for (const partner of foundationPartners(scene.foundationLinks ?? [], block.id)) {
    const key = present.get(partner.id);
    if (key) near.add(key);
  }
  const platform = platformOfFoundation(block.id);
  if (platform !== null) for (const carrier of platformCarriers(scene.blocks, platform)) near.add(carrier.block.key);
  return near;
}

function foundationUsesNear(scene: MacroGraph, selection: string | null): Set<string> {
  const block = scene.blocks.find((candidate) => candidate.key === selection);
  if (!block || block.kind !== 'core') return new Set();
  const platform = platformOfFoundation(block.id);
  if (platform === null) return new Set();
  const partners = new Set(foundationPartners(scene.foundationLinks ?? [], block.id).map((partner) => partner.id));
  return new Set(platformReached(scene.blocks, platform).filter((reached) => !partners.has(reached.block.id)).map((reached) => reached.block.key));
}

export { filesOnPlatform, foundationFocus, foundationNear, foundationPartners, foundationUsesNear, platformCarriers, platformReached };
export type { FoundationFocus, FoundationPartner, Standing };
