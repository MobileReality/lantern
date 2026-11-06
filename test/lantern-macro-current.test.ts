// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternMap, LanternNode, LanternRelation } from '../src/main/lantern';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { macroGraph } from '../src/renderer/lib/lanternmacro';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { macroFixtureBlocks, macroFixtureRecords, macroFixtureView, repoFeatureTexts, repoPrRecord } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';

const PR_ID = '108';
const view = macroFixtureView();
const blockByPath = macroFixtureBlocks();
const loaded: MacroLoad = { ok: true, view, texts: repoFeatureTexts(), blockByPath, minStrongEdge: 8 };
const names = new Map(macroGraph(view).blocks.map((block) => [block.id, block.name]));
const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const record = repoPrRecord(PR_ID);
const changed = pr(PR_ID, { title: record.title, ordered: record.ordered, files: record.files.map((f) => ({ ...f, mapped: nodes.some((n) => n.path === f.path) })) });
const BIG = mapOf({ project: 'demo', nodes, relations, prs: [changed] });

const inMap = (path: string) => nodes.some((n) => n.path === path);
const blockOf = (path: string) => blockByPath[path];
const feature = (path: string) => blockOf(path)?.startsWith('core:') === false;
const ordered = changed.files.map((f) => f.path);
const first = ordered.find(feature) as string;
const second = ordered.find((path) => feature(path) && blockOf(path) !== blockOf(first)) as string;
const foundation = ordered.find((path) => blockOf(path)?.startsWith('core:')) as string;
const test = ordered.find((path) => inMap(path) && !blockOf(path)) as string;
const unmapped = ordered.find((path) => !inMap(path)) as string;

const mounted: ReturnType<typeof mountLanternView>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

const readers: ViewOptions = {
  readFile: async (path) => ({ exists: true, text: `live ${path}\n`, truncated: 0 }),
  readPrFile: async (_pr, path) => ({ ok: true, text: `branch ${path}\n`, truncated: false, binary: false, version: 'branch' }),
  readPrDiff: async (_pr, path) => ({ ok: true, diff: `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false }),
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pane = (root: HTMLElement) => root.querySelector('.lt-review') as HTMLElement;
const shown = (root: HTMLElement) => pane(root).querySelector('.lt-code-path')?.getAttribute('data-tip');
const control = (root: HTMLElement, which: 'files' | 'macro') => root.querySelector(`.lt-viewbar [data-view="${which}"]`) as HTMLButtonElement;
const accessButtons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')];
const marked = (root: HTMLElement) => accessButtons(root).filter((button) => button.classList.contains('open-file')).map((button) => button.textContent);
const listRow = (root: HTMLElement, path: string) => root.querySelector(`.lt-side-list [data-pr-go="${path}"]`) as HTMLElement;
const note = (root: HTMLElement) => root.querySelector('.lt-overview .lt-open-note')?.textContent ?? '';

function expectMarkerOn(root: HTMLElement, path: string) {
  expect(shown(root)).toBe(path);
  expect(marked(root)).toEqual([names.get(blockOf(path))]);
}

async function openMacro(opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, BIG, { pr: PR_ID, readMacro: () => Promise.resolve(loaded), ...readers, ...opts }));
  control(root, 'macro').click();
  await flush();
  return root;
}

describe('the block of the file open in the review pane', () => {
  it('uses fixture files that sit in two different feature blocks, the foundation, a test and nowhere', () => {
    expect([first, second, foundation, test, unmapped].every(Boolean)).toBe(true);
    expect(blockOf(first)).not.toBe(blockOf(second));
  });

  it('is marked when the file is chosen from the list, with an accessible name', async () => {
    const root = await openMacro();
    expect(marked(root)).toEqual([]);

    listRow(root, first).click();
    await flush();

    expectMarkerOn(root, first);
    const button = accessButtons(root).find((candidate) => candidate.classList.contains('open-file')) as HTMLElement;
    expect(button.getAttribute('aria-description')).toContain('open in the review pane');
    expect(root.querySelector('.lt-viewbar [data-view="macro"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('moves to the block of the next file picked from the list', async () => {
    const root = await openMacro();
    listRow(root, first).click();
    await flush();

    listRow(root, second).click();
    await flush();

    expectMarkerOn(root, second);
  });

  it('follows a file picked on the Files graph once the Macro view is back', async () => {
    const root = await openMacro();
    control(root, 'files').click();
    const file = (path: string) => accessButtons(root).find((button) => button.dataset.tip.startsWith(path)) as HTMLElement;
    file(first).click();
    await flush();
    control(root, 'macro').click();
    await flush();
    expectMarkerOn(root, first);

    control(root, 'files').click();
    file(second).click();
    control(root, 'macro').click();
    await flush();

    expectMarkerOn(root, second);
  });

  it('moves with the stepper buttons and the arrow keys through every file of the pull request', async () => {
    const root = await openMacro();
    listRow(root, ordered[0]).click();
    await flush();
    const seen = new Set<string | undefined>();

    for (let step = 1; step < ordered.length; step += 1) {
      const path = ordered[step];
      const before = marked(root);
      if (step % 2) (pane(root).querySelector('.lt-step-next') as HTMLElement).click();
      else pane(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      await flush();
      expect(shown(root)).toBe(path);
      const wanted = blockOf(path) ? [names.get(blockOf(path))] : [];
      expect(marked(root)).toEqual(wanted);
      if (blockOf(path)) seen.add(blockOf(path));
      if (before.length && wanted.length && before[0] !== wanted[0]) expect(marked(root)).not.toEqual(before);
    }

    expect(seen.size).toBeGreaterThan(2);
    pane(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await flush();
    expect(shown(root)).toBe(ordered[ordered.length - 2]);
  }, 60_000);
});

describe('a file that is in no feature block', () => {
  it('puts the marker on the foundation block when the file sits there', async () => {
    const root = await openMacro();

    listRow(root, foundation).click();
    await flush();

    expectMarkerOn(root, foundation);
    expect(note(root)).toBe('');
  });

  it('says so in the side panel for a test file, and marks no block', async () => {
    const root = await openMacro();
    listRow(root, first).click();
    await flush();

    listRow(root, test).click();
    await flush();

    expect(shown(root)).toBe(test);
    expect(marked(root)).toEqual([]);
    expect(note(root)).toContain('is not in any block');
    listRow(root, second).click();
    await flush();
    expect(note(root)).toBe('');
  });

  it('says so for a file that is not in the map', async () => {
    const root = await openMacro();

    (root.querySelector(`.lt-side-list [data-pr-diff="${unmapped}"]`) as HTMLElement).click();
    await flush();

    expect(shown(root)).toBe(unmapped);
    expect(marked(root)).toEqual([]);
    expect(note(root)).toContain('is not in any block');
  });
});

describe('the marker beside the pull request marking', () => {
  it('sits on a block that the pull request also lights', async () => {
    const root = await openMacro();

    listRow(root, first).click();
    await flush();

    const button = accessButtons(root).find((candidate) => candidate.classList.contains('open-file')) as HTMLElement;
    expect(button.classList.contains('pr-calm')).toBe(true);
    expect(button.getAttribute('aria-description')).toContain('changed in the pull request');
  });

  it('survives hiding the pull request changes', async () => {
    const root = await openMacro();
    listRow(root, first).click();
    await flush();

    (root.querySelector('.lt-viewbar [data-prmark]') as HTMLElement).click();

    expect(root.querySelectorAll('.pr-hit')).toHaveLength(0);
    expectMarkerOn(root, first);
  });
});

describe('outside a pull request on the Macro view', () => {
  it('marks nothing without a pull request', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, { ...BIG, prs: [] }, { ...readers, readMacro: () => Promise.resolve(loaded) }));
    control(root, 'macro').click();
    await flush();

    expect(marked(root)).toEqual([]);
    expect(note(root)).toBe('');
  });

  it('marks nothing on the Files view', async () => {
    const root = await openMacro();
    listRow(root, first).click();
    await flush();

    control(root, 'files').click();

    expect(marked(root)).toEqual([]);
  });
});
