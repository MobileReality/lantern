// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrFile } from '../src/main/lantern-prfile';
import type { PrFileDiff } from '../src/main/lantern-prdiff';
import { openCodeModal } from '../src/renderer/lib/codemodal';
import type { CodeSource, SemanticHighlightResult } from '../src/shared/code-highlighting';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';
import { openPrFile } from './helpers/pr-rows';

const ORDERED = pr('24', {
  ordered: true,
  files: [
    { path: 'src/types.ts', kind: 'modified', mapped: true, reason: 'Defines the contract.' },
    { path: 'src/gone.ts', kind: 'removed', mapped: false, reason: 'Nothing calls it any more.' },
    { path: 'test/new-a.ts', kind: 'added', mapped: false },
  ],
});
const PLAIN = pr('25', {
  files: [
    { path: 'test/new-a.ts', kind: 'added', mapped: false, reason: 'Covers the guard.' },
    { path: 'src/types.ts', kind: 'modified', mapped: true },
    { path: 'src/gone.ts', kind: 'removed', mapped: false },
  ],
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const diffOf = (path: string): PrFileDiff => ({ ok: true, diff: `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false });
const fileOf = (path: string, version: PrFile['version'] = 'branch'): PrFile => ({ ok: true, text: `content of ${path}\n`, truncated: false, binary: false, version });
const mounted: ReturnType<typeof mountLanternView>[] = [];

function open(p = ORDERED) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const readPrDiff = vi.fn(async (_pr: string, path: string) => diffOf(path));
  const readPrFile = vi.fn(async (_pr: string, path: string) => fileOf(path, path === 'src/gone.ts' ? 'before' : 'branch'));
  mounted.push(mountLanternView(root, mapOf({ nodes: [node('src/types.ts', 'service')], prs: [p] }), { pr: p.id, readPrDiff, readPrFile, readFile: async () => ({ exists: true, text: 'live', truncated: 0 }) }));
  return { root, readPrDiff, readPrFile };
}

const key = (root: HTMLElement, name: string, init: KeyboardEventInit = {}) => (root.querySelector('.lt-review') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
const counter = (root: HTMLElement) => root.querySelector('.lt-review .lt-step-count')?.textContent;
const titleOf = (root: HTMLElement) => {
  const title = root.querySelector('.lt-review .lt-code-path');
  return title ? `${title.querySelector('.file-name')?.textContent} ${title.querySelector('.file-directory')?.textContent}` : undefined;
};
const reasonOf = (root: HTMLElement) => root.querySelector('.lt-review .lt-modal-reason .lt-reason-text')?.textContent ?? null;
const prev = (root: HTMLElement) => root.querySelector('.lt-review .lt-step-prev') as HTMLButtonElement;
const next = (root: HTMLElement) => root.querySelector('.lt-review .lt-step-next') as HTMLButtonElement;
const selectedRow = (root: HTMLElement) => root.querySelector('.lt-side .pr-file.sel .pr-path')?.textContent;

afterEach(() => {
  localStorage.clear();
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
});

describe('stepping through a pull request in the diff view', () => {
  it('shows n / total and both arrows in the header, with the first file reached from its own row', async () => {
    const { root } = open();
    openPrFile(root, 'src/gone.ts', 'diff');
    await flush();
    expect(counter(root)).toBe('2 / 3');
    expect(root.querySelector('.lt-review .lt-review-head .lt-steps')).not.toBeNull();
    expect(prev(root).disabled).toBe(false);
    expect(next(root).disabled).toBe(false);
  });

  it('steps with the arrow buttons in review order, loads that file and updates the reason', async () => {
    const { root, readPrDiff } = open();
    openPrFile(root, 'src/types.ts', 'diff');
    await flush();
    expect(titleOf(root)).toBe('types.ts src/');
    expect(reasonOf(root)).toBe('Defines the contract.');
    next(root).click();
    await flush();
    expect(counter(root)).toBe('2 / 3');
    expect(titleOf(root)).toBe('gone.ts src/');
    expect(reasonOf(root)).toBe('Nothing calls it any more.');
    expect(readPrDiff).toHaveBeenCalledWith('24', 'src/gone.ts');
    expect(root.querySelector('.lt-review .cl.add')?.textContent).toContain('new src/gone.ts');
    next(root).click();
    await flush();
    expect(titleOf(root)).toBe('new-a.ts test/');
    expect(reasonOf(root)).toBeNull();
    expect(root.querySelector('.lt-review .lt-modal-reason')).toBeNull();
    prev(root).click();
    await flush();
    expect(titleOf(root)).toBe('gone.ts src/');
    expect(reasonOf(root)).toBe('Nothing calls it any more.');
  });

  it('steps with Left and Right inside the pane and stops at both ends without wrapping', async () => {
    const { root } = open();
    openPrFile(root, 'src/types.ts', 'diff');
    await flush();
    expect(prev(root).disabled).toBe(true);
    key(root, 'ArrowLeft');
    await flush();
    expect(counter(root)).toBe('1 / 3');
    key(root, 'ArrowRight');
    key(root, 'ArrowRight');
    await flush();
    expect(counter(root)).toBe('3 / 3');
    expect(next(root).disabled).toBe(true);
    key(root, 'ArrowRight');
    await flush();
    expect(counter(root)).toBe('3 / 3');
    expect(titleOf(root)).toBe('new-a.ts test/');
    key(root, 'ArrowLeft');
    await flush();
    expect(counter(root)).toBe('2 / 3');
  });

  it('leaves Up and Down to scroll the pane, and steps with them on the file rows', async () => {
    const { root } = open();
    openPrFile(root, 'src/types.ts', 'diff');
    await flush();
    const scroll = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    (root.querySelector('.lt-review') as HTMLElement).dispatchEvent(scroll);
    await flush();
    expect(scroll.defaultPrevented).toBe(false);
    expect(counter(root)).toBe('1 / 3');
    const row = () => root.querySelector('.lt-side .pr-file.sel .pr-path') as HTMLElement;
    row().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    expect(counter(root)).toBe('2 / 3');
    expect(titleOf(root)).toBe('gone.ts src/');
    row().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await flush();
    expect(counter(root)).toBe('1 / 3');
  });

  it('leaves an arrow another handler already took', async () => {
    const { root } = open();
    openPrFile(root, 'src/types.ts', 'diff');
    await flush();
    const taken = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    taken.preventDefault();
    (root.querySelector('.lt-review') as HTMLElement).dispatchEvent(taken);
    await flush();
    expect(counter(root)).toBe('1 / 3');
  });

  it('steps from the file list too, and leaves the arrows alone outside the pane and the list', async () => {
    const { root } = open();
    openPrFile(root, 'src/types.ts', 'diff');
    await flush();
    const outside = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
    expect(counter(root)).toBe('1 / 3');
    const inList = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    (root.querySelector('.lt-side') as HTMLElement).dispatchEvent(inList);
    await flush();
    expect(inList.defaultPrevented).toBe(true);
    expect(counter(root)).toBe('2 / 3');
  });

  it('ignores arrow keys with a modifier and stops the others from reaching other handlers', async () => {
    const { root } = open();
    openPrFile(root, 'src/types.ts', 'diff');
    await flush();
    key(root, 'ArrowRight', { shiftKey: true });
    key(root, 'ArrowRight', { metaKey: true });
    key(root, 'ArrowDown', { altKey: true });
    expect(counter(root)).toBe('1 / 3');
    const other = vi.fn();
    document.addEventListener('keydown', other);
    key(root, 'ArrowRight');
    document.removeEventListener('keydown', other);
    expect(other).not.toHaveBeenCalled();
  });

  it('scrolls the body to the top on every step', async () => {
    const { root } = open();
    openPrFile(root, 'src/types.ts', 'diff');
    await flush();
    const body = root.querySelector('.lt-review .lt-code-body:not([hidden])') as HTMLElement;
    body.scrollTop = 120;
    next(root).click();
    expect(body.scrollTop).toBe(0);
    await flush();
    body.scrollTop = 80;
    key(root, 'ArrowRight');
    await flush();
    expect(body.scrollTop).toBe(0);
  });

  it('shows only the latest file when stepping faster than the reads come back', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const pending: Record<string, (d: PrFileDiff) => void> = {};
    const readPrDiff = (_pr: string, path: string) => new Promise<PrFileDiff>((resolve) => {
      pending[path] = resolve;
    });
    mounted.push(mountLanternView(root, mapOf({ nodes: [node('src/types.ts', 'service')], prs: [ORDERED] }), { pr: '24', readPrDiff }));
    openPrFile(root, 'src/types.ts', 'diff');
    key(root, 'ArrowRight');
    pending['src/gone.ts'](diffOf('src/gone.ts'));
    pending['src/types.ts'](diffOf('src/types.ts'));
    await flush();
    expect(root.querySelector('.lt-review .cl.add')?.textContent).toContain('new src/gone.ts');
    expect(root.querySelectorAll('.lt-review .cl.add')).toHaveLength(1);
  });

  it('lets a removed file be stepped onto in diff mode, where the diff shows its deleted lines', async () => {
    const { root, readPrDiff } = open();
    openPrFile(root, 'src/types.ts', 'diff');
    await flush();
    key(root, 'ArrowRight');
    await flush();
    expect(readPrDiff).toHaveBeenCalledWith('24', 'src/gone.ts');
    expect(root.querySelector('.lt-review .rv-trunc')).toBeNull();
  });

  it('follows the panel order of an unordered pull request: added, then modified, then removed', async () => {
    const { root } = open(PLAIN);
    openPrFile(root, 'test/new-a.ts', 'diff');
    await flush();
    expect(counter(root)).toBe('1 / 3');
    expect(reasonOf(root)).toBe('Covers the guard.');
    key(root, 'ArrowRight');
    await flush();
    expect(titleOf(root)).toBe('types.ts src/');
    key(root, 'ArrowRight');
    await flush();
    expect(titleOf(root)).toBe('gone.ts src/');
    expect(counter(root)).toBe('3 / 3');
  });

  it('keeps the highlighted row of the list on the file the pane shows, mapped or not', async () => {
    const { root } = open();
    openPrFile(root, 'src/types.ts', 'diff');
    await flush();
    expect(selectedRow(root)).toContain('types.ts');
    next(root).click();
    await flush();
    expect(selectedRow(root)).toContain('gone.ts');
    expect(root.querySelectorAll('.lt-side .pr-file.sel')).toHaveLength(1);
  });
});

describe('stepping through a pull request in the file view', () => {
  it('shows n / total and steps in the same mode: file stays file, in review order', async () => {
    const { root, readPrFile, readPrDiff } = open();
    openPrFile(root, 'src/gone.ts', 'file');
    await flush();
    expect(counter(root)).toBe('2 / 3');
    expect(titleOf(root)).toBe('gone.ts src/');
    expect(root.querySelector('.lt-review .lt-code-note')?.textContent).toBe('version before PR #24');
    key(root, 'ArrowRight');
    await flush();
    expect(counter(root)).toBe('3 / 3');
    expect(titleOf(root)).toBe('new-a.ts test/');
    expect(readPrFile).toHaveBeenLastCalledWith('24', 'test/new-a.ts');
    expect(root.querySelector('.lt-review .lt-code-body')?.textContent).toContain('content of test/new-a.ts');
    expect(root.querySelector('.lt-review .lt-code-note')?.textContent).toBe('PR #24 branch version');
    expect(readPrDiff).toHaveBeenCalledTimes(3);
  });

  it('updates the reason, clears the previous file note, and the removed file shows the version before the PR', async () => {
    const { root } = open();
    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();
    expect(reasonOf(root)).toBeNull();
    prev(root).click();
    await flush();
    expect(titleOf(root)).toBe('gone.ts src/');
    expect(reasonOf(root)).toBe('Nothing calls it any more.');
    expect(root.querySelector('.lt-review .lt-code-note')?.textContent).toBe('version before PR #24');
    expect(root.querySelector('.lt-review .lt-code-body')?.textContent).toContain('content of src/gone.ts');
  });

  it('keeps stepping past a file whose version cannot be read, showing why instead of skipping it', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const readPrFile = vi.fn(async (_pr: string, path: string): Promise<PrFile> => (path === 'src/gone.ts' ? { ok: false, text: '', truncated: false, binary: false, version: 'before', reason: 'the pull request base is not available locally' } : fileOf(path)));
    mounted.push(mountLanternView(root, mapOf({ nodes: [node('src/types.ts', 'service')], prs: [ORDERED] }), { pr: '24', readPrFile }));
    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();
    key(root, 'ArrowLeft');
    await flush();
    expect(root.querySelector('.lt-review .lt-code-body')?.textContent).toContain('File not available: the pull request base is not available locally');
    key(root, 'ArrowRight');
    await flush();
    expect(titleOf(root)).toBe('new-a.ts test/');
  });

  it('stops at both ends: disabled arrows and no wrap', async () => {
    const { root } = open();
    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();
    expect(next(root).disabled).toBe(true);
    key(root, 'ArrowRight');
    await flush();
    expect(titleOf(root)).toBe('new-a.ts test/');
    key(root, 'ArrowLeft');
    key(root, 'ArrowLeft');
    await flush();
    expect(counter(root)).toBe('1 / 3');
    expect(prev(root).disabled).toBe(true);
    key(root, 'ArrowLeft');
    await flush();
    expect(titleOf(root)).toBe('types.ts src/');
  });

  it('keeps focus in the pane when the arrow it was on becomes disabled', async () => {
    const { root } = open();
    openPrFile(root, 'src/gone.ts', 'file');
    await flush();
    next(root).focus();
    next(root).click();
    await flush();
    expect(next(root).disabled).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('.lt-review .lt-review-mode[aria-pressed="true"]'));
  });

  it('does not attach a late semantic limit notice to the next file', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const sources = new Map<string, CodeSource>();
    const pending = new Map<string, (result: SemanticHighlightResult) => void>();
    const readPrFile = async (_pr: string, path: string) => {
      const source: CodeSource = { token: path, kind: 'revision', revision: 'a'.repeat(40), contentHash: path };
      sources.set(path, source);
      return { ...fileOf(path, path === 'src/gone.ts' ? 'before' : 'branch'), source };
    };
    const readSemantic = (path: string) => new Promise<SemanticHighlightResult>((resolve) => pending.set(path, resolve));
    mounted.push(mountLanternView(root, mapOf({ nodes: [node('src/types.ts', 'service')], prs: [ORDERED] }), { pr: '24', readPrFile, readSemantic }));
    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();
    key(root, 'ArrowLeft');
    await flush();
    pending.get('test/new-a.ts')?.({ ok: false, source: sources.get('test/new-a.ts')!, spans: [], reason: 'revision snapshot exceeds the preview safety limit' });
    await flush();

    expect(titleOf(root)).toBe('gone.ts src/');
    expect(root.querySelector('.semantic-limit-notice')).toBeNull();
  });
});

describe('modals outside a pull request step', () => {
  it('a plain code modal has no counter, no arrows, and ignores Left and Right', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const read = vi.fn(async () => ({ exists: true, text: 'x', truncated: 0 }));
    openCodeModal(root, read, 'src/a.ts', '');
    await flush();
    expect(root.querySelector('.lt-steps')).toBeNull();
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('a pull request row in the file view', () => {
  it('opens the exact pull request revision and steps through mapped and unmapped files', async () => {
    const { root, readPrFile } = open();
    openPrFile(root, 'src/types.ts', 'file');
    await flush();
    expect(counter(root)).toBe('1 / 3');
    expect(titleOf(root)).toBe('types.ts src/');
    expect(reasonOf(root)).toBe('Defines the contract.');
    expect(root.querySelector('.lt-review .lt-code-body')?.textContent).toContain('content of src/types.ts');
    expect(readPrFile).toHaveBeenLastCalledWith('24', 'src/types.ts');
    key(root, 'ArrowRight');
    await flush();
    expect(titleOf(root)).toBe('gone.ts src/');
    expect(readPrFile).toHaveBeenLastCalledWith('24', 'src/gone.ts');
    expect(root.querySelector('.lt-review .lt-code-note')?.textContent).toBe('version before PR #24');
  });
});
