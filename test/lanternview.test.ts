// @vitest-environment jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../src/main/lantern';
import type { LanternMap } from '../src/main/lantern';
import { mapOf, node } from './helpers/lantern-map';
import { emptyFilters, layoutGraph } from '../src/renderer/lib/lanternlayout';
import { mountLanternView } from '../src/renderer/lib/lanternview';

const MAP: LanternMap = mapOf({
  errors: [],
  unmapped: ['src/new.ts', 'src/other.ts'],
  unmappedCount: 2,
  total: 6,
  nodes: [
    node('src/page.tsx', 'page'),
    node('src/svc.ts', 'service'),
    node('src/repo.ts', 'repository', { marker: '~', owner: 'dev' }),
    node('package.json', 'config'),
  ],
  relations: [
    { from: 'src/page.tsx', arrow: '=', to: 'src/svc.ts', ext: null, symbol: 'load', label: 'data' },
    { from: 'src/svc.ts', arrow: '>', to: 'src/repo.ts', ext: null, symbol: null, label: '' },
    { from: 'src/repo.ts', arrow: '=', to: null, ext: 'firestore', symbol: null, label: '' },
    { from: 'src/repo.ts', arrow: '<', to: 'src/missing.ts', ext: null, symbol: null, label: '' },
  ],
});

describe('layoutGraph', () => {
  it('places each role in its layer column and adds outside systems', () => {
    const L = layoutGraph(MAP, emptyFilters());
    expect(L.cols.map((c) => c.layer.id)).toEqual(['presentation', 'domain', 'data', 'support', 'system']);
    expect(L.count).toBe(4);
    expect(L.edges).toHaveLength(4);
    expect(L.pos.has('ext:firestore')).toBe(true);
    expect(L.pos.has('?src/missing.ts')).toBe(true);
  });

  it('filters by role, directory, relation kind and missing files', () => {
    expect(layoutGraph(MAP, { ...emptyFilters(), roles: ['service'] }).count).toBe(1);
    expect(layoutGraph(MAP, { ...emptyFilters(), dirs: ['.'] }).count).toBe(1);
    expect(layoutGraph(MAP, { ...emptyFilters(), dirs: ['src'] }).count).toBe(3);
    const withGone: LanternMap = { ...MAP, nodes: [...MAP.nodes, node('src/old.ts', 'util', { freshness: 'gone' })] };
    expect(layoutGraph(withGone, { ...emptyFilters(), missing: true }).count).toBe(1);
    expect(layoutGraph(MAP, { ...emptyFilters(), wip: true }).count).toBe(1);
    expect(layoutGraph(MAP, { ...emptyFilters(), kinds: ['>'] }).edges).toHaveLength(1);
  });
});

const graphNodes = (root: HTMLElement) => [...root.querySelectorAll('.lt-pixi-node-access')].filter((button) => !button.getAttribute('aria-description')?.match(/boundary|directory group|^external/)) as HTMLButtonElement[];
const mountedViews: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.dispose();
  document.body.replaceChildren();
});

describe('mountLanternView', () => {
  it('draws a node per file and marks in-progress ones', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountedViews.push(mountLanternView(root, MAP));
    expect(graphNodes(root)).toHaveLength(4);
    expect(graphNodes(root).some((button) => button.textContent?.endsWith('svc.ts'))).toBe(true);
  });

  it('clips a long project title to one line instead of wrapping it', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const project = 'a-very-long-project-name-that-does-not-fit';
    mountedViews.push(mountLanternView(root, { ...MAP, project }));
    const title = root.querySelector('.lt-side h1') as HTMLElement;
    expect(title.classList.contains('lt-proj')).toBe(true);
    expect(title.parentElement!.classList.contains('brand')).toBe(false);
    expect(title.getAttribute('data-tip')).toBe(project);
  });

  it('selecting a node shows its details and role filter narrows the graph', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountedViews.push(mountLanternView(root, MAP));
    (root.querySelector('.lt-pixi-node-access') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelector('.lt-detail')).not.toBeNull();
    (root.querySelector('button[data-role="config"]') as HTMLElement).click();
    expect(graphNodes(root)).toHaveLength(1);
  });

  it('chip count and missing filter agree when a file is gone', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const map: LanternMap = { ...MAP, nodes: [...MAP.nodes, node('src/old.ts', 'util', { freshness: 'gone' })] };
    mountedViews.push(mountLanternView(root, map));
    expect(root.querySelector('[data-missing] em')?.textContent).toBe('1');
    expect(root.querySelectorAll('.lt-pixi-node-access.gone')).toHaveLength(1);
    expect(root.querySelector('.lt-pixi-node-access.gone')?.textContent).toContain('old.ts');
    (root.querySelector('[data-missing]') as HTMLElement).click();
    expect(graphNodes(root)).toHaveLength(1);
  });

  it('shows no stale marking anywhere for a map whose files were edited after mapping', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-lantern-edited-'));
    fs.mkdirSync(path.join(dir, '.lantern', 'map'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'edited after mapping\n');
    fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'edited too\n');
    fs.writeFileSync(path.join(dir, 'src', 'new.ts'), 'not mapped\n');
    fs.writeFileSync(path.join(dir, '.lantern', 'map', '.lantern'), ['lantern 1', '# .', 'src/a.ts . util 000000000000 | a', 'src/b.ts . service 000000000000 | b', 'src/gone.ts . util 000000000000 | g'].join('\n') + '\n');
    const map = await load(dir);
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountedViews.push(mountLanternView(root, map));
    (root.querySelector('.lt-pixi-node-access') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelector('[class*="stale"], [data-stale], .stl')).toBeNull();
    expect(root.innerHTML).not.toMatch(/stale/i);
    expect(root.querySelectorAll('.lt-pixi-node-access.gone')).toHaveLength(1);
    expect(root.querySelector('[data-missing] em')?.textContent).toBe('1');
    expect(root.querySelector('[data-unmapped] em')?.textContent).toBe('1');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('shows "and N more" from the count when the list is capped', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountedViews.push(mountLanternView(root, { ...MAP, unmapped: ['src/new.ts'], unmappedCount: 4 }));
    (root.querySelector('[data-unmapped]') as HTMLElement).click();
    expect(root.querySelector('.unmapped-list + .none')?.textContent).toBe('and 3 more');
  });

  it('shows unmapped count, coverage and lists unmapped paths behind the chip', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountedViews.push(mountLanternView(root, MAP));
    expect(root.querySelector('[data-unmapped] em')?.textContent).toBe('2');
    expect(root.querySelector('.coverage')?.textContent).toBe('4 of 6 source files mapped');
    expect(root.querySelector('.unmapped-list')).toBeNull();
    (root.querySelector('[data-unmapped]') as HTMLElement).click();
    expect([...root.querySelectorAll('.unmapped-list li')].map((l) => l.textContent)).toEqual(['new.ts src/', 'other.ts src/']);
    expect(graphNodes(root)).toHaveLength(4);
  });

  it('gives each mounted view its own element ids', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    mountedViews.push(mountLanternView(a, MAP));
    mountedViews.push(mountLanternView(b, MAP));
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const input = a.querySelector('.search') as HTMLInputElement;
    vi.useFakeTimers();
    input.value = 'svc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    expect(graphNodes(a)).toHaveLength(1);
    expect(graphNodes(b)).toHaveLength(4);
  });
});

describe('clear all filters', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const FEAT: LanternMap = {
    ...MAP,
    features: [{ id: 'auth', description: 'login' }],
    nodes: [
      node('src/page.tsx', 'page', { feature: 'auth', platform: 'web' }),
      node('src/svc.ts', 'service', { platform: 'web' }),
      node('src/repo.ts', 'repository', { marker: '~', owner: 'dev', platform: 'api' }),
      node('package.json', 'config', { platform: 'api' }),
    ],
    platforms: [
      { id: 'web', kind: 'web', label: 'web', count: 2 },
      { id: 'api', kind: 'backend', label: 'api', count: 2 },
    ],
  };
  const mount = (map: LanternMap = MAP) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountedViews.push(mountLanternView(root, map));
    return root;
  };
  const nodes = (root: HTMLElement) => graphNodes(root).length;
  const btn = (root: HTMLElement) => root.querySelector('[data-clear-all]') as HTMLElement | null;
  const search = (root: HTMLElement, v: string) => {
    const input = root.querySelector('.search') as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);
  };

  it('is absent with no filters', () => {
    expect(btn(mount())).toBeNull();
  });

  it('counts active groups and one click empties every filter', () => {
    const root = mount();
    (root.querySelector('button[data-role="service"]') as HTMLElement).click();
    (root.querySelector('button[data-role="page"]') as HTMLElement).click();
    (root.querySelector('button[data-dir="src"]') as HTMLElement).click();
    (root.querySelector('[data-kind=">"]') as HTMLElement).click();
    (root.querySelector('[data-wip]') as HTMLElement).click();
    (root.querySelector('[data-missing]') as HTMLElement).click();
    (root.querySelector('[data-unmapped]') as HTMLElement).click();
    search(root, 'svc');
    expect(btn(root)?.textContent).toBe('Clear all filters · 5');
    expect(btn(root)?.getAttribute('data-tip')).toBeTruthy();
    btn(root)?.click();
    expect(btn(root)).toBeNull();
    expect(root.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    expect((root.querySelector('.search') as HTMLInputElement).value).toBe('');
    expect(root.querySelector('.unmapped-list')).toBeNull();
    expect(nodes(root)).toBe(4);
  });

  it('moves focus to the search box after Clear all filters', () => {
    const root = mount();
    (root.querySelector('button[data-role="service"]') as HTMLElement).click();
    (root.querySelector('[data-kind=">"]') as HTMLElement).click();
    (root.querySelector('[data-wip]') as HTMLElement).click();
    btn(root)?.click();
    expect(btn(root)).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('.search'));
  });

  it('counts the search text alone and clears it', () => {
    const root = mount();
    search(root, 'svc');
    expect(btn(root)?.textContent).toBe('Clear all filters · 1');
    btn(root)?.click();
    expect((root.querySelector('.search') as HTMLInputElement).value).toBe('');
    expect(nodes(root)).toBe(4);
  });

  it('keeps the selected file and the platform tab, and clears the feature filter', () => {
    const root = mount(FEAT);
    (root.querySelector('[data-plat="web"]') as HTMLElement).click();
    (root.querySelector('button[data-feature="auth"]') as HTMLElement).click();
    (root.querySelector('.lt-pixi-node-access') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(nodes(root)).toBe(1);
    btn(root)?.click();
    expect(nodes(root)).toBe(2);
    expect(root.querySelector('[data-plat="web"]')?.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('.lt-detail')).not.toBeNull();
    expect(root.querySelector('.lt-pixi-node-access[aria-pressed="true"]')).not.toBeNull();
  });

  it('leaves each per-section clear working', () => {
    const root = mount();
    (root.querySelector('button[data-role="service"]') as HTMLElement).click();
    (root.querySelector('[data-kind=">"]') as HTMLElement).click();
    expect(nodes(root)).toBe(1);
    (root.querySelector('[data-clear="roles"]') as HTMLElement).click();
    expect(nodes(root)).toBe(4);
    expect(document.activeElement).not.toBe(root.querySelector('.search'));
    expect(btn(root)?.textContent).toBe('Clear all filters · 1');
    (root.querySelector('[data-clear="kinds"]') as HTMLElement).click();
    expect(btn(root)).toBeNull();
  });
});
