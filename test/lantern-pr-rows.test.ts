// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternNode, LanternPr } from '../src/main/lantern';
import { openCopyMenu } from '../src/renderer/lib/copymenu';
import { fileRow } from '../src/renderer/lib/lanternprpanel';
import type { PrPanelContext } from '../src/renderer/lib/lanternprpanel';
import { createReviewPane } from '../src/renderer/lib/lanternreview';

const PR = { id: '7', title: 'Rows', branch: 'feat/rows', base: 'main', files: [] } as unknown as LanternPr;

function rowOf(ctx: Partial<PrPanelContext>, file: { path: string; kind: 'added' | 'modified' | 'removed'; reason?: string }) {
  const host = document.createElement('ul');
  host.innerHTML = fileRow({ pr: PR, byPath: new Map(), selected: null, canOpenCode: false, activeFilters: 0, ...ctx }, { mapped: true, ...file });
  return host.firstElementChild as HTMLElement;
}

afterEach(() => {
  localStorage.clear();
  document.body.textContent = '';
});

describe('a changed file row', () => {
  it('is one click target with the name, the folder, the counts and the reason, and no step number or buttons', () => {
    const byPath = new Map([['src/a.ts', {} as LanternNode]]);
    const row = rowOf({ byPath, stats: { 'src/a.ts': { added: 3, removed: 1 } } }, { path: 'src/a.ts', kind: 'modified', reason: 'Why it changed' });
    expect(row.dataset.path).toBe('src/a.ts');
    expect(row.querySelectorAll('button')).toHaveLength(1);
    const button = row.querySelector('button.pr-path') as HTMLElement;
    expect(button.dataset.prGo).toBe('src/a.ts');
    expect(button.querySelector('.file-name')?.textContent).toBe('a.ts');
    expect(button.querySelector('.file-directory')?.textContent).toBe('src/');
    expect(button.querySelector('.pr-stat')?.textContent).toBe('+3−1');
    expect(button.querySelector('.pr-reason')?.textContent).toBe('Why it changed');
    expect(row.querySelector('.pr-num, .pr-kind, [data-pr-diff], [data-pr-code]')).toBeNull();
  });

  it('shows no counts before they arrive and tags a file outside the map without a reason', () => {
    const row = rowOf({ canOpenDiff: true }, { path: 'img/x.svg', kind: 'added' });
    expect(row.classList.contains('off')).toBe(true);
    expect(row.querySelector('.pr-stat')).toBeNull();
    expect([...row.querySelectorAll('.pr-tag, .pr-noreason')].map((tag) => tag.textContent)).toEqual(['not in map', 'no reason']);
  });
});

describe('the review pane view', () => {
  it('remembers File or Diff for the next pane', () => {
    const read = () => new Promise<never>(() => {});
    const first = createReviewPane({ readFile: read, readDiff: read, onStep: vi.fn() });
    first.show({ pr: '7', path: 'src/a.ts' });
    expect(first.mode()).toBe('file');
    (first.el.querySelector('[data-review-mode="diff"]') as HTMLElement).click();
    expect(createReviewPane({ readFile: read, readDiff: read, onStep: vi.fn() }).mode()).toBe('diff');
  });
});

describe('the copy menu', () => {
  it('lists the entries as menu items, copies the chosen one and goes away', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const copy = vi.fn();
    openCopyMenu(trigger, document.body, [
      { label: 'Copy path', text: 'src/a.ts', done: 'Path copied.' },
      { label: 'Copy file name', text: 'a.ts', done: 'File name copied.' },
    ], copy);
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(['Copy path', 'Copy file name']);
    expect(document.activeElement).toBe(items[0]);
    items[1].click();
    expect(copy).toHaveBeenCalledWith(expect.objectContaining({ text: 'a.ts' }));
    expect(document.querySelector('.lt-copy-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
