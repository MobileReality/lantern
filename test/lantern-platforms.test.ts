// @vitest-environment jsdom
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { load } from '../src/main/lantern';
import type { LanternMap } from '../src/main/lantern';
import { emptyFilters, layoutGraph } from '../src/renderer/lib/lanternlayout';
import { profileFor } from '../src/renderer/lib/lanternprofile';
import { scopeOf } from '../src/renderer/lib/lanternscope';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node } from './helpers/lantern-map';

let demo: LanternMap;
const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  mounted.splice(0).forEach((view) => { view.dispose(); });
  document.body.replaceChildren();
});

beforeAll(async () => {
  vi.stubEnv('LANTERN_LANG', '');
  demo = await load(path.join(__dirname, 'fixtures', 'lantern-demo-platforms'));
});

function mount(data: LanternMap, opts = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, data, opts);
  mounted.push(view);
  return { root, view };
}

function graphNodes(root: HTMLElement) {
  return [...root.querySelectorAll('.lt-pixi-node-access')]
    .filter((button) => !button.getAttribute('aria-description')?.match(/boundary|directory group|^external/))
    .map((button) => button.getAttribute('aria-label'));
}

describe('layer profile per kind', () => {
  it('names the backend layers and drops Presentation into Support', () => {
    const p = profileFor('backend', true);
    expect(p.layers.map((l) => l.name)).toEqual(['Skills', 'Endpoints', 'Business logic', 'AI', 'Data & services', 'Infrastructure', 'Support', 'Outside']);
    expect(p.layerOf('page').id).toBe('support');
    expect(p.layerOf('handler').name).toBe('Endpoints');
  });

  it('gives skill files their own column in every kind, never folded into Support', () => {
    for (const kind of ['web', 'backend', 'mobile', 'desktop', 'infra', 'other', 'shared'] as const) expect(profileFor(kind, true).layerOf('skill')).toMatchObject({ id: 'skills', name: 'Skills' });
    expect(profileFor('', false).layerOf('skill').id).toBe('skills');
    expect(profileFor('', false).layerOf('role-nobody-heard-of').id).toBe('support');
  });

  it('renames mobile and desktop columns', () => {
    const mobile = profileFor('mobile', true);
    expect([mobile.layerOf('entry').name, mobile.layerOf('page').name]).toEqual(['App shell', 'Screens']);
    const desktop = profileFor('desktop', true);
    expect([desktop.layerOf('entry').name, desktop.layerOf('component').name]).toEqual(['Main process', 'Renderer']);
  });

  it('gives infra its own column and folds Presentation and AI into Tooling', () => {
    const p = profileFor('infra', true);
    expect(p.layerOf('infra').name).toBe('Infra & pipelines');
    expect(p.layerOf('component').name).toBe('Tooling');
    expect(p.layerOf('ai').name).toBe('Tooling');
  });

  it('keeps the default layers for web, other, shared and no platform', () => {
    for (const kind of ['web', 'other', 'shared'] as const) expect(profileFor(kind, true).layerOf('page').name).toBe('Presentation');
    const plain = profileFor('', false);
    expect(plain.layerOf('page').name).toBe('Presentation');
    expect(plain.layerOf('infra').id).toBe('support');
    expect(plain.layers.some((l) => l.id === 'infra')).toBe(false);
  });
});

describe('platform scoping (demo-platforms)', () => {
  it('lists every mapped file on All', () => {
    expect(layoutGraph(demo, emptyFilters()).count).toBe(demo.nodes.length);
  });

  it('scopes files, counts and edges to one platform', () => {
    const L = layoutGraph(demo, { ...emptyFilters(), platform: 'backend' });
    expect(L.count).toBe(4);
    expect(L.cols.map((c) => c.layer.name)).toEqual(['Endpoints', 'Business logic', 'Data & services', 'Outside']);
    expect(scopeOf(demo, 'backend').nodes).toHaveLength(4);
    expect(scopeOf(demo, 'backend').relations.every((r) => r.from.startsWith('api/') || r.to?.startsWith('api/'))).toBe(true);
  });

  it('applies role, directory and search filters inside the tab', () => {
    const backend = { ...emptyFilters(), platform: 'backend' };
    expect(layoutGraph(demo, { ...backend, roles: ['service'] }).count).toBe(1);
    expect(layoutGraph(demo, { ...backend, roles: ['page'] }).count).toBe(0);
    expect(layoutGraph(demo, { ...backend, dirs: ['api/src/handlers'] }).count).toBe(1);
    expect(layoutGraph(demo, { ...backend, q: 'zzzz' }).count).toBe(0);
  });

  it('filters by feature, treating no feature as "-"', () => {
    const data = mapOf({
      features: [{ id: 'billing', description: 'Invoices' }],
      nodes: [node('a.ts', 'service', { feature: 'billing' }), node('b.ts', 'service')],
    });
    expect(layoutGraph(data, { ...emptyFilters(), features: ['billing'] }).count).toBe(1);
    expect(layoutGraph(data, { ...emptyFilters(), features: ['-'] }).count).toBe(1);
  });
});

describe('boundary nodes', () => {
  it('draws inbound relations from other platforms as dashed nodes grouped under that platform', () => {
    const L = layoutGraph(demo, { ...emptyFilters(), platform: 'backend' });
    const boundary = [...L.pos.values()].filter((p) => p.item.boundary);
    expect(boundary.map((p) => p.item.boundary?.path).sort()).toEqual(['desktop/src/main/main.ts', 'mobile/src/sync/syncQueue.ts', 'web/src/api/client.ts']);
    const groups = new Set(boundary.map((p) => p.item.dir));
    expect(groups).toEqual(new Set(['↗ Export tool', '↗ Phone app', '↗ Dashboard site']));
    const inbound = L.edges.filter((e) => e.fromKey.startsWith('p:'));
    expect(inbound).toHaveLength(3);
    expect(L.pos.has(inbound[0].fromKey) && L.pos.has(inbound[0].toKey)).toBe(true);
  });

  it('draws outbound relations to the other platform and none on All', () => {
    const L = layoutGraph(demo, { ...emptyFilters(), platform: 'web' });
    expect(L.edges.some((e) => e.toKey === 'p:api/src/routes.ts')).toBe(true);
    expect([...layoutGraph(demo, emptyFilters()).pos.values()].some((p) => p.item.boundary)).toBe(false);
  });

  it('respects the relation-kind filter for boundary edges', () => {
    const L = layoutGraph(demo, { ...emptyFilters(), platform: 'backend', kinds: ['>'] });
    expect([...L.pos.values()].filter((p) => p.item.boundary).map((p) => p.item.boundary?.path)).toEqual(['mobile/src/sync/syncQueue.ts']);
  });

  it('clicking a boundary node switches to its platform and selects the file', () => {
    const seen: string[] = [];
    const { root } = mount(demo, { platform: 'backend', onPlatform: (id: string) => seen.push(id) });
    const bnd = [...root.querySelectorAll('.lt-pixi-node-access')].find((n) => n.getAttribute('aria-label') === 'client.ts') as HTMLButtonElement;
    bnd.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(seen).toEqual(['web']);
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('web');
    expect(root.querySelector('.lt-detail .path .file-label')?.getAttribute('data-tip')).toBe('web/src/api/client.ts');
  });
});

describe('tab strip', () => {
  it('renders All, one tab per platform with counts, and Shared last', () => {
    const { root } = mount(demo);
    const tabs = [...root.querySelectorAll('.lt-plat')].map((t) => t.textContent);
    expect(tabs).toEqual(['All 16', 'Dashboard site 3', 'Readings API 4', 'Phone app 2', 'Export tool 2', 'AWS and CI 2', 'Smartwatch 2', 'Shared 1']);
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('');
  });

  it('selecting a tab scopes the graph, stats and role chips and reports the choice', () => {
    const seen: string[] = [];
    const { root } = mount(demo, { onPlatform: (id: string) => seen.push(id) });
    (root.querySelector('.lt-plat[data-plat="backend"]') as HTMLElement).click();
    expect(seen).toEqual(['backend']);
    expect(graphNodes(root).sort()).toEqual(['api/src/handlers/readings.ts', 'api/src/repositories/readingRepository.ts', 'api/src/routes.ts', 'api/src/services/readingService.ts']);
    expect(root.querySelector('.stats b')?.textContent).toBe('4');
    expect(root.querySelector('.stats span')?.textContent).toBe('of 4 files');
    expect([...root.querySelectorAll('[data-role]')].map((c) => c.getAttribute('data-role')).sort()).toEqual(['handler', 'repository', 'route', 'service']);
    expect(root.querySelector('[aria-label="api/src/routes.ts"]')?.getAttribute('aria-description')).toContain('Endpoints');
  });

  it('starts on the remembered platform', () => {
    const { root } = mount(demo, { platform: 'mobile' });
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('mobile');
    expect(root.querySelector('[aria-label="mobile/src/screens/TodayScreen.tsx"]')?.getAttribute('aria-description')).toContain('Screens');
  });

  it('falls back to All when the remembered platform is gone', () => {
    const { root } = mount(demo, { platform: 'nope' });
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('');
    expect(graphNodes(root)).toHaveLength(demo.nodes.length);
  });

  it('renders no tabs when the map has fewer than two platforms', () => {
    const one = mapOf({
      platforms: [{ id: 'web', kind: 'web', label: 'Web', count: 1 }],
      nodes: [node('a.ts', 'service', { platform: 'web' })],
    });
    for (const data of [mapOf({ nodes: [node('a.ts', 'service')] }), one]) {
      const { root } = mount(data, { platform: 'web' });
      expect(root.querySelector('.lt-plat')).toBeNull();
      expect(root.querySelector('[role="tablist"]')).toBeNull();
      expect(root.querySelector('.lt-tabs')?.innerHTML).toBe('');
      expect(graphNodes(root)).toEqual(['a.ts']);
      expect(root.textContent).not.toContain('Platform');
    }
  });

  it('moves between tabs with the arrow keys', () => {
    const { root } = mount(demo);
    root.querySelector('.lt-tabs')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('web');
    root.querySelector('.lt-tabs')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('');
  });
});
