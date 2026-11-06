import { profileFor } from './lanternprofile';
import type { Profile } from './lanternprofile';
import type { LanternMap, LanternNode, LanternPlatform, LanternRelation } from '../../main/lantern';

function isTabbed(data: LanternMap) {
  return data.platforms.length >= 2;
}

function platformById(data: LanternMap, id: string): LanternPlatform | undefined {
  return isTabbed(data) ? data.platforms.find((p) => p.id === id) : undefined;
}

function effectivePlatform(data: LanternMap, id: string) {
  return platformById(data, id) ? id : '';
}

function profileOf(data: LanternMap, platform: string): Profile {
  return profileFor(platformById(data, platform)?.kind ?? '', isTabbed(data));
}

function inPlatform(n: LanternNode, platform: string) {
  return !platform || n.platform === platform;
}

interface Scope {
  nodes: LanternNode[];
  relations: LanternRelation[];
}

function scopeOf(data: LanternMap, platform: string): Scope {
  if (!platform) return { nodes: data.nodes, relations: data.relations };
  const byPath = new Map(data.nodes.map((n) => [n.path, n]));
  const inside = (path: string | null) => {
    const n = path ? byPath.get(path) : undefined;
    return !!n && inPlatform(n, platform);
  };
  return {
    nodes: data.nodes.filter((n) => inPlatform(n, platform)),
    relations: data.relations.filter((r) => inside(r.from) || inside(r.to)),
  };
}

function platformLabel(data: LanternMap, id: string | null) {
  return data.platforms.find((p) => p.id === id)?.label ?? '';
}

export { effectivePlatform, inPlatform, isTabbed, platformById, platformLabel, profileOf, scopeOf };
export type { Scope };
