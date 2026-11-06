// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternFlowStory } from '../src/main/lantern';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { reasonBlock } from '../src/renderer/lib/modalreason';
import { mapOf, node, pr } from './helpers/lantern-map';

const PR_ID = '7';
const A = 'src/a.ts';
const B = 'src/b.ts';
const files = [A, B].map((file) => ({ path: file, kind: 'modified' as const, mapped: true, reason: `Why ${file}` }));
const story: LanternFlowStory = {
  title: 'Alice checks out',
  steps: [
    { kind: 'actor', text: 'Alice', files: [A] },
    { kind: 'action', text: 'pays' },
  ],
  below: [],
};
const readers: ViewOptions = {
  readFile: async (file) => ({ exists: true, text: `live ${file}\n`, truncated: 0 }),
  readPrFile: async (_pr, file) => ({ ok: true, text: `branch ${file}\n`, truncated: false, binary: false, version: 'branch' }),
  readPrDiff: async (_pr, file) => ({ ok: true, diff: `@@ -1 +1 @@\n-old ${file}\n+new ${file}`, truncated: false, binary: false }),
};

const mounted: ReturnType<typeof mountLanternView>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const select = (el: Element) => document.getSelection()?.selectAllChildren(el);
const pressKey = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

async function mountFlow() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const map = mapOf({ project: 'demo', nodes: files.map((f) => node(f.path, 'service')), prs: [pr(PR_ID, { ordered: true, files, flow: [story] })] });
  mounted.push(mountLanternView(root, map, { pr: PR_ID, ...readers }));
  await flush();
  root.querySelector<HTMLElement>('.lt-viewbar [data-view="flow"]')?.click();
  return root;
}

const stepBlock = (root: HTMLElement) => root.querySelector<HTMLElement>('.lt-flow-block[data-flow-step]') as HTMLElement;
const chip = (root: HTMLElement) => root.querySelector<HTMLElement>('.lt-flow-file[data-flow-open]') as HTMLElement;
const listRow = (root: HTMLElement) => root.querySelector<HTMLElement>(`.lt-side [data-pr-go="${B}"]`) as HTMLElement;
const picked = (root: HTMLElement) => stepBlock(root).getAttribute('aria-pressed') === 'true';
const shown = (root: HTMLElement) => root.querySelector('.lt-review .lt-code-path')?.getAttribute('data-tip') ?? '';

describe('a drag-select that ends on a pressable Flow step', () => {
  it('does not pick the step, but a plain click still does', async () => {
    const root = await mountFlow();

    select(stepBlock(root).querySelector('.lt-flow-text') as Element);
    stepBlock(root).click();
    expect(picked(root)).toBe(false);

    document.getSelection()?.removeAllRanges();
    stepBlock(root).click();
    expect(picked(root)).toBe(true);
  });

  it('does not pick the step on Enter or Space either, until the selection is gone', async () => {
    const root = await mountFlow();

    select(stepBlock(root));
    pressKey(stepBlock(root), 'Enter');
    pressKey(stepBlock(root), ' ');
    expect(picked(root)).toBe(false);

    document.getSelection()?.removeAllRanges();
    pressKey(stepBlock(root), 'Enter');
    expect(picked(root)).toBe(true);
  });

  it('still picks the step when the selection is somewhere else', async () => {
    const root = await mountFlow();

    select(root.querySelector('.lt-flow-title') as Element);
    stepBlock(root).click();
    expect(picked(root)).toBe(true);
  });
});

describe('a drag-select that ends on a Flow file chip', () => {
  it('does not open the file, but a plain click does', async () => {
    const root = await mountFlow();

    select(chip(root));
    chip(root).click();
    await flush();
    expect(shown(root)).toBe('');

    document.getSelection()?.removeAllRanges();
    chip(root).click();
    await flush();
    expect(shown(root)).toBe(A);
  });
});

describe('a drag-select that ends on a review-list row', () => {
  it('does not open the file, but a plain click does', async () => {
    const root = await mountFlow();

    select(listRow(root));
    listRow(root).click();
    await flush();
    expect(shown(root)).toBe('');

    document.getSelection()?.removeAllRanges();
    listRow(root).click();
    await flush();
    expect(shown(root)).toBe(B);
  });
});

describe('a drag-select inside the WHY row', () => {
  it('does not fold or unfold it, but a plain click or key does', () => {
    const box = reasonBlock('Because the reader asked for it') as HTMLElement;
    document.body.append(box);

    select(box.querySelector('.lt-reason-text') as Element);
    box.click();
    pressKey(box, 'Enter');
    expect(box.classList.contains('open')).toBe(false);

    document.getSelection()?.removeAllRanges();
    box.click();
    expect(box.classList.contains('open')).toBe(true);
    pressKey(box, 'Enter');
    expect(box.classList.contains('open')).toBe(false);
  });
});

describe('the stylesheet that opts the content in', () => {
  const read = (...parts: string[]) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

  it('is loaded by the app window and copied by the build', () => {
    expect(read('src', 'renderer', 'workspace.html')).toContain('lantern-select.css');
    expect(read('scripts', 'esbuild.mjs')).toContain("'lantern-select.css'");
  });

  it('never opts the whole body or the graph canvas in', () => {
    const css = read('src', 'renderer', 'lantern-select.css');
    expect(css).not.toMatch(/(^|[\s,])(html|body|canvas|\*)\s*[,{]/);
    expect(css).not.toContain('.lt-main');
  });
});
