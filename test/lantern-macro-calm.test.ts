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

const ordered = changed.files.map((f) => f.path);
const feature = (path: string) => blockByPath[path]?.startsWith('core:') === false;
const start = ordered.findIndex((path, index) => index > 0 && index < ordered.length - 1 && feature(path));
const first = ordered[start];
const afterFirst = ordered[start + 1];
const beforeFirst = ordered[start - 1];

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
const shown = (root: HTMLElement) => root.querySelector('.lt-review .lt-code-path')?.getAttribute('data-tip');
const control = (root: HTMLElement, which: 'files' | 'macro') => root.querySelector(`.lt-viewbar [data-view="${which}"]`) as HTMLButtonElement;
const accessButtons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')];
const withClass = (root: HTMLElement, cls: string) => accessButtons(root).filter((button) => button.classList.contains(cls));
const listRow = (root: HTMLElement, path: string) => root.querySelector(`.lt-side-list [data-pr-go="${path}"]`) as HTMLElement;
const card = (root: HTMLElement, path: string) => accessButtons(root).find((button) => button.textContent === names.get(blockByPath[path])) as HTMLButtonElement;

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

async function openMacro(opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, BIG, { pr: PR_ID, readMacro: () => Promise.resolve(loaded), ...readers, ...opts }));
  control(root, 'macro').click();
  await flush();
  return root;
}

async function openAtFirst() {
  const root = await openMacro();
  listRow(root, first).click();
  await flush();
  expect(shown(root)).toBe(first);
  return root;
}

describe('the arrow keys on the Macro view while reviewing a pull request', () => {
  it('uses fixture files with a neighbour on both sides', () => {
    expect(start).toBeGreaterThan(0);
    expect(afterFirst).toBeTruthy();
  });

  it('step the files after a click on a Macro card', async () => {
    const root = await openAtFirst();
    card(root, first).click();
    await flush();

    press(card(root, first), 'ArrowRight');
    await flush();
    expect(shown(root)).toBe(afterFirst);

    press(card(root, afterFirst), 'ArrowLeft');
    await flush();
    expect(shown(root)).toBe(first);
    press(root.querySelector('.lt-side') as Element, 'ArrowLeft');
    await flush();
    expect(shown(root)).toBe(beforeFirst);
  });

  it('step the files when the Macro canvas has the focus', async () => {
    const root = await openAtFirst();
    const main = root.querySelector('.lt-main') as HTMLElement;
    main.focus();

    const ev = press(main, 'ArrowRight');
    await flush();

    expect(shown(root)).toBe(afterFirst);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('are left alone in a text field, on a divider and with a modifier held', async () => {
    const root = await openAtFirst();
    const field = Object.assign(document.createElement('input'), { type: 'text' });
    root.appendChild(field);

    expect(press(field, 'ArrowRight').defaultPrevented).toBe(false);
    press(root.querySelector('.lt-split[role="separator"]') as Element, 'ArrowRight');
    press(root.querySelector('.lt-main') as Element, 'ArrowRight', { shiftKey: true });
    press(root.querySelector('.lt-main') as Element, 'ArrowRight', { metaKey: true });
    await flush();

    expect(shown(root)).toBe(first);
  });

  it('do not step on the Files view from the graph', async () => {
    const root = await openAtFirst();
    control(root, 'files').click();
    await flush();

    press(root.querySelector('.lt-main') as Element, 'ArrowRight');
    await flush();

    expect(shown(root)).toBe(first);
  });

  it('do nothing before a file is open, so the canvas keeps panning', async () => {
    const root = await openMacro();
    const main = root.querySelector('.lt-main') as HTMLElement;
    main.focus();
    const ev = press(main, 'ArrowRight');

    expect(shown(root)).toBeFalsy();
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('the colours of the Macro view while a file is open in the review pane', () => {
  it('light the blocks the pull request touches when no file is open', async () => {
    const root = await openMacro();

    expect(withClass(root, 'pr-hit').length).toBeGreaterThan(2);
    expect(withClass(root, 'pr-calm')).toHaveLength(0);
    expect(withClass(root, 'open-file')).toHaveLength(0);
  });

  it('keep the strong marker on the open file block only and quiet every glow', async () => {
    const root = await openAtFirst();

    expect(withClass(root, 'open-file').map((button) => button.textContent)).toEqual([names.get(blockByPath[first])]);
    expect(withClass(root, 'pr-hit')).toHaveLength(0);
    expect(withClass(root, 'pr-calm').length).toBeGreaterThan(2);
    expect(root.querySelectorAll('.lt-pixi-edge-access[data-pr="true"]')).toHaveLength(0);
  });

  it('give the glow back when the file pane is left with no file, and drop every cue when the changes are hidden', async () => {
    const root = await openAtFirst();

    (root.querySelector('.lt-viewbar [data-prmark]') as HTMLElement).click();

    expect(withClass(root, 'pr-hit')).toHaveLength(0);
    expect(withClass(root, 'pr-calm')).toHaveLength(0);
    expect(withClass(root, 'open-file')).toHaveLength(1);
  });
});
