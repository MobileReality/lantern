import type { LanternMap, LanternNode, LanternPr } from '../../src/main/lantern';

function node(path: string, role: string, extra: Partial<LanternNode> = {}): LanternNode {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
  return {
    path,
    dir,
    marker: '.',
    owner: null,
    role,
    hash: 'abc',
    purpose: `${path} purpose`,
    freshness: 'fresh',
    feature: null,
    seeAlso: [],
    seeAlsoNote: '',
    gotcha: null,
    platform: null,
    ...extra,
  };
}

function mapOf(extra: Partial<LanternMap> = {}): LanternMap {
  return {
    exists: true,
    project: 'demo',
    nodes: [],
    relations: [],
    errors: [],
    unmapped: [],
    unmappedCount: 0,
    total: 0,
    features: [],
    platforms: [],
    sections: [],
    warnings: [],
    language: { primary: 'en', code: 'en', available: [], fallbackCount: 0, fallbackKeys: [] },
    prs: [],
    plans: [],
    brokenPlans: [],
    ...extra,
  };
}

function pr(id: string, extra: Partial<LanternPr> = {}): LanternPr {
  return {
    id,
    title: `PR ${id} title`,
    url: `https://example.com/pull-requests/${id}`,
    branch: `feat/pr-${id}`,
    base: 'main',
    opened: new Date().toISOString().slice(0, 10),
    head: 'a'.repeat(40),
    files: [],
    state: 'open',
    source: 'tree',
    ...extra,
  };
}

export { mapOf, node, pr };
