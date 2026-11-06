// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternPrOverlay } from '../src/main/lantern';
import { mapOf, node, pr } from './helpers/lantern-map';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { withOverlay } from '../src/renderer/lib/lanternoverlay';

const NODES = [node('src/app.ts', 'service', { hash: 'old' }), node('src/repo.ts', 'repository'), node('src/page.tsx', 'page')];
const RELATIONS = [{ from: 'src/app.ts', arrow: '>' as const, to: 'src/repo.ts', ext: null, symbol: null, label: 'reads' }];

const OPEN = pr('9', {
  tip: 'tip-9',
  files: [
    { path: 'src/new.ts', kind: 'added', mapped: false },
    { path: 'lib/nomap.ts', kind: 'added', mapped: false },
    { path: 'src/app.ts', kind: 'modified', mapped: true },
  ],
});
const OTHER = pr('10', { tip: 'tip-10', files: [{ path: 'src/other.ts', kind: 'added', mapped: false }] });
const MERGED = pr('5', { state: 'merged', files: [{ path: 'src/new.ts', kind: 'added', mapped: true }] });
const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.replaceChildren();
});

function overlayOf(id: string, tip: string, extra: Partial<LanternPrOverlay> = {}): LanternPrOverlay {
  return {
    prId: id,
    tip,
    nodes: [node('src/new.ts', 'util', { prNew: true, hash: 'new' }), node('src/app.ts', 'service', { hash: 'branch' })],
    relations: [
      { from: 'src/new.ts', arrow: '>', to: 'src/repo.ts', ext: null, symbol: null, label: 'uses repo' },
      { from: 'src/app.ts', arrow: '>', to: 'src/new.ts', ext: null, symbol: null, label: 'uses new' },
    ],
    missing: ['lib/nomap.ts'],
    warnings: [],
    ...extra,
  };
}

function mapWith(prs = [OPEN, OTHER, MERGED]): LanternMap {
  return mapOf({ nodes: NODES, relations: RELATIONS, prs, total: 3 });
}

function mount(map: LanternMap, opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, map, opts);
  mounted.push(view);
  return { root, view };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const chip = (root: HTMLElement, id: string) => root.querySelector(`.pr-chip[data-pr="${id}"]`) as HTMLElement;
const names = (root: HTMLElement) => [...root.querySelectorAll('.lt-pixi-node-access')].map((n) => n.textContent).sort();
const nodeEl = (root: HTMLElement, name: string) => [...root.querySelectorAll('.lt-pixi-node-access')].find((g) => g.textContent === name) as SVGGElement;
const relatedPaths = (root: HTMLElement) => [...root.querySelectorAll('.lt-pixi-node-access')].filter((node) => node.getAttribute('aria-description')?.match(/selected|related/)).map((node) => node.getAttribute('aria-label')).sort();
const rowOf = (root: HTMLElement, path: string) => [...root.querySelectorAll('.pr-file')].find((li) => li.getAttribute('data-tip') === path || li.querySelector(`[data-pr-go="${path}"]`)) as HTMLElement;

function overlayReader(by: Record<string, LanternPrOverlay> = { '9': overlayOf('9', 'tip-9'), '10': overlayOf('10', 'tip-10', { nodes: [node('src/other.ts', 'util', { prNew: true })], relations: [], missing: [] }) }) {
  return vi.fn(async (id: string) => by[id]);
}

describe('withOverlay', () => {
  it('adds new nodes, replaces a modified node and its relations, and leaves the base untouched', () => {
    const base = mapWith([OPEN]);
    const merged = withOverlay(base, overlayOf('9', 'tip-9'));
    expect(merged.nodes.map((n) => n.path)).toEqual(['src/app.ts', 'src/repo.ts', 'src/page.tsx', 'src/new.ts']);
    expect(merged.nodes[0].hash).toBe('branch');
    expect(merged.relations.map((r) => `${r.from}>${r.to}`).sort()).toEqual(['src/app.ts>src/new.ts', 'src/new.ts>src/repo.ts']);
    expect(base.nodes).toHaveLength(3);
    expect(base.relations).toHaveLength(1);
    expect(base.nodes[0].hash).toBe('old');
  });

  it('keeps the working-tree node when it already holds the file, and the base when nothing is overlaid', () => {
    const base = mapWith([OPEN]);
    const held = overlayOf('9', 'tip-9', { nodes: [node('src/repo.ts', 'repository', { prNew: true })] });
    expect(withOverlay(base, held)).toBe(base);
    expect(withOverlay(base, null)).toBe(base);
    expect(withOverlay(base, overlayOf('9', 'tip-9', { nodes: [] }))).toBe(base);
  });

  it('counts a new node under its platform tab', () => {
    const base = mapOf({ nodes: NODES, platforms: [{ id: 'web', kind: 'web', label: 'Web', count: 2 }, { id: 'api', kind: 'backend', label: 'API', count: 1 }] });
    const merged = withOverlay(base, overlayOf('9', 'tip-9', { nodes: [node('src/new.ts', 'util', { prNew: true, platform: 'api' })] }));
    expect(merged.platforms.map((p) => p.count)).toEqual([2, 2]);
    expect(base.platforms[1].count).toBe(1);
  });
});

describe('pull request mode with the branch overlay', () => {
  it('shows an added file as a node marked new only while the pull request is open in the view', async () => {
    const read = overlayReader();
    const { root } = mount(mapWith(), { readPrOverlay: read });
    expect(names(root)).toEqual(['app.ts', 'page.tsx', 'repo.ts']);
    chip(root, '9').click();
    expect(read).toHaveBeenCalledWith('9', 'en');
    await settle();
    expect(names(root)).toEqual(['app.ts', 'new.ts', 'page.tsx', 'repo.ts']);
    const fresh = nodeEl(root, 'new.ts');
    expect(fresh.classList.contains('pr-hit')).toBe(true);
    expect(fresh.classList.contains('pr-new')).toBe(true);
    expect(fresh.getAttribute('data-tip')).toContain('new in pull request');
    chip(root, '9').click();
    expect(names(root)).toEqual(['app.ts', 'page.tsx', 'repo.ts']);
    expect(root.querySelector('.pr-new')).toBeNull();
  });

  it('draws the relations of a new node when it is clicked, to existing and to other new files', async () => {
    const { root } = mount(mapWith(), { readPrOverlay: overlayReader() });
    chip(root, '9').click();
    await settle();
    nodeEl(root, 'new.ts').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(relatedPaths(root)).toEqual(['src/app.ts', 'src/new.ts', 'src/repo.ts']);
  });

  it('shows the branch relations of a modified file, and the working-tree ones again after leaving', async () => {
    const { root } = mount(mapWith(), { readPrOverlay: overlayReader() });
    chip(root, '9').click();
    await settle();
    nodeEl(root, 'app.ts').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(relatedPaths(root)).toEqual(['src/app.ts', 'src/new.ts']);
    chip(root, '9').click();
    expect(relatedPaths(root)).toEqual(['src/app.ts', 'src/repo.ts']);
  });

  it('drops a selected new node when the pull request mode is left', async () => {
    const { root } = mount(mapWith(), { readPrOverlay: overlayReader() });
    chip(root, '9').click();
    await settle();
    nodeEl(root, 'new.ts').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelector('.lt-pixi-node-access[aria-pressed="true"]')).not.toBeNull();
    (root.querySelector('[data-pr-back]') as HTMLElement).click();
    expect(root.querySelector('.lt-pixi-node-access[aria-pressed="true"]')).toBeNull();
    expect(names(root)).toEqual(['app.ts', 'page.tsx', 'repo.ts']);
  });

  it('turns the panel row of an added file into a jump with the branch code and diff actions, and keeps "not in map" for the rest', async () => {
    const { root } = mount(mapWith(), { readPrOverlay: overlayReader(), readFile: vi.fn(), readPrFile: vi.fn(), readPrDiff: vi.fn() });
    chip(root, '9').click();
    expect(rowOf(root, 'src/new.ts').classList.contains('off')).toBe(true);
    await settle();
    const row = rowOf(root, 'src/new.ts');
    expect(row.classList.contains('off')).toBe(false);
    expect(row.querySelector('[data-pr-go="src/new.ts"]')).not.toBeNull();
    expect(row.querySelector('[data-pr-code="src/new.ts"]')?.textContent).toBe('</>');
    expect(row.querySelector('[data-code]')).toBeNull();
    expect(row.querySelector('[data-pr-diff="src/new.ts"]')).not.toBeNull();
    expect(row.querySelector('.pr-tag')?.textContent).toBe('new');
    const missing = rowOf(root, 'lib/nomap.ts');
    expect(missing.classList.contains('off')).toBe(true);
    expect(missing.querySelector('.pr-tag')?.textContent).toBe('not in map');
  });

  it('selects the new node from its panel row', async () => {
    const { root } = mount(mapWith(), { readPrOverlay: overlayReader() });
    chip(root, '9').click();
    await settle();
    (root.querySelector('[data-pr-go="src/new.ts"]') as HTMLElement).click();
    expect(nodeEl(root, 'new.ts').getAttribute('aria-pressed')).toBe('true');
  });

  it('swaps the overlay when another pull request is selected', async () => {
    const { root } = mount(mapWith(), { readPrOverlay: overlayReader() });
    chip(root, '9').click();
    await settle();
    expect(names(root)).toContain('new.ts');
    chip(root, '10').click();
    await settle();
    expect(names(root)).toEqual(['app.ts', 'other.ts', 'page.tsx', 'repo.ts']);
    expect(relatedPaths(root)).toEqual([]);
    nodeEl(root, 'app.ts').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(relatedPaths(root)).toEqual(['src/app.ts', 'src/repo.ts']);
  });

  it('reads each pull request once per branch tip, and again when the tip moves', async () => {
    const read = overlayReader();
    const { root, view } = mount(mapWith(), { readPrOverlay: read });
    chip(root, '9').click();
    await settle();
    chip(root, '9').click();
    chip(root, '9').click();
    await settle();
    view.update(mapWith());
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(names(root)).toContain('new.ts');
    view.update(mapWith([{ ...OPEN, tip: 'tip-9b' }, OTHER, MERGED]));
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not ask for an overlay for a merged pull request, or without a branch tip', async () => {
    const read = overlayReader();
    const { root } = mount(mapWith([{ ...OPEN, tip: undefined }, MERGED]), { readPrOverlay: read });
    chip(root, '5').click();
    chip(root, '9').click();
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(names(root)).toEqual(['app.ts', 'page.tsx', 'repo.ts']);
  });

  it('loads the overlay when the view starts in a remembered pull request mode', async () => {
    const { root } = mount(mapWith(), { readPrOverlay: overlayReader(), pr: '9' });
    await settle();
    expect(names(root)).toContain('new.ts');
  });

  it('survives a failed read and a stale answer for a pull request that was left', async () => {
    let release: (o: LanternPrOverlay) => void = () => undefined;
    const slow = vi.fn(() => new Promise<LanternPrOverlay>((resolve) => (release = resolve)));
    const { root } = mount(mapWith(), { readPrOverlay: slow });
    chip(root, '9').click();
    chip(root, '9').click();
    release(overlayOf('9', 'tip-9'));
    await settle();
    expect(names(root)).toEqual(['app.ts', 'page.tsx', 'repo.ts']);
    const broken = mount(mapWith(), { readPrOverlay: vi.fn(async () => Promise.reject(new Error('git failed'))) });
    chip(broken.root, '9').click();
    await settle();
    expect(names(broken.root)).toEqual(['app.ts', 'page.tsx', 'repo.ts']);
    expect(rowOf(broken.root, 'src/new.ts').classList.contains('off')).toBe(true);
  });

  it('retries a failed read the next time the pull request is selected', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValue(overlayOf('9', 'tip-9'));
    const { root } = mount(mapWith(), { readPrOverlay: read });
    chip(root, '9').click();
    await settle();
    expect(names(root)).not.toContain('new.ts');
    chip(root, '9').click();
    chip(root, '9').click();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(names(root)).toContain('new.ts');
  });

  it('lists a modified file that only the branch maps as live, not as "not in map"', async () => {
    const only = overlayOf('9', 'tip-9', { nodes: [node('src/branchonly.ts', 'util', { hash: 'b' })], relations: [], missing: [] });
    const open = pr('9', { tip: 'tip-9', files: [{ path: 'src/branchonly.ts', kind: 'modified', mapped: false }] });
    const { root } = mount(mapWith([open]), { readPrOverlay: overlayReader({ '9': only }) });
    chip(root, '9').click();
    expect(rowOf(root, 'src/branchonly.ts').classList.contains('off')).toBe(true);
    await settle();
    expect(rowOf(root, 'src/branchonly.ts').classList.contains('off')).toBe(false);
    expect(root.querySelector('.pr-new')).toBeNull();
  });

  it('keeps the filters, counts and coverage of the normal graph untouched', async () => {
    const { root } = mount(mapWith(), { readPrOverlay: overlayReader() });
    chip(root, '9').click();
    await settle();
    chip(root, '9').click();
    expect(root.querySelector('.stats')?.textContent).toContain('of 3 files');
    expect(root.querySelector('[data-role="util"]')).toBeNull();
    expect(root.querySelector('.coverage')?.textContent).toContain('3 of 3 source files mapped');
  });
});
