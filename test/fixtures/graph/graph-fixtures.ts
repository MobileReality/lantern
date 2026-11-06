import type { LanternMap, LanternNode } from '../../../src/main/lantern';
import { mapOf, node, pr } from '../../helpers/lantern-map';

const relation = (from: string, arrow: '>' | '<' | '=' | '@', to: string | null, ext: string | null = null, symbol: string | null = null) => ({ from, arrow, to, ext, symbol, label: '' });

const overview = mapOf({
  project: 'Graph regression fixture',
  nodes: [
    node('src/pages/dashboard.tsx', 'page', { feature: 'dashboard' }),
    node('src/components/naïve-über-long-component-name.tsx', 'component', { feature: 'dashboard', marker: '~', owner: 'zoë' }),
    node('src/hooks/use-projects.ts', 'hook', { feature: 'dashboard' }),
    node('src/services/project-service.ts', 'service', { feature: 'projects' }),
    node('src/models/project-schema.ts', 'schema', { feature: 'projects' }),
    node('src/data/project-repository.ts', 'repository', { feature: 'projects' }),
    node('src/lib/format-project.ts', 'util', { freshness: 'gone' }),
    node('test/project-service.test.ts', 'test'),
  ],
  relations: [
    relation('src/pages/dashboard.tsx', '>', 'src/components/naïve-über-long-component-name.tsx'),
    relation('src/components/naïve-über-long-component-name.tsx', '>', 'src/hooks/use-projects.ts'),
    relation('src/hooks/use-projects.ts', '>', 'src/services/project-service.ts'),
    relation('src/services/project-service.ts', '<', 'src/models/project-schema.ts'),
    relation('src/services/project-service.ts', '=', 'src/data/project-repository.ts'),
    relation('src/data/project-repository.ts', '@', null, 'PostgreSQL'),
    relation('src/services/project-service.ts', '>', 'src/missing/generated-client.ts'),
  ],
  features: [
    { id: 'dashboard', description: 'Dashboard' },
    { id: 'projects', description: 'Projects' },
  ],
  unmapped: ['src/new-file.ts'],
  unmappedCount: 1,
  total: 9,
  prs: [pr('42', {
    title: 'Update project graph',
    opened: '2026-10-01',
    files: [
      { path: 'src/services/project-service.ts', kind: 'modified', mapped: true },
      { path: 'src/components/naïve-über-long-component-name.tsx', kind: 'added', mapped: true },
      { path: 'src/lib/format-project.ts', kind: 'removed', mapped: true },
    ],
  })],
});

function largeGraph(size = 1200): LanternMap {
  const roles = ['page', 'component', 'service', 'schema', 'repository', 'util'] as const;
  const nodes: LanternNode[] = Array.from({ length: size }, (_, index) => node(
    `src/group-${String(index % 40).padStart(2, '0')}/file-${String(index).padStart(4, '0')}.ts`,
    roles[index % roles.length],
    { feature: `feature-${index % 12}` },
  ));
  return mapOf({
    project: `Deterministic ${size}-node graph`,
    nodes,
    relations: nodes.slice(1).map((current, index) => relation(nodes[index].path, index % 3 === 0 ? '=' : '>', current.path)),
    features: Array.from({ length: 12 }, (_, index) => ({ id: `feature-${index}`, description: `Feature ${index}` })),
    total: size,
  });
}

function denseGraph(size = 2927): LanternMap {
  const areas = [
    ['handler', 'backend/src/routes'],
    ['page', 'web/src/pages'],
    ['component', 'web/src/components'],
    ['service', 'backend/src/modules'],
    ['repository', 'backend/src/repositories'],
    ['test', 'backend/test'],
  ] as const;
  const modules = ['auth', 'billing', 'catalog', 'checkout', 'inventory', 'notifications', 'orders', 'profile', 'reports', 'search', 'settings', 'shipping'];
  const nodes: LanternNode[] = Array.from({ length: size }, (_, index) => {
    const [role, base] = areas[index % areas.length];
    const mod = modules[Math.floor(index / areas.length) % modules.length];
    const sub = Math.floor(index / (areas.length * modules.length)) % 4;
    return node(`${base}/${mod}/part-${String(sub).padStart(2, '0')}/file-${String(index).padStart(4, '0')}-with-a-descriptive-name.ts`, role, { feature: mod });
  });
  return mapOf({
    project: `Deterministic ${size}-file dense graph`,
    nodes,
    relations: nodes.slice(1).map((current, index) => relation(nodes[index].path, '>', current.path)),
    features: modules.map((id) => ({ id, description: id })),
    total: size,
  });
}

const empty = mapOf({ project: 'Empty graph' });

const edgeStyles = mapOf({
  project: 'Edge style parity fixture',
  nodes: [
    node('src/page.tsx', 'page'),
    node('src/widget.tsx', 'component'),
    node('src/use-data.ts', 'hook'),
    node('src/selected-service.ts', 'service'),
    node('src/schema.ts', 'schema'),
  ],
  relations: [
    relation('src/selected-service.ts', '>', 'src/page.tsx', null, 'loadPage'),
    relation('src/widget.tsx', '>', 'src/selected-service.ts'),
    relation('src/selected-service.ts', '=', 'src/use-data.ts'),
    relation('src/selected-service.ts', '@', 'src/schema.ts'),
  ],
  total: 5,
});

const platformWidths = mapOf({
  project: 'Platform width retention fixture',
  platforms: [
    { id: 'wide', kind: 'web', label: 'Wide', count: 1 },
    { id: 'narrow', kind: 'backend', label: 'Narrow', count: 1 },
  ],
  nodes: [
    node('src/wide.ts', 'service', { platform: 'wide' }),
    node('src/narrow.ts', 'service', { platform: 'narrow' }),
  ],
  relations: [
    relation('src/wide.ts', '@', null, 'aws'),
    relation('src/wide.ts', '@', null, 'an-external-service-with-a-long-name'),
    relation('src/narrow.ts', '@', null, 'aws'),
  ],
  total: 2,
});

const relationAreas = mapOf({
  project: 'Relation area interaction fixture',
  nodes: [
    node('src/centre.ts', 'service'),
    ...Array.from({ length: 6 }, (_, index) => node(`src/shared/member-${index}.ts`, 'repository')),
    node('src/other.ts', 'page'),
  ],
  relations: [
    ...Array.from({ length: 6 }, (_, index) => relation('src/centre.ts', '>', `src/shared/member-${index}.ts`)),
    relation('src/other.ts', '>', 'src/centre.ts'),
  ],
  total: 8,
});

const graphFixtures = { overview, empty, edgeStyles, platformWidths, relationAreas, large: largeGraph(), dense: denseGraph() };
type GraphFixtureName = keyof typeof graphFixtures;

export { graphFixtures };
export type { GraphFixtureName };
