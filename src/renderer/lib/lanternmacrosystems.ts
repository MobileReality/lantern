import type { MacroLoad } from '../../main/lantern-macro-load';
import { SYSTEM_KEY, blockKey } from './lanternmacro';
import { blockName, isFoundationId, systemName } from './lanternmacronames';

type Payload = Pick<Extract<MacroLoad, { ok: true }>, 'view' | 'areas'>;

interface SystemFeature {
  id: string;
  key: string;
  name: string;
  count: number;
}

interface SystemArea {
  id: string;
  key: string;
  name: string;
  count: number;
  features: SystemFeature[];
}

interface SystemEntry {
  id: string;
  key: string;
  name: string;
  count: number;
}

interface SystemUses {
  system: string;
  key: string;
  name: string;
  total: number;
  areas: SystemArea[];
  foundation: SystemEntry[];
}

function byCountThenName<T extends { count: number; name: string }>(a: T, b: T) {
  return b.count - a.count || a.name.localeCompare(b.name);
}

function placeOf(areas: NonNullable<Payload['areas']>) {
  const places = new Map<string, { id: string; name: string }>();
  for (const area of areas.level0.areas) for (const feature of area.features) places.set(feature, { id: area.id, name: area.name });
  const pending = areas.level0.toAssign;
  if (pending) for (const feature of pending.features) places.set(feature, { id: pending.id, name: pending.name });
  return places;
}

function systemUses(payload: Payload, system: string): SystemUses | null {
  const entry = payload.view.external.find((candidate) => candidate.system === system);
  if (!entry || !payload.areas) return null;
  const places = placeOf(payload.areas);
  const areas = new Map<string, SystemArea>();
  const foundation: SystemEntry[] = [];
  for (const link of entry.blocks) {
    if (isFoundationId(link.block)) {
      foundation.push({ id: link.block, key: blockKey(link.block), name: blockName(link.block), count: link.count });
      continue;
    }
    const place = places.get(link.block);
    if (!place) continue;
    const area = areas.get(place.id) ?? { id: place.id, key: blockKey(place.id), name: place.name, count: 0, features: [] };
    area.count += link.count;
    area.features.push({ id: link.block, key: blockKey(link.block), name: blockName(link.block), count: link.count });
    areas.set(place.id, area);
  }
  const listed = [...areas.values()].map((area) => ({ ...area, features: area.features.sort(byCountThenName) })).sort(byCountThenName);
  foundation.sort(byCountThenName);
  const total = [...listed, ...foundation].reduce((sum, part) => sum + part.count, 0);
  return { system, key: `${SYSTEM_KEY}${system}`, name: systemName(system), total, areas: listed, foundation };
}

export { systemUses };
export type { SystemArea, SystemEntry, SystemUses };
