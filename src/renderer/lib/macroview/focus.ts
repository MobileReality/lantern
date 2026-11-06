import { FOUNDATION_KEY, blockKey } from '../lanternmacro';
import type { FoundationFocus } from '../lanternmacrofoundation';
import type { Camera, Point, Rect, Size } from './camera';
import { centerOf, contains, toWorld, worldRect } from './camera';
import { featuresWeight } from './lod';
import type { MacroViewLayout } from './layout';
import type { ModelSystem, MacroViewModel } from './model';

type Direction = 'left' | 'right' | 'up' | 'down';

interface Related {
  keys: ReadonlySet<string>;
  systems: ReadonlySet<string>;
  uses: ReadonlySet<string>;
  systemCounts: ReadonlyMap<string, number>;
  counts: ReadonlyMap<string, number>;
}

const NO_COUNTS: ReadonlyMap<string, number> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();

interface Placed {
  key: string;
  rect: Rect;
}

const OFF_AXIS_WEIGHT = 2.2;
const ENTER_WEIGHT = 0.5;
const STAY_WEIGHT = 0.2;

function usersOf(model: MacroViewModel, featureIds: Iterable<string>) {
  const keys = new Set<string>();
  for (const id of featureIds) {
    const feature = model.features.get(id);
    if (!feature) continue;
    keys.add(feature.key);
    const area = model.areaById.get(feature.areaId);
    if (area) keys.add(area.key);
  }
  return keys;
}

function foundationOf(model: MacroViewModel, featureIds: ReadonlySet<string>) {
  return model.foundation.filter((entry) => [...(model.foundationUsers.get(entry.id) ?? [])].some((id) => featureIds.has(id))).map((entry) => entry.key);
}

function sumUses(model: MacroViewModel, blockIds: Iterable<string>) {
  const sums = new Map<string, number>();
  for (const id of blockIds) for (const [system, count] of model.usesOfBlock.get(id) ?? []) sums.set(system, (sums.get(system) ?? 0) + count);
  return sums;
}

function withSystems(keys: Iterable<string>, systemCounts: ReadonlyMap<string, number>, uses: ReadonlySet<string> = NO_KEYS): Related {
  return { keys: new Set([...keys, ...systemCounts.keys()]), systems: new Set(systemCounts.keys()), uses, systemCounts, counts: NO_COUNTS };
}

function relatedToFeatures(model: MacroViewModel, own: ReadonlySet<string>, partners: Iterable<string>, file: string | null = null): Related {
  const everyone = new Set([...own, ...partners]);
  const systemCounts = file ? (model.usesOfFile.get(file) ?? NO_COUNTS) : sumUses(model, own);
  return withSystems([...usersOf(model, everyone), ...foundationOf(model, own)], systemCounts);
}

function partnersOfFeature(model: MacroViewModel, id: string) {
  return model.featureLinks.flatMap((link) => (link.from === id ? [link.to] : link.to === id ? [link.from] : []));
}

function foundationPartnerKeys(model: MacroViewModel, foundation: FoundationFocus): string[] {
  const entries = model.foundation.filter((entry) => foundation.partners.has(entry.id)).map((entry) => entry.key);
  const areas = [...foundation.partners, ...foundation.platformAreas].flatMap((id) => model.areaById.get(id)?.key ?? []);
  const features = usersOf(model, [...foundation.partners, ...foundation.platformFeatures]);
  return [...entries, ...areas, ...features];
}

function foundationUsesKeys(model: MacroViewModel, foundation: FoundationFocus): string[] {
  const areas = [...foundation.usesAreas].flatMap((id) => model.areaById.get(id)?.key ?? []);
  return [...areas, ...usersOf(model, foundation.usesFeatures)];
}

function relatedToSystem(model: MacroViewModel, system: ModelSystem): Related {
  const counts = new Map<string, number>();
  for (const [id, count] of system.features) counts.set(model.features.get(id)?.key ?? id, count);
  for (const [id, count] of system.foundation) counts.set(blockKey(id), count);
  for (const [id, count] of system.areas) counts.set(model.areaById.get(id)?.key ?? id, count);
  const keys = new Set([...usersOf(model, system.features.keys()), ...[...system.foundation.keys()].map(blockKey), system.key]);
  return { keys, systems: new Set([system.key]), uses: NO_KEYS, systemCounts: NO_COUNTS, counts };
}

function relatedTo(model: MacroViewModel, key: string | null, foundation: FoundationFocus | null = null, file: string | null = null): Related {
  const none: Related = { keys: NO_KEYS, systems: NO_KEYS, uses: NO_KEYS, systemCounts: NO_COUNTS, counts: NO_COUNTS };
  if (!key) return none;
  const feature = [...model.features.values()].find((candidate) => candidate.key === key);
  if (feature) return relatedToFeatures(model, new Set([feature.id]), partnersOfFeature(model, feature.id), file && model.filesOf.get(feature.id)?.includes(file) ? file : null);
  const area = model.areas.find((candidate) => candidate.key === key);
  if (area) {
    const own = new Set(area.features.map((item) => item.id));
    const partnerAreas = model.areaLinks.flatMap((link) => (link.from === area.id ? [link.to] : link.to === area.id ? [link.from] : []));
    const partners = partnerAreas.flatMap((id) => model.areaById.get(id)?.features.map((item) => item.id) ?? []);
    const base = relatedToFeatures(model, own, []);
    return { ...base, keys: new Set([...base.keys, ...usersOf(model, partners)]) };
  }
  const entry = model.foundation.find((candidate) => candidate.key === key);
  if (entry || key === FOUNDATION_KEY) {
    const users = new Set(model.foundation.filter((item) => item.key === key || key === FOUNDATION_KEY).flatMap((item) => [...(model.foundationUsers.get(item.id) ?? [])]));
    const picked = model.foundation.filter((item) => item.key === key || key === FOUNDATION_KEY);
    const own = new Set(picked.map((item) => item.key));
    const keys = new Set([...usersOf(model, users), ...own, ...(foundation ? foundationPartnerKeys(model, foundation) : [])]);
    const uses = new Set((foundation ? foundationUsesKeys(model, foundation) : []).filter((candidate) => !keys.has(candidate)));
    return withSystems(keys, sumUses(model, picked.map((item) => item.id)), uses);
  }
  const system = model.systems.find((candidate) => candidate.key === key);
  if (system) return relatedToSystem(model, system);
  return none;
}

function nearestInDirection(items: readonly Placed[], from: string | null, direction: Direction): string | null {
  if (!items.length) return null;
  const current = items.find((item) => item.key === from);
  if (!current) return items[0].key;
  const origin = centerOf(current.rect);
  const best = items
    .filter((item) => item.key !== from)
    .map((item) => {
      const delta = { x: centerOf(item.rect).x - origin.x, y: centerOf(item.rect).y - origin.y };
      const [along, across] = direction === 'left' || direction === 'right' ? [delta.x, delta.y] : [delta.y, delta.x];
      const sign = direction === 'right' || direction === 'down' ? 1 : -1;
      return { key: item.key, along: along * sign, across: Math.abs(across) };
    })
    .filter((item) => item.along > 0)
    .sort((a, b) => a.along + a.across * OFF_AXIS_WEIGHT - (b.along + b.across * OFF_AXIS_WEIGHT) || a.key.localeCompare(b.key))[0];
  return best?.key ?? null;
}

function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function areaUnderView(layout: MacroViewLayout, camera: Camera, viewport: Size, current: string | null, anchor: Point): string | null {
  const view = worldRect(camera, viewport);
  const point = toWorld(camera, anchor);
  const under = layout.areas.find((area) => contains(area.rect, point));
  const shares = layout.areas.map((area) => ({ area, share: overlap(view, area.rect) })).filter((entry) => entry.share > 0);
  const best = shares.reduce<(typeof shares)[number] | null>((top, entry) => (!top || entry.share > top.share ? entry : top), null);
  const chosen = under ?? best?.area;
  if (!chosen) return null;
  const weight = featuresWeight(chosen.rect.w * camera.k);
  return weight >= (chosen.id === current ? STAY_WEIGHT : ENTER_WEIGHT) ? chosen.id : null;
}

export { areaUnderView, nearestInDirection, relatedTo };
export type { Direction, Placed, Related };
