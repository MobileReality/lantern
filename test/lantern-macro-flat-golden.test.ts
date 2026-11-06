// @vitest-environment jsdom
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { MACRO_MIN_FILES } from '../src/renderer/lib/lanternmacro';
import { AREAS_HINT_TEXT } from '../src/renderer/lib/lanternmacroareaside';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { macroFixtureBlocks, macroFixtureView } from './helpers/lantern-macro-fixture';
import { mapOf, node } from './helpers/lantern-map';

const GOLDEN = path.join(__dirname, 'fixtures', 'lantern-macro-flat.golden.txt');
const TEXTS = {
  'lantern-map': 'the map of the project, drawn as a graph of files and relations',
  'code-insight': 'reading and highlighting the code of a file next to the graph',
  'pull-requests': 'listing pull requests and marking what each one touches',
};
const loaded: MacroLoad = { ok: true, view: macroFixtureView(), texts: TEXTS, blockByPath: macroFixtureBlocks(), minStrongEdge: 8 };
const BIG = mapOf({ project: 'demo', nodes: Array.from({ length: MACRO_MIN_FILES + 1 }, (_, i) => node(`src/f${i}.ts`, 'util')) });

const mounted: ReturnType<typeof mountLanternView>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function openMacro(result: MacroLoad) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, BIG, { readMacro: () => Promise.resolve(result) }));
  (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLButtonElement).click();
  await flush();
  return root;
}

function nodeLines(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].map((b) => [b.textContent, b.getAttribute('aria-label'), b.getAttribute('aria-pressed'), b.getAttribute('aria-description'), b.dataset.tip, b.dataset.graphX, b.dataset.graphY, b.dataset.graphWidth, b.dataset.graphHeight].join(' | '));
}

function edgeLines(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('.lt-pixi-edge-access')].map((e) => `${e.dataset.edge} | ${e.dataset.count} | ${e.dataset.strong} | ${e.textContent}`);
}

function snapshotOf(root: HTMLElement, label: string) {
  const side = root.querySelector('.lt-overview-body') as HTMLElement;
  const bar = root.querySelector('.lt-viewbar') as HTMLElement;
  return [`## ${label}`, '### bar', bar.innerHTML.replace(/<button class="lt-plat lt-overview-toggle".*?<\/button>/, ''), '### side', side.innerHTML, '### nodes', ...nodeLines(root), '### edges', ...edgeLines(root)].join('\n');
}

describe('the flat Macro view of a project without areas', () => {
  it('draws exactly what it drew before the areas existed', async () => {
    const root = await openMacro(loaded);
    const rest = snapshotOf(root, 'rest');
    (root.querySelector('.lt-pixi-node-access[aria-label^="Lantern map"]') as HTMLButtonElement).click();
    const picked = snapshotOf(root, 'lantern map picked');

    await expect(`${rest}\n\n${picked}\n`).toMatchFileSnapshot(GOLDEN);
  });

  it('is the same when the payload names no areas and no warning', async () => {
    const plain = snapshotOf(await openMacro(loaded), 'x');
    const explicit = snapshotOf(await openMacro({ ...loaded, areas: undefined, areasWarning: undefined }), 'x');

    expect(explicit).toBe(plain);
    expect(plain).not.toContain('lt-crumbs');
  });

  it('shows no areas hint unless the payload asks for it, and then one quiet line in the side panel', async () => {
    const plain = await openMacro(loaded);
    expect(plain.innerHTML).not.toContain('lt-areas-hint');
    expect(plain.innerHTML).not.toContain('lantern-setup');

    const hinted = await openMacro({ ...loaded, areasHint: true });
    const lines = hinted.querySelectorAll('.lt-side .lt-areas-hint');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(AREAS_HINT_TEXT);
    expect(lines[0].textContent).toContain('Retag');
    expect(hinted.querySelector('.lt-side .lt-areas-hint button')).toBeNull();
    expect(hinted.querySelector('.lt-side .lt-areas-note')).toBeNull();
  });
});
