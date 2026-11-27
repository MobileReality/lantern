// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternFlowStory, LanternGuide } from '../src/main/lantern';
import type { PrFileDiff } from '../src/main/lantern-prdiff';
import { guideErrorOf, guideStops, markRows, noteOf, stopAt } from '../src/renderer/lib/lanternguide';
import { createGuidePane } from '../src/renderer/lib/lanternguideview';
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
  summary: 'Two edits in one file, then a second file.',
  risk: { level: 'low', why: 'Renames only.' },
  steps: [
    { title: 'Start in b', why: 'The contract lives here.', careful: true, hunks: [{ path: 'src/b.ts' }], pseudo: ['b says hello'] },
    { title: 'Upper case four', why: 'The upper case four.', careful: true, hunks: [{ path: 'src/a.ts', side: 'new', start: 4, end: 4 }] },
    { title: 'Upper case ten', why: 'The upper case ten.', careful: false, hunks: [{ path: 'src/a.ts', side: 'old', start: 10 }] },
  ],
};

const FILES = [
  { path: 'src/a.ts', kind: 'modified' as const, mapped: true, reason: 'Edits.' },
  { path: 'src/b.ts', kind: 'added' as const, mapped: true, reason: 'New.' },
  { path: 'src/c.ts', kind: 'modified' as const, mapped: true, reason: 'Left out of the guide.' },
];
const NODES = ['src/a.ts', 'src/b.ts', 'src/c.ts'].map((path) => node(path, 'service'));
const STORY: LanternFlowStory = { title: 'Alice edits', steps: [{ kind: 'actor', text: 'Alice', files: ['src/a.ts'] }, { kind: 'action', text: 'edits' }, { kind: 'subject', text: 'the file' }], below: [] };

const mounted: ReturnType<typeof mountLanternView>[] = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const readDiff = async (_pr: string, path: string): Promise<PrFileDiff> => ({ ok: true, diff: path === 'src/a.ts' ? DIFF : `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false });
const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

describe('guideStops', () => {
  it('walks the files of the steps in order, a file once per step, then the files no step names', () => {
    const stops = guideStops(GUIDE, FILES);
    expect(stops).toEqual([
      { path: 'src/b.ts', step: 0 },
      { path: 'src/a.ts', step: 1 },
      { path: 'src/a.ts', step: 2 },
      { path: 'src/c.ts', step: -1 },
    ]);
  });

  it('leaves out a path of a step that the pull request does not change', () => {
    const guide: LanternGuide = { ...GUIDE, steps: [{ ...GUIDE.steps[0], hunks: [{ path: 'src/b.ts' }, { path: 'src/gone.ts' }] }] };
    expect(guideStops(guide, FILES).map((stop) => stop.path)).toEqual(['src/b.ts', 'src/a.ts', 'src/c.ts']);
  });

  it('keeps the current stop while the file is the same and otherwise takes the first stop of the file', () => {
    const stops = guideStops(GUIDE, FILES);
    expect(stopAt(stops, 'src/a.ts', 2)).toBe(2);
    expect(stopAt(stops, 'src/a.ts', 0)).toBe(1);
    expect(stopAt(stops, 'src/missing.ts', 0)).toBe(-1);
    expect(stopAt(stops, null, 1)).toBe(-1);
  });

  it('describes the step a stop belongs to with the ranges the step names in that file', () => {
    const [, second] = guideStops(GUIDE, FILES);
    expect(noteOf(GUIDE, second)).toEqual({ at: 1, count: 3, title: 'Upper case four', why: 'The upper case four.', careful: true, refs: [{ path: 'src/a.ts', side: 'new', start: 4, end: 4 }] });
    expect(noteOf(GUIDE, { path: 'src/c.ts', step: -1 })).toBeUndefined();
  });

  it('reports the error of a guide that could not be read and nothing for a readable one', () => {
    expect(guideErrorOf(pr('1', { files: FILES }))).toBe('');
    expect(guideErrorOf(pr('1', { files: FILES, guideError: 'step 2 has no why' }))).toBe('The guide in this record could not be read: step 2 has no why');
    expect(guideErrorOf(pr('1', { files: FILES, guide: GUIDE, guideError: 'ignored' }))).toBe('');
  });
});

describe('markRows', () => {
  function rows() {
    const root = document.createElement('div');
    root.innerHTML = [
      ['ctx', '3', '3', 'three'],
      ['del', '4', '', 'four'],
      ['add', '', '4', 'FOUR'],
      ['del', '10', '', 'ten'],
      ['add', '', '10', 'TEN'],
    ].map(([type, old, next, code]) => `<div class="cl ${type}"><span class="ln">${old}</span><span class="ln">${next}</span><span class="code">${code}</span></div>`).join('');
    return root;
  }
  const marked = (root: HTMLElement) => [...root.querySelectorAll('.cl.guide-hit .code')].map((code) => code.textContent);

  it('marks the added rows a new-side range covers and the removed rows an old-side range covers', () => {
    const root = rows();
    markRows(root, [{ path: 'a', side: 'new', start: 4, end: 4 }, { path: 'a', side: 'old', start: 9, end: 11 }]);
    expect(marked(root)).toEqual(['FOUR', 'ten']);
  });

  it('marks nothing for a whole-file reference and clears the marks of an earlier step', () => {
    const root = rows();
    markRows(root, [{ path: 'a', side: 'new', start: 4 }]);
    expect(marked(root)).toEqual(['FOUR']);
    expect(markRows(root, [{ path: 'a' }])).toEqual([]);
    expect(marked(root)).toEqual([]);
  });
});

describe('the guide pane', () => {
  function mountPane() {
    const opened: [string, number][] = [];
    const pane = createGuidePane({ open: (path, step) => opened.push([path, step]) });
    document.body.append(pane.el);
    const record = pr('1', { files: FILES, guide: GUIDE });
    const state = (at: number, marked?: ReadonlySet<string>) => ({ stops: guideStops(GUIDE, FILES), at, marked });
    pane.show(record, state(-1));
    return { pane, opened, record, state };
  }
  const item = (pane: HTMLElement, path: string, step: number) => pane.querySelector<HTMLElement>(`[data-group="${step}"] .lt-guide-file[data-path="${path}"]`) as HTMLElement;

  it('draws the summary, the risk, a tick and the files for every step and the files no step names', () => {
    const { pane } = mountPane();
    expect(pane.el.querySelector('.lt-guide-summary')?.textContent).toBe('Two edits in one file, then a second file.');
    expect(pane.el.querySelector('.lt-guide-level')?.textContent).toBe('Low risk');
    expect([...pane.el.querySelectorAll('.lt-guide-title')].map((title) => title.textContent)).toEqual(['Start in b', 'Upper case four', 'Upper case ten']);
    expect(pane.el.querySelectorAll('.lt-guide-check')).toHaveLength(3);
    expect(item(pane.el, 'src/a.ts', 1)).not.toBeNull();
    expect(item(pane.el, 'src/a.ts', 2)).not.toBeNull();
    expect(item(pane.el, 'src/c.ts', -1)).not.toBeNull();
    expect(pane.el.querySelector('.pr-file')).toBeNull();
  });

  it('opens careful steps and collapses skim ones until clicked, keeping the files of a collapsed step visible', () => {
    const { pane } = mountPane();
    const skim = pane.el.querySelector<HTMLElement>('.lt-guide-step[data-step="2"]') as HTMLElement;
    expect(pane.el.querySelector<HTMLElement>('.lt-guide-step[data-step="0"]')?.dataset.open).toBe('true');
    expect(skim.dataset.open).toBe('false');
    expect(skim.querySelector<HTMLElement>('.lt-guide-step-body')?.hidden).toBe(true);
    expect(skim.querySelector('.lt-guide-file')).not.toBeNull();
    skim.querySelector<HTMLButtonElement>('.lt-guide-fold')?.click();
    expect(skim.dataset.open).toBe('true');
    expect(skim.querySelector<HTMLElement>('.lt-guide-step-body')?.hidden).toBe(false);
  });

  it('highlights the current file under its own step only, and marks the same file elsewhere and the files of a flow step', () => {
    const { pane, record, state } = mountPane();
    pane.show(record, state(1, new Set(['src/c.ts'])));
    expect(item(pane.el, 'src/a.ts', 1).dataset.current).toBe('true');
    expect(item(pane.el, 'src/a.ts', 1).querySelector('.lt-guide-file-name')?.getAttribute('aria-current')).toBe('true');
    expect(item(pane.el, 'src/a.ts', 2).dataset.current).toBe('false');
    expect(item(pane.el, 'src/a.ts', 2).dataset.same).toBe('true');
    expect(item(pane.el, 'src/c.ts', -1).dataset.flow).toBe('true');
    expect(pane.el.querySelector('.lt-guide-step[data-step="1"]')?.getAttribute('aria-current')).toBe('step');
    pane.show(record, state(3));
    expect(pane.el.querySelector('.lt-guide-step[aria-current="step"]')).toBeNull();
    expect(item(pane.el, 'src/c.ts', -1).dataset.current).toBe('true');
  });

  it('toggles the pseudocode of a step, ticks steps and tells which file of which step was picked', () => {
    const { pane, opened } = mountPane();
    const pseudo = pane.el.querySelector<HTMLElement>('.lt-guide-pseudo') as HTMLElement;
    expect(pseudo.hidden).toBe(true);
    pane.el.querySelector<HTMLButtonElement>('.lt-guide-pseudo-toggle')?.click();
    expect(pseudo.hidden).toBe(false);
    expect(pseudo.textContent).toBe('b says hello');
    pane.el.querySelector<HTMLButtonElement>('.lt-guide-pseudo-toggle')?.click();
    expect(pseudo.hidden).toBe(true);
    expect(pane.el.querySelectorAll('.lt-guide-pseudo-toggle')).toHaveLength(1);
    const check = pane.el.querySelector<HTMLInputElement>('.lt-guide-step[data-step="0"] .lt-guide-check') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change', { bubbles: true }));
    expect(pane.el.querySelector('.lt-guide-step[data-step="0"]')?.getAttribute('data-done')).toBe('true');
    item(pane.el, 'src/a.ts', 2).querySelector<HTMLButtonElement>('.lt-guide-file-name')?.click();
    expect(opened).toEqual([['src/a.ts', 2]]);
  });

  it('keeps the ticks when the same pull request is shown again', () => {
    const { pane, record, state } = mountPane();
    const check = pane.el.querySelector<HTMLInputElement>('.lt-guide-step[data-step="1"] .lt-guide-check') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change', { bubbles: true }));
    pane.show({ ...record, guide: { ...GUIDE } }, state(0));
    expect(pane.el.querySelector<HTMLInputElement>('.lt-guide-step[data-step="1"] .lt-guide-check')?.checked).toBe(true);
  });
});

describe('the review screen with a guide', () => {
  function mount(extra: Parameters<typeof pr>[1]) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const view = mountLanternView(root, mapOf({ nodes: NODES, prs: [pr('7', { files: FILES, ordered: true, ...extra })] }), { pr: '7', readPrDiff: readDiff, readPrFile: async () => ({ ok: true, text: 'x\n', truncated: false, binary: false, version: 'branch' }) });
    mounted.push(view);
    return root;
  }
  const button = (root: HTMLElement, which: string) => root.querySelector<HTMLButtonElement>(`.lt-viewbar [data-view="${which}"]`);
  const reviewed = (root: HTMLElement) => root.querySelector('.lt-review .lt-code-path')?.textContent ?? '';
  const open = async (root: HTMLElement, path: string, step: number) => {
    root.querySelector<HTMLElement>(`[data-group="${step}"] .lt-guide-file[data-path="${path}"] .lt-guide-file-name`)?.click();
    await flush();
    await flush();
  };

  it('has no Guide button in the view strip and puts the steps in the left pane in place of the file list', () => {
    const root = mount({ guide: GUIDE, flow: [STORY] });
    expect(button(root, 'guide')).toBeNull();
    expect(button(root, 'files')).not.toBeNull();
    expect(button(root, 'flow')).not.toBeNull();
    expect(root.querySelector('.lt-side .lt-guide-pane')).not.toBeNull();
    expect(root.querySelector('.lt-side .pr-file')).toBeNull();
    expect(root.querySelector('.lt-guide')).toBeNull();
  });

  it('opens a file of a step in the middle with that step\'s title and why, and highlights it in the left pane', async () => {
    const root = mount({ guide: GUIDE });
    await open(root, 'src/a.ts', 2);
    expect(reviewed(root)).toContain('a.ts');
    expect(root.querySelector('.lt-review .lt-guide-note-title')?.textContent).toBe('Upper case ten');
    expect(root.querySelector('.lt-review .lt-guide-note-label')?.textContent).toContain('Step 3 of 3');
    expect(root.querySelector('.lt-guide-file[data-current="true"]')?.getAttribute('data-path')).toBe('src/a.ts');
    expect(root.querySelector('.lt-guide-step[aria-current="step"]')?.getAttribute('data-step')).toBe('2');
    expect(root.querySelector('.lt-review .cl.del.guide-hit .code')?.textContent).toBe('ten');
    expect(root.querySelector('.lt-review .cl.add.guide-hit')).toBeNull();
  });

  it('walks the files in guide order across steps with the arrow keys, and past the last step into the unlisted files', async () => {
    const root = mount({ guide: GUIDE });
    await open(root, 'src/b.ts', 0);
    expect(reviewed(root)).toContain('b.ts');
    const review = root.querySelector('.lt-review') as HTMLElement;
    key(review, 'ArrowRight');
    await flush();
    await flush();
    expect(reviewed(root)).toContain('a.ts');
    expect(root.querySelector('.lt-review .lt-guide-note-title')?.textContent).toBe('Upper case four');
    expect(root.querySelector('.lt-review .cl.add.guide-hit .code')?.textContent).toBe('FOUR');
    key(review, 'ArrowRight');
    await flush();
    expect(root.querySelector('.lt-review .lt-guide-note-title')?.textContent).toBe('Upper case ten');
    expect(root.querySelector('.lt-review .cl.add.guide-hit')).toBeNull();
    key(review, 'ArrowRight');
    await flush();
    await flush();
    expect(reviewed(root)).toContain('c.ts');
    expect(root.querySelector('.lt-review .lt-guide-note')).toBeNull();
    key(review, 'ArrowLeft');
    await flush();
    expect(reviewed(root)).toContain('a.ts');
    expect(root.querySelector('.lt-review .lt-step-count')?.textContent).toBe('3 / 4');
  });

  it('keeps the guide in the left pane while Flow is open and opens a file from it there', async () => {
    const root = mount({ guide: GUIDE, flow: [STORY] });
    button(root, 'flow')?.click();
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(false);
    expect(root.querySelector('.lt-side .lt-guide-pane')).not.toBeNull();
    await open(root, 'src/b.ts', 0);
    expect(reviewed(root)).toContain('b.ts');
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(false);
    button(root, 'files')?.click();
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(true);
    expect(root.querySelector('.lt-side .lt-guide-pane')).not.toBeNull();
  });

  it('opens a pull request without a guide exactly as before, with the file list and no guide pane', () => {
    const root = mount({});
    expect(root.querySelector('.lt-side .pr-file')).not.toBeNull();
    expect(root.querySelector('.lt-side .lt-guide-pane')).toBeNull();
    expect(button(root, 'guide')).toBeNull();
  });

  const toggle = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.pr-head .pr-head-toggle') as HTMLButtonElement;
  const more = (root: HTMLElement) => root.querySelector<HTMLElement>('.pr-head .pr-head-more') as HTMLElement;

  it('collapses the overview card to its bar when the record has a guide, and opens it on the toggle', () => {
    const root = mount({ guide: GUIDE, summary: 'Why this exists.' });
    expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
    expect(more(root).hidden).toBe(true);
    expect(root.querySelector('.pr-head .pr-head-bar .pr-title')).not.toBeNull();
    expect(root.querySelector('.pr-head .pr-head-bar .pr-open-link')).not.toBeNull();
    toggle(root).click();
    expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
    expect(more(root).hidden).toBe(false);
    expect(more(root).textContent).toContain('Why this exists.');
    toggle(root).click();
    expect(more(root).hidden).toBe(true);
    expect(root.querySelector('.lt-side .lt-guide-pane')).not.toBeNull();
  });

  it('keeps the overview card open without a guide, and lets it be closed', () => {
    const root = mount({ summary: 'Why this exists.' });
    expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
    expect(more(root).hidden).toBe(false);
    toggle(root).click();
    expect(more(root).hidden).toBe(true);
  });

  it('leaves the reason out of the middle pane when the step note explains the file, and keeps it for a file no step names', async () => {
    const root = mount({ guide: GUIDE });
    await open(root, 'src/a.ts', 1);
    expect(root.querySelector('.lt-review .lt-guide-note')).not.toBeNull();
    expect(root.querySelector('.lt-review .lt-modal-reason')).toBeNull();
    const review = root.querySelector('.lt-review') as HTMLElement;
    key(review, 'ArrowRight');
    key(review, 'ArrowRight');
    await flush();
    await flush();
    expect(reviewed(root)).toContain('c.ts');
    expect(root.querySelector('.lt-review .lt-guide-note')).toBeNull();
    expect(root.querySelector('.lt-review .lt-modal-reason')?.textContent).toContain('Left out of the guide.');
  });

  it('says in the left pane that the guide could not be read, with the reason, and keeps the file list', () => {
    const root = mount({ guideError: 'step 1 has no why' });
    expect(root.querySelector('.lt-side .pr-guide-error')?.textContent).toBe('The guide in this record could not be read: step 1 has no why');
    expect(root.querySelector('.lt-side .pr-file')).not.toBeNull();
    expect(button(root, 'guide')).toBeNull();
  });
});
