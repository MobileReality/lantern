// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrFileDiff } from '../src/main/lantern-prdiff';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import type { LanternMap, LanternNode, LanternRelation } from '../src/main/lantern';
import { macroGraph } from '../src/renderer/lib/lanternmacro';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { macroFixtureBlocks, macroFixtureRecords, macroFixtureView, repoFeatureTexts, repoPrRecord } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';

const NODES = [
  node('src/page.tsx', 'page'),
  node('src/svc.ts', 'service'),
  node('src/repo.ts', 'repository'),
  node('src/util.ts', 'util'),
];
const OPEN = pr('7', {
  title: 'Add repo caching',
  files: [
    { path: 'src/svc.ts', kind: 'modified', mapped: true, reason: 'Reads through the cache.' },
    { path: 'src/repo.ts', kind: 'modified', mapped: true, reason: 'Adds the cache.' },
    { path: 'src/util.ts', kind: 'removed', mapped: true },
  ],
});
const EMPTY_LINE = 'Pick a file in the list or on the graph to read it here.';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  localStorage.clear();
});

function readers() {
  const readFile = vi.fn(async (path: string) => ({ exists: true, text: `live ${path}\n`, truncated: 0 }));
  const readPrFile = vi.fn(async (_pr: string, path: string) => ({ ok: true as const, text: `branch ${path}\n`, truncated: false, binary: false, version: 'branch' as const }));
  const readPrDiff = vi.fn(async (_pr: string, path: string): Promise<PrFileDiff> => ({ ok: true, diff: `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false }));
  return { readFile, readPrFile, readPrDiff };
}

function mount(map: LanternMap = mapOf({ nodes: NODES, prs: [OPEN] }), opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const spies = readers();
  const one = mountLanternView(root, map, { ...spies, ...opts });
  mounted.push(one);
  return { root, view: one, ...spies };
}

const chip = (root: HTMLElement, id: string) => root.querySelector(`.pr-chip[data-pr="${id}"]`) as HTMLElement;
const pane = (root: HTMLElement) => root.querySelector('.lt-review') as HTMLElement | null;
const paneTitle = (root: HTMLElement) => pane(root)?.querySelector('.lt-code-path')?.getAttribute('data-tip');
const node_ = (root: HTMLElement, name: string) => [...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].find((button) => button.textContent === name) as HTMLElement;
const row = (root: HTMLElement) => root.querySelector('.lt-side .pr-file.sel')?.getAttribute('data-tip') ?? root.querySelector('.lt-side .pr-file.sel .pr-path')?.getAttribute('data-pr-go');
const pressed = (root: HTMLElement) => root.querySelector('.lt-pixi-node-access[aria-pressed="true"]')?.textContent;
const mode = (root: HTMLElement) => pane(root)?.querySelector('.lt-review-mode[aria-pressed="true"]')?.textContent;
const bodyText = (root: HTMLElement) => pane(root)?.querySelector('.lt-review-body > :not([hidden])')?.textContent ?? '';

describe('the three-pane layout follows the pull request selection', () => {
  it('has no review pane, no dividers and no layout class without a pull request', () => {
    const { root } = mount();
    expect(pane(root)).toBeNull();
    expect(root.querySelector('.lt-split')).toBeNull();
    expect(root.querySelector('.lt-grid')?.classList.contains('lt-review-on')).toBe(false);
  });

  it('shows list, file pane and graph side by side once a pull request is chosen, and restores the screen when it is left', () => {
    const { root } = mount();
    const grid = root.querySelector('.lt-grid') as HTMLElement;
    const columns = () => [...grid.children].map((child) => child.className).filter((name) => name !== 'lt-zoom' && !name.startsWith('lt-rail') && !name.includes('lt-overview'));
    const before = columns();

    chip(root, '7').click();

    expect(grid.classList.contains('lt-review-on')).toBe(true);
    expect(columns()).toEqual(['lt-side', 'lt-split', 'lt-review', 'lt-split', 'lt-main', 'lt-overlay', 'lt-planpane']);
    expect(grid.querySelector('.lt-side .pr-file')).not.toBeNull();
    expect(grid.querySelector('.lt-main .lt-pixi-host')).not.toBeNull();

    chip(root, '7').click();

    expect(pane(root)).toBeNull();
    expect(root.querySelector('.lt-split')).toBeNull();
    expect(grid.classList.contains('lt-review-on')).toBe(false);
    expect(columns()).toEqual(before);
    expect(root.querySelector('.search')).not.toBeNull();
  });

  it('says what to do in one line while nothing is selected', () => {
    const { root } = mount();
    chip(root, '7').click();
    const line = pane(root)?.querySelector('.lt-review-empty') as HTMLElement;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe(EMPTY_LINE);
    expect((pane(root)?.querySelector('.lt-review-head') as HTMLElement).hidden).toBe(true);
  });
});

describe('every way of choosing a file lands it in the middle pane', () => {
  it('shows a file picked in the list, selects its node and keeps its row marked', async () => {
    const { root, readPrFile } = mount();
    chip(root, '7').click();

    (root.querySelector('[data-pr-go="src/repo.ts"]') as HTMLElement).click();
    await flush();

    expect(paneTitle(root)).toBe('src/repo.ts');
    expect(readPrFile).toHaveBeenCalledWith('7', 'src/repo.ts');
    expect(bodyText(root)).toContain('branch src/repo.ts');
    expect(pressed(root)).toBe('repo.ts');
    expect(row(root)).toBe('src/repo.ts');
    expect((pane(root)?.querySelector('.lt-review-empty') as HTMLElement).hidden).toBe(true);
  });

  it('shows a file picked on the graph and moves the marked row with it', async () => {
    const { root } = mount();
    chip(root, '7').click();
    (root.querySelector('[data-pr-go="src/repo.ts"]') as HTMLElement).click();
    await flush();

    node_(root, 'svc.ts').click();
    await flush();

    expect(paneTitle(root)).toBe('src/svc.ts');
    expect(bodyText(root)).toContain('branch src/svc.ts');
    expect(pressed(root)).toBe('svc.ts');
    expect(row(root)).toBe('src/svc.ts');
    expect(pane(root)?.querySelector('.lt-reason-text')?.textContent).toBe('Reads through the cache.');
  });

  it('shows a file of the graph that the pull request did not change, from the working tree', async () => {
    const { root, readFile } = mount();
    chip(root, '7').click();

    node_(root, 'page.tsx').click();
    await flush();

    expect(paneTitle(root)).toBe('src/page.tsx');
    expect(readFile).toHaveBeenCalledWith('src/page.tsx');
    expect(bodyText(root)).toContain('live src/page.tsx');
    expect(root.querySelector('.lt-side .pr-file.sel')).toBeNull();
  });

  it('empties the pane again when the selected node is clicked a second time', async () => {
    const { root } = mount();
    chip(root, '7').click();
    node_(root, 'svc.ts').click();
    await flush();
    expect(paneTitle(root)).toBe('src/svc.ts');

    node_(root, 'svc.ts').click();

    expect(pressed(root)).toBeUndefined();
    expect((pane(root)?.querySelector('.lt-review-empty') as HTMLElement).hidden).toBe(false);
  });

  it('shows the file already selected when the pull request is chosen afterwards', async () => {
    const { root } = mount();
    node_(root, 'repo.ts').click();

    chip(root, '7').click();
    await flush();

    expect(paneTitle(root)).toBe('src/repo.ts');
    expect(row(root)).toBe('src/repo.ts');
  });

  it('shows the diff of a file that is not in the map, without selecting a node', async () => {
    const withGone = pr('7', { files: [...OPEN.files, { path: 'src/gone.ts', kind: 'removed', mapped: false }] });
    const { root, readPrDiff } = mount(mapOf({ nodes: NODES, prs: [withGone] }));
    chip(root, '7').click();

    (root.querySelector('[data-pr-diff="src/gone.ts"]') as HTMLElement).click();
    await flush();

    expect(paneTitle(root)).toBe('src/gone.ts');
    expect(readPrDiff).toHaveBeenCalledWith('7', 'src/gone.ts');
    expect(root.querySelector('.lt-side .pr-file.sel')?.textContent).toContain('gone.ts');
    expect(pressed(root)).toBeUndefined();
  });
});

describe('with the selection locked', () => {
  it('shows the inspected file and keeps showing it when its own buttons are pressed again', async () => {
    const { root } = mount();
    chip(root, '7').click();
    (root.querySelector('[data-pr-go="src/svc.ts"]') as HTMLElement).click();
    (root.querySelector('.lt-lock') as HTMLElement).click();
    node_(root, 'repo.ts').click();
    await flush();
    expect(paneTitle(root)).toBe('src/repo.ts');

    (root.querySelector('[data-pr-diff="src/repo.ts"]') as HTMLElement).click();
    (root.querySelector('[data-pr-code="src/repo.ts"]') as HTMLElement | null)?.click();
    (root.querySelector('[data-pr-diff="src/repo.ts"]') as HTMLElement).click();
    await flush();

    expect(paneTitle(root)).toBe('src/repo.ts');
    expect(mode(root)).toBe('Diff');
    expect(row(root)).toBe('src/repo.ts');
  });
});

describe('the middle pane switches between the file and its diff', () => {
  it('opens on the file, shows the diff on request and comes back, reading each once', async () => {
    const { root, readPrFile, readPrDiff } = mount();
    chip(root, '7').click();
    (root.querySelector('[data-pr-go="src/svc.ts"]') as HTMLElement).click();
    await flush();
    expect(mode(root)).toBe('File');
    expect(bodyText(root)).toContain('branch src/svc.ts');
    expect(readPrDiff.mock.calls.map((c) => c[1]).sort()).toEqual(['src/repo.ts', 'src/svc.ts', 'src/util.ts']);

    (pane(root)?.querySelector('[data-review-mode="diff"]') as HTMLElement).click();
    await flush();
    expect(mode(root)).toBe('Diff');
    expect(readPrDiff).toHaveBeenCalledWith('7', 'src/svc.ts');
    expect(bodyText(root)).toContain('new src/svc.ts');

    (pane(root)?.querySelector('[data-review-mode="file"]') as HTMLElement).click();
    await flush();
    expect(mode(root)).toBe('File');
    expect(bodyText(root)).toContain('branch src/svc.ts');
    expect(readPrFile).toHaveBeenCalledTimes(1);
    expect(readPrDiff).toHaveBeenCalledTimes(3);
  });

  it('keeps the chosen view while another file is picked', async () => {
    const { root } = mount();
    chip(root, '7').click();
    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    await flush();

    node_(root, 'repo.ts').click();
    await flush();

    expect(mode(root)).toBe('Diff');
    expect(paneTitle(root)).toBe('src/repo.ts');
    expect(bodyText(root)).toContain('new src/repo.ts');
  });

  it('is announced as a labelled group of two pressed-state buttons', async () => {
    const { root } = mount();
    chip(root, '7').click();
    (root.querySelector('[data-pr-go="src/svc.ts"]') as HTMLElement).click();

    const group = pane(root)?.querySelector('.lt-review-modes') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBeTruthy();
    expect([...group.querySelectorAll('button')].map((button) => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([['File', 'true'], ['Diff', 'false']]);
  });
});

describe('the Macro view shares the same selection', () => {
  const view = macroFixtureView();
  const loaded: MacroLoad = { ok: true, view, texts: repoFeatureTexts(), blockByPath: macroFixtureBlocks(), minStrongEdge: 8 };
  const records = macroFixtureRecords();
  const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
  const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
  const record = repoPrRecord('108');
  const changed = pr('108', { title: record.title, ordered: record.ordered, files: record.files.map((f) => ({ ...f, mapped: nodes.some((n) => n.path === f.path) })) });
  const big = mapOf({ project: 'demo', nodes, relations, prs: [changed] });
  const names = new Map(macroGraph(view).blocks.map((block) => [block.id, block.name]));
  const blockButton = (root: HTMLElement, id: string) => [...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].find((button) => button.textContent === names.get(id)) as HTMLElement;

  it('shows a changed file picked in the Macro side panel and stays on the Macro view, with the list following', async () => {
    const { root } = mount(big, { pr: '108', readMacro: () => Promise.resolve(loaded) });
    (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-side .lt-side-list .pr-file')).not.toBeNull();
    blockButton(root, 'projects-hub').click();
    const entry = root.querySelector<HTMLElement>('.lt-overview .lt-detail .pr-path[data-pr-go]') as HTMLElement;
    const path = entry.getAttribute('data-pr-go') as string;

    entry.click();
    await flush();

    expect(paneTitle(root)).toBe(path);
    expect(root.querySelector('.lt-viewbar [data-view="macro"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.lt-viewbar [data-view="files"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.lt-side-list .pr-file.sel .pr-path')?.getAttribute('data-pr-go')).toBe(path);
  });

  it('keeps the file list on the left of the Macro view and the file in the middle', async () => {
    const { root } = mount(big, { pr: '108', readMacro: () => Promise.resolve(loaded) });
    (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLElement).click();
    await flush();
    const first = root.querySelector('.lt-side-list [data-pr-go]') as HTMLElement;
    const path = first.getAttribute('data-pr-go') as string;

    (root.querySelector(`.lt-side-list [data-pr-diff="${path}"]`) as HTMLElement).click();
    await flush();

    expect(root.querySelector('.lt-viewbar [data-view="macro"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(paneTitle(root)).toBe(path);
    expect(mode(root)).toBe('Diff');
    expect(root.querySelector('.lt-side-list .pr-file.sel .pr-path')?.getAttribute('data-pr-go')).toBe(path);
  });
});
