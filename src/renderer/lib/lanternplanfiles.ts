import type { LanternMap, LanternNode } from '@main/lantern';

const ROOT_DIR = '.';
const FALLBACK_ROLE = 'other';

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ROOT_DIR);

function neighbourOf(nodes: readonly LanternNode[], dir: string): LanternNode | undefined {
  for (let at = dir; ; at = dirOf(at)) {
    const found = nodes.find((node) => node.dir === at);
    if (found || at === ROOT_DIR) return found;
  }
}

function proposedNode(base: LanternMap, path: string, purpose: string): LanternNode {
  const dir = dirOf(path);
  const neighbour = neighbourOf(base.nodes, dir);
  return {
    path,
    dir,
    marker: '.',
    owner: null,
    role: neighbour?.role ?? FALLBACK_ROLE,
    hash: '',
    purpose,
    freshness: 'fresh',
    feature: null,
    seeAlso: [],
    seeAlsoNote: '',
    gotcha: null,
    platform: neighbour?.platform ?? null,
    planNew: true,
  };
}

function withPlanFiles(base: LanternMap, fresh: ReadonlyMap<string, string>): LanternMap {
  const mapped = new Set(base.nodes.map((node) => node.path));
  const added = [...fresh].filter(([path]) => !mapped.has(path)).map(([path, purpose]) => proposedNode(base, path, purpose));
  return added.length ? { ...base, nodes: [...base.nodes, ...added] } : base;
}

export { withPlanFiles };
