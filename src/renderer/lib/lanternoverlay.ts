import type { LanternMap, LanternNode, LanternPlatform, LanternPr, LanternPrOverlay } from '../../main/lantern';

const SHARED = 'shared';

function overlayKey(pr: LanternPr | undefined, lang: string) {
  return pr && pr.state === 'open' && pr.tip ? `${pr.id}\0${pr.tip}\0${lang}` : null;
}

function platformsWith(base: LanternMap, counts: Map<string, number>): LanternPlatform[] {
  if (base.platforms.length < 2) return base.platforms;
  const grown = base.platforms.map((p) => (counts.has(p.id) ? { ...p, count: p.count + (counts.get(p.id) as number) } : p));
  const shared = counts.get(SHARED);
  return shared && !base.platforms.some((p) => p.id === SHARED) ? [...grown, { id: SHARED, kind: SHARED, label: 'Shared', count: shared }] : grown;
}

function withOverlay(base: LanternMap, overlay: LanternPrOverlay | null): LanternMap {
  if (!overlay || !overlay.nodes.length) return base;
  const existing = new Map(base.nodes.map((n) => [n.path, n]));
  const replaced = new Map<string, LanternNode>();
  const added: LanternNode[] = [];
  for (const n of overlay.nodes) {
    const current = existing.get(n.path);
    if (!current) added.push(n);
    else if (!n.prNew && current.hash !== n.hash) replaced.set(n.path, n);
  }
  if (!added.length && !replaced.size) return base;
  const owned = new Set([...replaced.keys(), ...added.map((n) => n.path)]);
  const counts = new Map<string, number>();
  for (const n of added) if (n.platform) counts.set(n.platform, (counts.get(n.platform) ?? 0) + 1);
  return {
    ...base,
    nodes: [...base.nodes.map((n) => replaced.get(n.path) ?? n), ...added],
    relations: [...base.relations.filter((r) => !replaced.has(r.from)), ...overlay.relations.filter((r) => owned.has(r.from))],
    platforms: platformsWith(base, counts),
  };
}

export { overlayKey, withOverlay };
