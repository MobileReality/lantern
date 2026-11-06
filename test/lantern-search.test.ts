// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapOf, node } from './helpers/lantern-map';
import { mountLanternView } from '../src/renderer/lib/lanternview';

const MAP = mapOf({
  nodes: [node('src/page.tsx', 'page'), node('src/service.ts', 'service'), node('src/server.ts', 'service'), node('src/repo.ts', 'repository')],
});

const mounted: ReturnType<typeof mountLanternView>[] = [];

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, MAP));
  return root;
}

const input = (root: HTMLElement) => root.querySelector('.search') as HTMLInputElement;
const type = (root: HTMLElement, value: string) => {
  input(root).value = value;
  input(root).dispatchEvent(new Event('input', { bubbles: true }));
};
const nodeCount = (root: HTMLElement) => root.querySelectorAll('.lt-pixi-node-access').length;
const shownFiles = (root: HTMLElement) => root.querySelector('.stats b')?.textContent;
const SIDE_KEEP = ['.search', '.coverage', '.legend', 'h2'];

describe('search is debounced', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const view of mounted.splice(0)) view.dispose();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('redraws nothing while typing and exactly once after the pause', () => {
    const root = mount();
    const before = root.querySelector('.lt-pixi-node-access');
    for (const q of ['s', 'se', 'ser', 'serv', 'servi', 'servic', 'service']) {
      type(root, q);
      vi.advanceTimersByTime(50);
    }
    expect(root.querySelector('.lt-pixi-node-access')).toBe(before);
    expect(nodeCount(root)).toBe(4);
    vi.advanceTimersByTime(200);
    const after = root.querySelector('.lt-pixi-node-access');
    expect(after).not.toBe(before);
    expect(nodeCount(root)).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(root.querySelector('.lt-pixi-node-access')).toBe(after);
  });

  it('updates only the counts and the clear-all button, leaving the rest of the side panel alone', () => {
    const root = mount();
    const side = root.querySelector('.lt-side') as HTMLElement;
    const keep = SIDE_KEEP.map((sel) => side.querySelector(sel));
    const stats = side.querySelector('.stats');
    expect(shownFiles(root)).toBe('4');
    expect(root.querySelector('[data-clear-all]')).toBeNull();
    type(root, 'serv');
    vi.advanceTimersByTime(200);
    expect(shownFiles(root)).toBe('2');
    expect(side.querySelector('.stats')).not.toBe(stats);
    expect(root.querySelector('[data-clear-all]')?.textContent).toBe('Clear all filters · 1');
    expect(SIDE_KEEP.map((sel) => side.querySelector(sel))).toEqual(keep);
  });

  it('keeps the search box, its focus and the caret while the results update', () => {
    const root = mount();
    input(root).focus();
    type(root, 'serv');
    input(root).setSelectionRange(2, 2);
    const box = input(root);
    vi.advanceTimersByTime(200);
    expect(input(root)).toBe(box);
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(2);
    expect(box.value).toBe('serv');
  });

  it('drops the clear-all button again when the text is erased', () => {
    const root = mount();
    type(root, 'serv');
    vi.advanceTimersByTime(200);
    type(root, '');
    vi.advanceTimersByTime(200);
    expect(root.querySelector('[data-clear-all]')).toBeNull();
    expect(shownFiles(root)).toBe('4');
    expect(nodeCount(root)).toBe(4);
  });

  it('applies the pending text at once when another control redraws before the pause ends', () => {
    const root = mount();
    type(root, 'serv');
    (root.querySelector('button[data-role="service"]') as HTMLElement).click();
    expect(nodeCount(root)).toBe(2);
    expect(input(root).value).toBe('serv');
    const settled = root.querySelector('.lt-pixi-node-access');
    vi.advanceTimersByTime(500);
    expect(root.querySelector('.lt-pixi-node-access')).toBe(settled);
  });

  it('still applies the pending text after a click that only selects a file', () => {
    const root = mount();
    type(root, 'serv');
    root.querySelector('.lt-pixi-node-access')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(nodeCount(root)).toBe(2);
  });
});
