// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternGuide } from '../src/main/lantern';
import type { PrFileDiff } from '../src/main/lantern-prdiff';
import { parseDiffRows } from '../src/renderer/lib/codeview';
import { guideBar, guideOf, selectRows } from '../src/renderer/lib/lanternguide';
import { createGuideView } from '../src/renderer/lib/lanternguideview';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,12 +1,12 @@
 one
 two
 three
-four
+FOUR
 five
 six
 seven
 eight
 nine
-ten
+TEN
 eleven
 twelve
`;

const GUIDE: LanternGuide = {
  summary: 'Two edits in one file.',
  risk: { level: 'low', why: 'Renames only.' },
  steps: [
    { title: 'First edit', why: 'The upper case four.', careful: true, hunks: [{ path: 'src/a.ts', side: 'new', start: 4, end: 4 }], pseudo: ['four becomes FOUR'] },
    { title: 'Second edit', why: 'The upper case ten.', careful: false, hunks: [{ path: 'src/a.ts', side: 'old', start: 10 }] },
  ],
};

const FILES = [{ path: 'src/a.ts', kind: 'modified' as const, mapped: true, reason: 'Edits.' }];
const mounted: ReturnType<typeof mountLanternView>[] = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const readDiff = async (): Promise<PrFileDiff> => ({ ok: true, diff: DIFF, truncated: false, binary: false });
const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

describe('selectRows', () => {
  const rows = parseDiffRows(DIFF);
  const text = (picked: ReturnType<typeof selectRows>) => picked.filter((row) => row.type !== 'hunk').map((row) => `${row.type}:${row.code}`);

  it('keeps every row for a whole-file reference', () => {
    expect(selectRows(rows, [{ path: 'src/a.ts' }])).toHaveLength(rows.length);
  });

  it('keeps one change with two lines of context for a new-side range', () => {
    expect(text(selectRows(rows, [{ path: 'src/a.ts', side: 'new', start: 4, end: 4 }]))).toEqual(['ctx:two', 'ctx:three', 'del:four', 'add:FOUR', 'ctx:five', 'ctx:six']);
  });

  it('matches a deletion by its old-side range and leaves the other change out', () => {
    const picked = text(selectRows(rows, [{ path: 'src/a.ts', side: 'old', start: 9, end: 11 }]));
    expect(picked).toContain('del:ten');
    expect(picked).not.toContain('del:four');
  });

  it('separates two changes of one step with a gap row', () => {
    const picked = selectRows(rows, [{ path: 'src/a.ts', side: 'new', start: 4, end: 4 }, { path: 'src/a.ts', side: 'new', start: 10, end: 10 }]);
    expect(picked.filter((row) => row.type === 'hunk').length).toBeGreaterThan(1);
  });

  it('selects nothing for a range no change touches', () => {
    expect(selectRows(rows, [{ path: 'src/a.ts', side: 'new', start: 20, end: 25 }])).toEqual([]);
  });
});

describe('the Guide switch of a record', () => {
  it('offers nothing without a guide and a disabled switch carrying the error for a broken one', () => {
    expect(guideBar(pr('1', { files: FILES }), false)).toBeNull();
    expect(guideBar(pr('1', { files: FILES, guideError: 'step 2 has no why' }), false)).toEqual({ on: false, reason: 'The guide in this record could not be read: step 2 has no why' });
    expect(guideBar(pr('1', { files: FILES, guide: GUIDE }), true)).toEqual({ on: true, reason: '' });
    expect(guideOf(pr('1', { files: FILES }))).toBeNull();
  });
});

describe('the guide view', () => {
  function mountGuide() {
    const opened: string[] = [];
    const view = createGuideView({ readDiff, open: (path) => opened.push(path) });
    document.body.append(view.el);
    view.show(pr('1', { files: FILES, guide: GUIDE }));
    return { view, opened };
  }

  it('draws the summary, the risk, a rail with a checkbox per step and only each step\'s own rows', async () => {
    const { view } = mountGuide();
    await flush();
    await flush();
    expect(view.el.querySelector('.lt-guide-summary')?.textContent).toBe('Two edits in one file.');
    expect(view.el.querySelector('.lt-guide-level')?.textContent).toBe('Low risk');
    expect(view.rail.querySelectorAll('.lt-guide-rail-item input[type="checkbox"]')).toHaveLength(2);
    expect(view.el.querySelector('.lt-guide-step[data-step="0"] .cl.add .code')?.textContent).toBe('FOUR');
    expect(view.el.querySelector('.lt-guide-step[data-step="0"]')?.textContent).not.toContain('TEN');
  });

  it('opens careful steps, collapses skim ones until clicked, and loads a skim diff on first expansion', async () => {
    const { view } = mountGuide();
    await flush();
    const skim = view.el.querySelector<HTMLElement>('.lt-guide-step[data-step="1"]') as HTMLElement;
    expect(view.el.querySelector<HTMLElement>('.lt-guide-step[data-step="0"]')?.dataset.open).toBe('true');
    expect(skim.dataset.open).toBe('false');
    expect(skim.querySelector('.cl')).toBeNull();
    skim.querySelector<HTMLButtonElement>('.lt-guide-fold')?.click();
    await flush();
    await flush();
    expect(skim.dataset.open).toBe('true');
    expect(skim.querySelector('.cl.del .code')?.textContent).toBe('ten');
  });

  it('moves the current step with J and K, stops at the ends and ignores typing in a field', () => {
    const { view } = mountGuide();
    const field = document.body.appendChild(document.createElement('input'));
    const handled: boolean[] = [];
    document.addEventListener('keydown', (ev) => { handled.push(view.handleKey(ev)); });
    const current = () => view.el.querySelector('.lt-guide-step[aria-current="step"]')?.getAttribute('data-step');
    expect(current()).toBe('0');
    key(document.body, 'j');
    expect(current()).toBe('1');
    key(document.body, 'j');
    expect(current()).toBe('1');
    key(document.body, 'K');
    expect(current()).toBe('0');
    key(field, 'j');
    expect(current()).toBe('0');
    expect(handled).toEqual([true, true, true, false]);
  });

  it('toggles the pseudocode, ticks steps for the session and opens a file from its name', async () => {
    const { view, opened } = mountGuide();
    await flush();
    await flush();
    const pseudo = view.el.querySelector<HTMLElement>('.lt-guide-pseudo') as HTMLElement;
    expect(pseudo.hidden).toBe(true);
    view.el.querySelector<HTMLButtonElement>('.lt-guide-pseudo-toggle')?.click();
    expect(pseudo.hidden).toBe(false);
    expect(pseudo.textContent).toBe('four becomes FOUR');
    view.el.querySelector<HTMLButtonElement>('.lt-guide-pseudo-toggle')?.click();
    expect(pseudo.hidden).toBe(true);
    const check = view.rail.querySelector<HTMLInputElement>('.lt-guide-rail-item[data-step="0"] input') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change', { bubbles: true }));
    expect(view.el.querySelector('.lt-guide-step[data-step="0"]')?.getAttribute('data-done')).toBe('true');
    view.el.querySelector<HTMLButtonElement>('[data-guide-open]')?.click();
    expect(opened).toEqual(['src/a.ts']);
  });

  it('keeps ticks and the current step when the same pull request is shown again', () => {
    const { view } = mountGuide();
    view.move(1);
    const check = view.rail.querySelector<HTMLInputElement>('.lt-guide-rail-item[data-step="1"] input') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change', { bubbles: true }));
    view.show(pr('1', { files: FILES, guide: { ...GUIDE } }));
    expect(view.el.querySelector('.lt-guide-step[aria-current="step"]')?.getAttribute('data-step')).toBe('1');
    expect(view.rail.querySelector<HTMLInputElement>('.lt-guide-rail-item[data-step="1"] input')?.checked).toBe(true);
  });
});

describe('the review screen with a guide', () => {
  const NODES = [node('src/a.ts', 'service')];
  function mount(extra: Parameters<typeof pr>[1]) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const view = mountLanternView(root, mapOf({ nodes: NODES, prs: [pr('7', { files: FILES, ...extra })] }), { pr: '7', readPrDiff: readDiff });
    mounted.push(view);
    return root;
  }
  const button = (root: HTMLElement, which: string) => root.querySelector<HTMLButtonElement>(`.lt-viewbar [data-view="${which}"]`);

  it('opens on the guide, switches to Files and back, and takes J and K from the keyboard', async () => {
    const root = mount({ guide: GUIDE });
    expect(button(root, 'guide')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector<HTMLElement>('.lt-guide')?.hidden).toBe(false);
    key(root, 'j');
    expect(root.querySelector('.lt-guide-step[aria-current="step"]')?.getAttribute('data-step')).toBe('1');
    button(root, 'files')?.click();
    expect(root.querySelector<HTMLElement>('.lt-guide')?.hidden).toBe(true);
    expect(button(root, 'files')?.getAttribute('aria-pressed')).toBe('true');
    key(root, 'k');
    expect(root.querySelector('.lt-guide-step[aria-current="step"]')?.getAttribute('data-step')).toBe('1');
    button(root, 'guide')?.click();
    expect(root.querySelector<HTMLElement>('.lt-guide')?.hidden).toBe(false);
  });

  it('puts the step rail in the left pane in place of the file list, and a file name in a step opens Files on that file', async () => {
    const root = mount({ guide: GUIDE });
    expect(root.querySelector('.lt-side .lt-guide-rail')).not.toBeNull();
    expect(root.querySelector('.lt-side .pr-file')).toBeNull();
    expect(root.querySelector('.lt-grid')?.classList.contains('lt-guide-wide')).toBe(true);
    root.querySelector<HTMLButtonElement>('.lt-guide-go[data-guide-go="1"]')?.click();
    expect(root.querySelector('.lt-guide-step[aria-current="step"]')?.getAttribute('data-step')).toBe('1');
    await flush();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-guide-open]')?.click();
    expect(button(root, 'files')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.lt-grid')?.classList.contains('lt-guide-wide')).toBe(false);
    expect(root.querySelector('.lt-side .pr-file')).not.toBeNull();
    expect(root.querySelector('.lt-side .lt-guide-rail')).toBeNull();
  });

  it('opens a pull request without a guide in Files with no Guide switch', () => {
    const root = mount({});
    expect(button(root, 'guide')).toBeNull();
    expect(root.querySelector<HTMLElement>('.lt-guide')?.hidden).toBe(true);
  });

  it('shows a disabled Guide switch with the error as its title for a guide that could not be read', () => {
    const root = mount({ guideError: 'step 1 has no why' });
    const guide = button(root, 'guide');
    expect(guide?.disabled).toBe(true);
    expect(guide?.getAttribute('data-tip')).toBe('The guide in this record could not be read: step 1 has no why');
    expect(root.querySelector<HTMLElement>('.lt-guide')?.hidden).toBe(true);
  });
});
