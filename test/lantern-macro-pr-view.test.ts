// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternPr, LanternPrOverlay, LanternRelation } from '../src/main/lantern';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { MACRO_MIN_FILES, macroGraph } from '../src/renderer/lib/lanternmacro';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { FIXTURE_ROOT, macroFixtureBlocks, macroFixtureRecords, macroFixtureView, repoFeatureTexts, repoPrRecord } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';
import { openPrFile } from './helpers/pr-rows';

const view = macroFixtureView();
const names = new Map(macroGraph(view).blocks.map((block) => [block.id, block.name]));
const loaded: MacroLoad = { ok: true, view, texts: repoFeatureTexts(), blockByPath: macroFixtureBlocks(), minStrongEdge: 8 };
const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const PR_ID = '108';
const record = repoPrRecord(PR_ID);
const changed = pr(PR_ID, { title: record.title, ordered: record.ordered, files: record.files.map((f) => ({ ...f, mapped: nodes.some((n) => n.path === f.path) })) });
const BIG = mapOf({ project: 'demo', nodes, relations, prs: [changed] });
const COUNTS: Record<string, [number, number]> = { 'code-insight': [1, 30], 'core:desktop': [13, 36], 'core:shared': [2, 11], 'projects-hub': [4, 5], 'serve-web': [1, 16] };

const mounted: ReturnType<typeof mountLanternView>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

function mount(map: LanternMap, opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const one = mountLanternView(root, map, { readMacro: () => Promise.resolve(loaded), ...opts });
  mounted.push(one);
  return { root, view: one };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const control = (root: HTMLElement, which: 'files' | 'macro') => root.querySelector(`.lt-viewbar [data-view="${which}"]`) as HTMLButtonElement;
const marking = (root: HTMLElement) => root.querySelector('.lt-viewbar [data-prmark]') as HTMLButtonElement | null;
const buttons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')];
const hits = (root: HTMLElement) => buttons(root).filter((button) => button.classList.contains('pr-hit'));
const blockButton = (root: HTMLElement, id: string) => buttons(root).find((button) => button.textContent === names.get(id)) as HTMLButtonElement;
const edgeNotes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-pixi-edge-access')];
const detail = (root: HTMLElement) => root.querySelector('.lt-side .lt-detail') as HTMLElement;

async function openMacro(map = BIG, opts: ViewOptions = {}) {
  const one = mount(map, { pr: PR_ID, ...opts });
  control(one.root, 'macro').click();
  await flush();
  return one;
}

describe('the Macro view in pull request mode', () => {
  it('lights every block that holds a changed file and no other, saying how many of its files changed', async () => {
    const { root } = await openMacro();

    const lit = hits(root).filter((button) => [...names.values()].includes(button.textContent ?? ''));
    expect(lit.map((button) => button.textContent).sort()).toEqual(Object.keys(COUNTS).map((id) => names.get(id)).sort());
    for (const [id, [count, total]] of Object.entries(COUNTS)) {
      expect(blockButton(root, id).getAttribute('aria-description')).toContain(`changed in the pull request: ${count} of ${total} files`);
      expect(view.blocks.find((block) => block.id === id)?.files).toBe(total);
    }
  });

  it('quiets the blocks and outside systems it does not touch, and keeps them readable', async () => {
    const { root } = await openMacro();

    const quiet = buttons(root).filter((button) => button.classList.contains('pr-off'));
    expect(quiet).toHaveLength(view.blocks.length - hits(root).length);
    expect(quiet.every((button) => !!button.textContent)).toBe(true);
  });

  it('draws no outside system at rest, and names the ones a changed file talks to in the side panel', async () => {
    const { root } = await openMacro();

    const lit = hits(root).map((button) => button.textContent);
    expect(lit).toHaveLength(Object.keys(COUNTS).length);
    expect(lit).not.toContain('osascript');
    expect(buttons(root).some((button) => button.textContent === 'osascript')).toBe(false);
    const touched = [...root.querySelectorAll('.lt-prsum [data-macro-go^="ext:"]')].map((button) => button.textContent);
    expect(touched.sort()).toEqual(['VS Code Serve Web', 'osascript']);
  });

  it('emphasises the feature links that carry a relation line from or to a changed file, and quiets the main ones', async () => {
    const { root } = await openMacro();

    const emphasised = edgeNotes(root).filter((note) => note.dataset.pr === 'true');
    const quiet = edgeNotes(root).filter((note) => note.dataset.pr === 'false');
    expect(emphasised).toHaveLength(5);
    expect(emphasised.every((note) => !note.textContent?.includes('Desktop shell'))).toBe(true);
    expect(quiet.length + emphasised.length).toBeGreaterThanOrEqual(macroGraph(view).edges.filter((edge) => edge.main).length);
  });

  it('writes the pull request, its counts and the files outside any block in the side panel', async () => {
    const { root } = await openMacro();

    const summary = root.querySelector('.lt-side .lt-prsum')?.textContent ?? '';
    expect(summary).toContain('#108');
    expect(summary).toContain(`${record.files.length} changed file`);
    expect(summary).toContain('Other files, 29');
    expect(summary).toContain('3 not in the map');
    expect(summary).toContain('11 test files');
    expect(summary).toContain('15 in the shared foundation');
  });

  it('counts a file added by the pull request in its feature block once the overlay arrives', async () => {
    const overlay: LanternPrOverlay = { prId: PR_ID, tip: 't1', nodes: [node('src/main/lantern-brand-new.ts', 'util', { feature: 'lantern-map', prNew: true })], relations: [], missing: [], warnings: [] };
    const withTip = { ...BIG, prs: [{ ...changed, tip: 't1', files: [...changed.files, { path: 'src/main/lantern-brand-new.ts', kind: 'added' as const, mapped: false, reason: 'Adds the new map reader' }] }] };
    const { root } = await openMacro(withTip, { readPrOverlay: () => Promise.resolve(overlay) });
    await flush();

    expect(blockButton(root, 'lantern-map').classList.contains('pr-hit')).toBe(true);
    expect(blockButton(root, 'lantern-map').getAttribute('aria-description')).toContain('1 of 80 files');
  });
});

describe('selecting a lit block', () => {
  it('lists its changed files with the reason of the pull request, in the order of the record', async () => {
    const { root } = await openMacro();

    blockButton(root, 'projects-hub').click();

    const rows = [...detail(root).querySelectorAll<HTMLElement>('.pr-file')];
    const expected = record.files.filter((f) => loaded.ok && loaded.blockByPath[f.path] === 'projects-hub');
    expect(expected).toHaveLength(4);
    expect(rows.map((row) => row.querySelector('.pr-path')?.getAttribute('data-pr-go'))).toEqual(expected.map((f) => f.path));
    expect(rows.map((row) => row.querySelector('.pr-path[data-pr-go] .pr-reason')?.textContent)).toEqual(expected.map((f) => f.reason));
    expect(expected.every((f) => !!f.reason)).toBe(true);
    expect(detail(root).querySelector('.pr-num')).toBeNull();
    const order = rows.map((row) => record.files.findIndex((candidate) => candidate.path === row.querySelector('.pr-path')?.getAttribute('data-pr-go')));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('lists nothing for a block the pull request does not touch', async () => {
    const { root } = await openMacro();

    blockButton(root, 'agent-runs').click();

    expect(detail(root).querySelector('.pr-file')).toBeNull();
    expect(detail(root).textContent).not.toContain('Changed in this pull request');
  });

  it('opens a changed file in the review pane and stays on the Macro view', async () => {
    const readPrDiff = vi.fn(() => Promise.resolve({ ok: false as const, reason: 'no diff in the test' }));
    const { root } = await openMacro(BIG, { readPrDiff: readPrDiff as unknown as ViewOptions['readPrDiff'] });
    blockButton(root, 'projects-hub').click();
    const first = detail(root).querySelector<HTMLButtonElement>('.pr-path[data-pr-go]') as HTMLButtonElement;
    const path = first.getAttribute('data-pr-go') as string;

    first.click();

    expect(control(root, 'macro').getAttribute('aria-pressed')).toBe('true');
    expect(control(root, 'files').getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.lt-review .lt-code-path')?.getAttribute('data-tip')).toBe(path);
    expect(root.querySelector('.lt-side .pr-file.sel .pr-path')?.getAttribute('data-pr-go')).toBe(path);
  });

  it('offers the diff of a changed file from its row in the list', async () => {
    const readPrDiff = vi.fn(() => new Promise<never>(() => undefined));
    const { root } = await openMacro(BIG, { readPrDiff: readPrDiff as unknown as ViewOptions['readPrDiff'] });
    blockButton(root, 'projects-hub').click();
    expect(detail(root).querySelector('[data-pr-diff]')).toBeNull();
    const path = detail(root).querySelector('.pr-path[data-pr-go]')?.getAttribute('data-pr-go') as string;

    openPrFile(root, path, 'diff');

    expect(readPrDiff).toHaveBeenCalledWith(PR_ID, path);
  });

  it('says a lit outside system is touched by the pull request', async () => {
    const { root } = await openMacro();
    const system = root.querySelector('.lt-prsum [data-macro-go="ext:osascript"]') as HTMLButtonElement;

    system.click();

    expect(detail(root).textContent).toContain('A file this pull request changes talks to it.');
  });
});

describe('the control that hides the pull request on the Macro view', () => {
  it('is on by default, in pull request mode on the Macro view only', async () => {
    const plain = await openMacro(mapOf({ project: 'demo', nodes, relations, prs: [] }));
    expect(marking(plain.root)).toBeNull();

    const { root } = mount(BIG, { pr: PR_ID });
    expect(marking(root)).toBeNull();
    control(root, 'macro').click();
    await flush();
    expect(marking(root)?.getAttribute('aria-pressed')).toBe('true');
    control(root, 'files').click();
    expect(marking(root)).toBeNull();
  });

  it('hides the marking and returns the plain Macro view, then shows it again', async () => {
    const outside = await openMacro(mapOf({ project: 'demo', nodes, relations, prs: [] }));
    const plainSides = buttons(outside.root).map((button) => [button.textContent, button.getAttribute('aria-label'), button.getAttribute('aria-description'), button.className]);
    const { root } = await openMacro();
    blockButton(root, 'projects-hub').click();

    marking(root)?.click();

    expect(marking(root)?.getAttribute('aria-pressed')).toBe('false');
    expect(hits(root)).toHaveLength(0);
    expect(root.querySelectorAll('.pr-off')).toHaveLength(0);
    expect(edgeNotes(root).every((note) => note.dataset.pr === undefined)).toBe(true);
    expect(root.querySelector('.lt-prsum')).toBeNull();
    expect(detail(root).querySelector('.pr-file')).toBeNull();
    blockButton(root, 'projects-hub').click();
    expect(buttons(root).map((button) => [button.textContent, button.getAttribute('aria-label'), button.getAttribute('aria-description'), button.className])).toEqual(plainSides);

    marking(root)?.click();

    expect(marking(root)?.getAttribute('aria-pressed')).toBe('true');
    expect(hits(root)).toHaveLength(Object.keys(COUNTS).length);
    expect(root.querySelector('.lt-prsum')).not.toBeNull();
  });

  it('keeps the choice when the pull request changes and comes back', async () => {
    const other = pr('109', { files: [{ path: 'src/main/lantern.ts', kind: 'modified', mapped: true, reason: 'x' }] });
    const { root } = await openMacro({ ...BIG, prs: [changed, other] });
    marking(root)?.click();

    (root.querySelector('.pr-chip[data-pr="109"]') as HTMLElement).click();

    expect(hits(root)).toHaveLength(0);
    expect(marking(root)?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the Macro view in pull request mode follows the small-map rule', () => {
  const small = (count: number) => mapOf({ project: 'demo', nodes: Array.from({ length: count }, (_, i) => node(`src/f${i}.ts`, 'util')), prs: [pr(PR_ID, { tip: 't', files: [{ path: 'src/new0.ts', kind: 'added', mapped: false }] })] });
  const overlayAdding = (count: number): LanternPrOverlay => ({ prId: PR_ID, tip: 't', nodes: Array.from({ length: count }, (_, i) => node(`src/new${i}.ts`, 'util', { prNew: true })), relations: [], missing: [], warnings: [] });

  it('offers no Macro view for a small map, even when the pull request adds files that cross the cut', async () => {
    const { root } = mount(small(MACRO_MIN_FILES), { pr: PR_ID, readPrOverlay: () => Promise.resolve(overlayAdding(10)) });
    await flush();

    expect([...root.querySelectorAll('.lt-viewbar [data-view]')].map((button) => button.getAttribute('data-view'))).toEqual(['files', 'flow']);
    expect(control(root, 'macro')).toBeNull();
  });

  it('offers it above the cut', () => {
    const { root } = mount(small(MACRO_MIN_FILES + 1), { pr: PR_ID });

    expect(control(root, 'macro')).not.toBeNull();
  });
});

describe('the fixture behind these tests', () => {
  it('is the pinned macro fixture of 14 blocks and the real record of the pull request', () => {
    expect(FIXTURE_ROOT).toContain('lantern-macro');
    expect(view.blocks).toHaveLength(14);
    expect(record.id).toBe(PR_ID);
  });
});
