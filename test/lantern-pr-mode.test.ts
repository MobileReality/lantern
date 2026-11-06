// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternPr } from '../src/main/lantern';
import { mapOf, node, pr } from './helpers/lantern-map';
import { RBAC } from './helpers/lantern-sections';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';

const NODES = [
  node('src/page.tsx', 'page', { platform: 'web' }),
  node('src/svc.ts', 'service', { platform: 'web' }),
  node('src/repo.ts', 'repository', { platform: 'api' }),
  node('src/util.ts', 'util', { platform: 'api' }),
];
const PLATFORMS = [
  { id: 'web', kind: 'web' as const, label: 'Web', count: 2 },
  { id: 'api', kind: 'backend' as const, label: 'API', count: 2 },
];

const OPEN = pr('7', {
  title: 'Add repo caching',
  summary: 'Caches reads in the repository layer.',
  files: [
    { path: 'src/new.ts', kind: 'added', mapped: false },
    { path: 'src/svc.ts', kind: 'modified', mapped: true },
    { path: 'src/repo.ts', kind: 'modified', mapped: true },
    { path: 'src/util.ts', kind: 'removed', mapped: true },
  ],
});
const MERGED = pr('5', { state: 'merged', files: [{ path: 'src/page.tsx', kind: 'modified', mapped: true }] });
const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.replaceChildren();
});

function mapWith(prs: LanternPr[], extra: Partial<LanternMap> = {}) {
  return mapOf({ nodes: NODES, platforms: PLATFORMS, prs, ...extra });
}

function mount(map: LanternMap, opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, map, opts);
  mounted.push(view);
  return { root, view };
}

const chip = (root: HTMLElement, id: string) => root.querySelector(`.pr-chip[data-pr="${id}"]`) as HTMLElement;
const nodesOf = (root: HTMLElement, cls: string) => [...root.querySelectorAll(`.lt-pixi-node-access${cls}`)].map((button) => button.textContent);

describe('pull request strip', () => {
  it('is absent when the map has no pull requests', () => {
    const { root } = mount(mapWith([]));
    expect(root.querySelector('.lt-prs')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.pr-chip')).toBeNull();
  });

  it('sits above the platform tabs and lists one chip per pull request with its state', () => {
    const { root } = mount(mapWith([OPEN, MERGED]));
    const strip = root.querySelector('.lt-prs') as HTMLElement;
    expect(strip.hasAttribute('hidden')).toBe(false);
    expect(root.firstElementChild).toBe(strip);
    expect(strip.querySelector('.pr-label')).toBeNull();
    const chips = [...strip.querySelectorAll('.pr-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['#7 feat/pr-7', '#5 feat/pr-5']);
    expect(chips[0].classList.contains('pr-open')).toBe(true);
    expect(chips[1].classList.contains('pr-merged')).toBe(true);
    expect(chips[0].getAttribute('data-tip')).toBe('Add repo caching');
  });

  it('lists every pull request in one scrolling strip, with no "+N more" chip', () => {
    const many = Array.from({ length: 9 }, (_, i) => pr(String(20 - i)));
    const { root } = mount(mapWith(many), { pr: '13' });
    expect(root.querySelectorAll('.pr-chip')).toHaveLength(9);
    expect(root.querySelector('.pr-more')).toBeNull();
    expect(chip(root, '13').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.pr-item')).toHaveLength(9);
  });
});

describe('pull request mode', () => {
  it('highlights exactly the nodes the pull request touched and dims the rest', () => {
    const { root } = mount(mapWith([OPEN, MERGED]));
    expect(root.querySelectorAll('.lt-pixi-node-access.pr-hit, .lt-pixi-node-access.pr-off')).toHaveLength(0);
    chip(root, '7').click();
    expect(nodesOf(root, '.pr-hit').sort()).toEqual(['repo.ts', 'svc.ts', 'util.ts']);
    expect(nodesOf(root, '.pr-off')).toEqual(['page.tsx']);
    const title = (name: string) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access.pr-hit')].find((button) => button.textContent === name)?.dataset.tip;
    expect(title('svc.ts')).toContain('pull request ~');
    expect(title('util.ts')).toContain('pull request -');
    expect(root.querySelectorAll('.lt-pixi-node-access')).toHaveLength(4);
  });

  it('draws no node for a file that is not in the map', () => {
    const { root } = mount(mapWith([OPEN]));
    chip(root, '7').click();
    expect(nodesOf(root, '')).not.toContain('new.ts');
  });

  it('clicking the chip again leaves the mode', () => {
    const { root } = mount(mapWith([OPEN]));
    chip(root, '7').click();
    expect(root.querySelector('.pr-head')).not.toBeNull();
    chip(root, '7').click();
    expect(root.querySelector('.pr-head')).toBeNull();
    expect(root.querySelector('.search')).not.toBeNull();
    expect(root.querySelectorAll('.pr-hit, .pr-off')).toHaveLength(0);
  });

  it('still scopes the graph by the active platform while the panel lists every file', () => {
    const { root } = mount(mapWith([OPEN]), { platform: 'web' });
    chip(root, '7').click();
    expect(nodesOf(root, '.pr-hit')).toEqual(['svc.ts']);
    expect(nodesOf(root, '.pr-off')).toEqual(['page.tsx']);
    expect(root.querySelectorAll('.pr-file')).toHaveLength(4);
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.textContent).toContain('Web');
  });

  it('leaves the mode from the Back to filters button and from Clear all filters', () => {
    const onPr = vi.fn();
    const { root } = mount(mapWith([OPEN]), { onPr });
    chip(root, '7').click();
    expect(onPr).toHaveBeenLastCalledWith('7');
    (root.querySelector('[data-pr-back]') as HTMLElement).click();
    expect(root.querySelector('.pr-head')).toBeNull();
    expect(onPr).toHaveBeenLastCalledWith('');
    expect(chip(root, '7').getAttribute('aria-pressed')).toBe('false');

    (root.querySelector('button[data-role="service"]') as HTMLElement).click();
    chip(root, '7').click();
    const clear = root.querySelector('[data-clear-all]') as HTMLElement;
    expect(clear.textContent).toContain('Clear all filters');
    clear.click();
    expect(root.querySelector('.pr-head')).toBeNull();
    expect(root.querySelector('[data-role="service"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelectorAll('.lt-pixi-node-access')).toHaveLength(4);
  });

  it('starts in the remembered mode and forgets a pull request that disappeared', () => {
    const onPr = vi.fn();
    const { root, view } = mount(mapWith([OPEN, MERGED]), { pr: '5', onPr });
    expect(root.querySelector('.pr-head .pr-id')?.textContent).toContain('#5');
    view.update(mapWith([OPEN]));
    expect(root.querySelector('.pr-head')).toBeNull();
    expect(onPr).toHaveBeenLastCalledWith('');
    expect(root.querySelectorAll('.pr-hit, .pr-off')).toHaveLength(0);
    mount(mapWith([OPEN]), { pr: '404', onPr });
    expect(onPr).toHaveBeenLastCalledWith('');
  });

  it('keeps the sections overlay working over the pull request panel', () => {
    const { root } = mount(mapWith([OPEN], { sections: [RBAC] }));
    chip(root, '7').click();
    (root.querySelector('[data-section="rbac"]') as HTMLElement).click();
    expect((root.querySelector('.lt-side') as HTMLElement).hidden).toBe(true);
    expect((root.querySelector('.lt-overlay') as HTMLElement).hidden).toBe(false);
    (root.querySelector('[data-section="rbac"]') as HTMLElement).click();
    expect((root.querySelector('.lt-side') as HTMLElement).hidden).toBe(false);
    expect(root.querySelector('.pr-head')).not.toBeNull();
  });
});
