// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import { mapOf, node, pr } from './helpers/lantern-map';
import { NODES as SECTION_NODES, STATES, cite, openSection } from './helpers/lantern-sections';
import { mountLanternView } from '../src/renderer/lib/lanternview';

type Arrow = '>' | '<' | '=';

const rel = (from: string, arrow: Arrow, to: string) => ({ from, arrow, to, ext: null, symbol: null, label: '' });

const PAGE = 'src/ui/page.tsx';
const SVC = 'src/svc/cart.ts';
const REPO = 'src/repo/cart.ts';
const UTIL = 'src/lib/util.ts';
const OTHER = 'src/svc/other.ts';
const NODES = [node(PAGE, 'page'), node(SVC, 'service'), node(REPO, 'repository'), node(UTIL, 'util'), node(OTHER, 'service'), node('src/svc/third.ts', 'service')];
const RELATIONS = [rel(PAGE, '>', SVC), rel(SVC, '>', REPO), rel(SVC, '>', OTHER), rel(OTHER, '>', UTIL), rel(REPO, '>', UTIL), rel(SVC, '>', 'src/svc/third.ts')];

const OPEN = pr('7', {
  files: [
    { path: 'src/brand-new.ts', kind: 'added', mapped: false },
    { path: PAGE, kind: 'modified', mapped: true },
    { path: SVC, kind: 'modified', mapped: true },
    { path: REPO, kind: 'modified', mapped: true },
  ],
});
const OTHER_PR = pr('8', { files: [{ path: UTIL, kind: 'modified', mapped: true }, { path: OTHER, kind: 'modified', mapped: true }] });
const NO_MAPPED = pr('9', { files: [{ path: 'src/brand-new.ts', kind: 'added', mapped: false }] });

const mapWith = (extra: Partial<LanternMap> = {}) => mapOf({ nodes: NODES, relations: RELATIONS, prs: [OPEN, OTHER_PR, NO_MAPPED], ...extra });

const mounted: { root: HTMLElement; view: ReturnType<typeof mountLanternView> }[] = [];

function mount(map: LanternMap = mapWith()) {
  return mountWith(map).root;
}

function mountWith(map: LanternMap) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, map);
  mounted.push({ root, view });
  return { root, view };
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.view.dispose();
    entry.root.remove();
  }
});

const chip = (root: HTMLElement, id: string) => root.querySelector(`.pr-chip[data-pr="${id}"]`) as HTMLElement;
const toggle = (root: HTMLElement) => root.querySelector('.lt-pronly') as HTMLButtonElement;
const names = (root: HTMLElement) => [...root.querySelectorAll('.lt-pixi-node-access')].map((n) => n.textContent).sort();
const nodeG = (root: HTMLElement, name: string) => [...root.querySelectorAll('.lt-pixi-node-access')].find((g) => g.textContent === name) as SVGGElement;
const click = (root: HTMLElement, name: string) => nodeG(root, name).dispatchEvent(new MouseEvent('click', { bubbles: true }));
const graphHeight = (root: HTMLElement) => Math.max(...[...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].map((node) => Number(node.dataset.graphY) + Number(node.dataset.graphHeight)));
const layers = (root: HTMLElement) => new Set([...root.querySelectorAll('.lt-pixi-node-access')].map((node) => node.getAttribute('aria-description')?.split(' in ')[1]?.split(',')[0]).filter(Boolean));
const label = (root: HTMLElement) => toggle(root).textContent;
const stat = (root: HTMLElement) => root.querySelector('.lt-side .stats div')?.textContent;
const dimmed = (root: HTMLElement) => [...root.querySelectorAll('.lt-pixi-node-access.pr-off')].map((n) => n.textContent).sort();

const ALL = names(mount(mapWith({ prs: [] })));
const PR_FILES = [PAGE, SVC, REPO].map((p) => p.split('/').pop() as string).sort();

describe('Show only PR files button', () => {
  it('is absent until a pull request is open and again after it closes', () => {
    const root = mount();
    expect(toggle(root).hidden).toBe(true);
    expect(root.querySelector('.lt-rvbar')?.hasAttribute('hidden')).toBe(true);
    chip(root, '7').click();
    expect(root.querySelector('.lt-rvbar')?.hasAttribute('hidden')).toBe(false);
    expect(toggle(root).hidden).toBe(false);
    expect((root.querySelector('.lt-lock') as HTMLElement).hidden).toBe(true);
    expect((root.querySelector('.lt-rvtoggle') as HTMLElement).hidden).toBe(true);
    chip(root, '7').click();
    expect(toggle(root).hidden).toBe(true);
    expect(root.querySelector('.lt-rvbar')?.hasAttribute('hidden')).toBe(true);
  });

  it('is off by default: the pull request only highlights and dims', () => {
    const root = mount();
    chip(root, '7').click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(label(root)).toBe('Show only PR files');
    expect(names(root)).toEqual(ALL);
    expect(dimmed(root)).toEqual(['other.ts', 'third.ts', 'util.ts']);
  });

  it('shows only the files of the pull request that are in the map, and says how many', () => {
    const root = mount();
    chip(root, '7').click();
    toggle(root).click();
    expect(names(root)).toEqual(PR_FILES);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(label(root)).toBe('Showing only PR files · 3');
    expect(dimmed(root)).toEqual([]);
    expect(root.querySelector('.lt-pixi-node-access.pr-hit')).not.toBeNull();
  });

  it('collapses the columns to the visible files', () => {
    const root = mount();
    chip(root, '7').click();
    const fullHeight = graphHeight(root);
    const fullColumns = layers(root);
    toggle(root).click();
    expect(layers(root).size).toBeLessThan(fullColumns.size);
    expect(graphHeight(root)).toBeLessThanOrEqual(fullHeight);
    const rows = [...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].map((node) => `${node.dataset.graphX},${node.dataset.graphY}`);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('puts the other filters on top of it', () => {
    const root = mount();
    chip(root, '7').click();
    toggle(root).click();
    (root.querySelector('[data-pr-back]') as HTMLElement).click();
    expect(names(root)).toEqual(ALL);
  });

  it('restores the full graph when pressed again', () => {
    const root = mount();
    chip(root, '7').click();
    const fullHeight = graphHeight(root);
    toggle(root).click();
    toggle(root).click();
    expect(names(root)).toEqual(ALL);
    expect(graphHeight(root)).toBe(fullHeight);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(dimmed(root)).toEqual(['other.ts', 'third.ts', 'util.ts']);
    expect(root.querySelector('.lt-side .stats')).toBeNull();
  });

  it('resets when the pull request is closed, by chip or by the back button', () => {
    const root = mount();
    chip(root, '7').click();
    toggle(root).click();
    chip(root, '7').click();
    expect(names(root)).toEqual(ALL);
    chip(root, '7').click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(names(root)).toEqual(ALL);
    toggle(root).click();
    (root.querySelector('[data-pr-back]') as HTMLElement).click();
    expect(names(root)).toEqual(ALL);
    chip(root, '7').click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('carries to another pull request while the user stays in pull request mode', () => {
    const root = mount();
    chip(root, '7').click();
    toggle(root).click();
    chip(root, '8').click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(names(root)).toEqual(['other.ts', 'util.ts']);
    chip(root, '8').click();
    chip(root, '7').click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('says so when none of the pull request files are in the map', () => {
    const root = mount();
    chip(root, '9').click();
    toggle(root).click();
    expect(names(root)).toEqual([]);
    expect(root.querySelector('.lt-none')?.textContent).toContain('Show only PR files');
    toggle(root).click();
    expect(names(root)).toEqual(ALL);
    expect(root.querySelector('.lt-none')).toBeNull();
  });
});

describe('Show only PR files, counts and clear-all', () => {
  it('shows the filtered counts in the pull request panel and nowhere else', () => {
    const root = mount();
    chip(root, '7').click();
    expect(root.querySelector('.lt-side .stats')).toBeNull();
    toggle(root).click();
    expect(stat(root)).toBe(`3of ${NODES.length} files`);
    expect(root.querySelector('.lt-side .stats')?.textContent).toContain(`2of ${RELATIONS.length} relations`);
    expect(root.querySelector('.lt-side .pr-head')).not.toBeNull();
    toggle(root).click();
    expect(root.querySelector('.lt-side .stats')).toBeNull();
  });

  it('counts as one active filter, and clear-all clears it and leaves the pull request', () => {
    const root = mount();
    chip(root, '7').click();
    expect(root.querySelector('[data-clear-all]')).toBeNull();
    toggle(root).click();
    const clear = root.querySelector('[data-clear-all]') as HTMLElement;
    expect(clear.textContent).toBe('Clear all filters · 1');
    clear.click();
    expect(names(root)).toEqual(ALL);
    expect(toggle(root).hidden).toBe(true);
    expect(root.querySelector('.lt-side .search')).not.toBeNull();
    expect(root.querySelector('[data-clear-all]')).toBeNull();
    chip(root, '7').click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(names(root)).toEqual(ALL);
  });
});

describe('Show only PR files on the filtered graph', () => {
  it('draws no relation to a file outside the pull request', () => {
    const root = mount();
    chip(root, '7').click();
    toggle(root).click();
    click(root, 'cart.ts');
    const picked = [...root.querySelectorAll('.lt-pixi-node-access[aria-pressed="true"]')].map((n) => n.textContent);
    expect(picked).toHaveLength(1);
    const related = [...root.querySelectorAll('.lt-pixi-node-access[aria-description*="related"]')].map((node) => node.textContent);
    expect(related).not.toContain('other.ts');
    expect(related).not.toContain('third.ts');
  });

  it('keeps the click-to-reveal working: selecting and clearing', () => {
    const root = mount();
    chip(root, '7').click();
    toggle(root).click();
    click(root, 'page.tsx');
    expect(root.querySelectorAll('.lt-pixi-node-access[aria-description*="related"]').length).toBeGreaterThan(0);
    click(root, 'page.tsx');
    expect(root.querySelector('.lt-pixi-node-access[aria-pressed="true"]')).toBeNull();
    expect(names(root)).toEqual(PR_FILES);
  });

  it('notes how many related files the filter hides', () => {
    const root = mount();
    chip(root, '7').click();
    const note = root.querySelector('.lt-prnote') as HTMLElement;
    click(root, 'cart.ts');
    expect(note.hidden).toBe(true);
    toggle(root).click();
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('2 related files hidden by the PR filter');
    click(root, 'cart.ts');
    click(root, 'page.tsx');
    expect(note.textContent).toBe('');
    expect(note.hidden).toBe(true);
    toggle(root).click();
    expect(note.hidden).toBe(true);
  });

  it('opens the relation view on the filtered set only', () => {
    const root = mount();
    chip(root, '7').click();
    toggle(root).click();
    click(root, 'cart.ts');
    (root.querySelector('.lt-rvtoggle') as HTMLElement).click();
    expect(root.querySelector('.lt-rvtoggle')?.getAttribute('aria-pressed')).toBe('true');
    expect(names(root)).toEqual(['cart.ts', 'cart.ts', 'page.tsx']);
    toggle(root).click();
    expect(names(root)).toEqual(['cart.ts', 'cart.ts', 'other.ts', 'page.tsx', 'third.ts']);
    expect(root.querySelector('.lt-rvtoggle')?.getAttribute('aria-pressed')).toBe('true');
    toggle(root).click();
    expect(names(root)).toEqual(['cart.ts', 'cart.ts', 'page.tsx']);
  });

  it('locks on a pull request file and inspects the others', () => {
    const root = mount();
    chip(root, '7').click();
    toggle(root).click();
    click(root, 'cart.ts');
    (root.querySelector('.lt-lock') as HTMLElement).click();
    expect(root.querySelector('.lt-lock')?.getAttribute('aria-pressed')).toBe('true');
    click(root, 'page.tsx');
    expect([...root.querySelectorAll('.lt-pixi-node-access[aria-pressed="true"]')].map((n) => n.textContent)).toEqual(['cart.ts']);
    expect([...root.querySelectorAll('.lt-pixi-node-access.insp')].map((n) => n.textContent)).toEqual(['page.tsx']);
    expect(names(root)).toEqual(PR_FILES);
  });

  it('unlocks when the filter hides the locked file, and brings it back with the graph', () => {
    const root = mount();
    chip(root, '8').click();
    click(root, 'cart.ts');
    (root.querySelector('.lt-lock') as HTMLElement).click();
    toggle(root).click();
    expect(names(root)).toEqual(['other.ts', 'util.ts']);
    expect(root.querySelector('.lt-lock')?.getAttribute('aria-pressed')).toBe('false');
    toggle(root).click();
    expect(names(root)).toEqual(ALL);
  });

  it('hides the note while the picked file is itself hidden by the filter', () => {
    const root = mount();
    chip(root, '7').click();
    click(root, 'other.ts');
    toggle(root).click();
    expect((root.querySelector('.lt-prnote') as HTMLElement).hidden).toBe(true);
  });

  it('drops the filter when a section cites a file outside the pull request', () => {
    const map = mapOf({ nodes: SECTION_NODES, sections: [STATES], prs: [pr('4', { files: [{ path: 'src/auth.ts', kind: 'modified', mapped: true }] })] });
    const root = mount(map);
    chip(root, '4').click();
    toggle(root).click();
    expect(names(root)).toEqual(['auth.ts']);
    openSection(root, 'states');
    (root.querySelector('.sx-machine .sx-cite[data-cite="src/order.ts"]') as HTMLElement).click();
    expect(names(root)).toEqual(['auth.ts', 'order.ts']);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(toggle(root).hidden).toBe(false);
    expect(root.querySelector('.lt-pixi-node-access[aria-pressed="true"]')?.textContent).toBe('order.ts');
  });

  it('resets when a reload drops the open pull request, and keeps the set in step when it changes', () => {
    const { root, view } = mountWith(mapWith());
    chip(root, '7').click();
    toggle(root).click();
    view.update(mapWith({ prs: [{ ...OPEN, files: [...OPEN.files, { path: UTIL, kind: 'modified', mapped: true }] }] }));
    expect(names(root)).toEqual([...PR_FILES, 'util.ts'].sort());
    view.update(mapWith({ prs: [] }));
    expect(names(root)).toEqual(ALL);
    expect(toggle(root).hidden).toBe(true);
    view.update(mapWith());
    chip(root, '7').click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the filter when a file is picked from the pull request list', () => {
    const root = mount();
    chip(root, '7').click();
    toggle(root).click();
    (root.querySelector('[data-pr-go]') as HTMLElement).click();
    expect(names(root)).toEqual(PR_FILES);
    expect(root.querySelector('.lt-pixi-node-access[aria-pressed="true"]')).not.toBeNull();
  });
});

describe('Show only PR files with platform tabs', () => {
  const PLATFORMS = [
    { id: 'web', kind: 'web' as const, label: 'Web', count: 2 },
    { id: 'api', kind: 'backend' as const, label: 'API', count: 3 },
  ];
  const web = (path: string, role: string) => node(path, role, { platform: 'web' });
  const api = (path: string, role: string) => node(path, role, { platform: 'api' });
  const map = mapOf({
    nodes: [web('web/page.tsx', 'page'), web('web/hook.ts', 'hook'), api('api/svc.ts', 'service'), api('api/repo.ts', 'repository'), api('api/other.ts', 'service')],
    relations: [rel('web/page.tsx', '>', 'api/svc.ts'), rel('web/hook.ts', '>', 'api/other.ts'), rel('api/svc.ts', '>', 'api/repo.ts')],
    platforms: PLATFORMS,
    prs: [pr('3', { files: [{ path: 'web/page.tsx', kind: 'modified', mapped: true }, { path: 'api/svc.ts', kind: 'modified', mapped: true }] })],
  });

  it('does not claim the files are unmapped when another tab holds them', () => {
    const root = mount(map);
    chip(root, '3').click();
    toggle(root).click();
    (root.querySelector('.lt-tabs [data-plat="web"]') as HTMLElement).click();
    expect(names(root).length).toBeGreaterThan(0);
    const only = pr('5', { files: [{ path: 'web/hook.ts', kind: 'modified', mapped: true }] });
    const empty = mapOf({ ...map, prs: [only] });
    const second = mount(empty);
    chip(second, '5').click();
    toggle(second).click();
    (second.querySelector('.lt-tabs [data-plat="api"]') as HTMLElement).click();
    expect(second.querySelector('.lt-none')?.textContent).toContain('No file of this pull request matches these filters');
  });

  it('draws a boundary stub for a pull request file on another platform but not for other files', () => {
    const root = mount(map);
    chip(root, '3').click();
    toggle(root).click();
    expect(names(root)).toEqual(['page.tsx', 'svc.ts']);
    (root.querySelector('.lt-tabs [data-plat="web"]') as HTMLElement).click();
    expect(names(root)).toEqual(['page.tsx', 'svc.ts']);
    expect(root.querySelector('.lt-pixi-node-access.pr-hit')?.textContent).toBe('page.tsx');
    const web = root.querySelector('.lt-tabs [data-plat="web"]');
    expect(web?.getAttribute('aria-selected')).toBe('true');
  });
});
