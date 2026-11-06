// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopyChoice } from '../src/renderer/lib/fixrequests/intent';
import type { FixItem } from '../src/renderer/lib/fixrequests/model';
import { createCommentTools } from '../src/renderer/lib/comments/tools';

const ITEMS: FixItem[] = [
  { id: '1', path: 'src/repo.ts', comment: 'Repo note.' },
  { id: '2', path: 'src/svc.ts', start: 2, end: 3, code: 'x', comment: 'Why two passes?' },
  { id: '3', path: 'src/svc.ts', comment: 'Rename the module.' },
];
const ORDER = ['src/svc.ts', 'src/repo.ts'];
const mounted: ReturnType<typeof createCommentTools>[] = [];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  mounted.splice(0).forEach((each) => { each.dispose(); });
  document.body.replaceChildren();
});

function tools(items: FixItem[] = ITEMS, choice: CopyChoice = 'per-comment') {
  const onFile = vi.fn();
  const onCopy = vi.fn();
  const onOpen = vi.fn();
  const onChoice = vi.fn();
  const view = createCommentTools({ onFile, onCopy, onChoice, onOpen });
  mounted.push(view);
  document.body.appendChild(view.el);
  view.paint({ items, order: ORDER, canComment: true, choice });
  return { view, onFile, onCopy, onChoice, onOpen };
}

const button = (root: HTMLElement, tool: string) => root.querySelector(`[data-cm-tool="${tool}"]`) as HTMLButtonElement;
const popover = (root: HTMLElement) => root.querySelector('.lt-cm-pop') as HTMLElement;

describe('the comment tools in the review header', () => {
  it('shows the count on the Comments control and labels it', () => {
    const { view } = tools();

    expect(view.el.querySelector('.lt-cm-count')?.textContent).toBe('3');
    expect(button(view.el, 'list').getAttribute('aria-label')).toBe('Comments, 3 comments');
    view.paint({ items: ITEMS.slice(0, 1), order: ORDER, canComment: true });
    expect(button(view.el, 'list').getAttribute('aria-label')).toBe('Comments, 1 comment');
  });

  it('comments on the whole file from the header button', () => {
    const { view, onFile } = tools();

    button(view.el, 'file').click();

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(button(view.el, 'file').getAttribute('aria-label')).toBe('Comment on this file');
  });

  it('asks to copy everything, and is disabled while there is nothing to copy', () => {
    const { view, onCopy } = tools();
    button(view.el, 'copy').click();
    expect(onCopy).toHaveBeenCalledTimes(1);

    view.paint({ items: [], order: ORDER, canComment: true });
    expect(button(view.el, 'copy').disabled).toBe(true);
  });

  it('says Copied for a moment after a copy and Copy all again afterwards', () => {
    const { view } = tools();

    view.copied(true);
    expect(button(view.el, 'copy').textContent).toBe('Copied');
    vi.advanceTimersByTime(2000);

    expect(button(view.el, 'copy').textContent).toBe('Copy all');
  });

  it('announces a failed copy', () => {
    const { view } = tools();

    view.copied(false);

    expect(view.el.querySelector('[role="status"]')?.textContent).toBe('The comments could not be copied.');
  });

  it('opens a list grouped by file in review order, with the lines of each comment', () => {
    const { view } = tools();

    button(view.el, 'list').click();

    expect(popover(view.el).hidden).toBe(false);
    expect(button(view.el, 'list').getAttribute('aria-expanded')).toBe('true');
    expect([...popover(view.el).querySelectorAll('.lt-cm-pop-path')].map((each) => each.textContent)).toEqual(['src/svc.ts', 'src/repo.ts']);
    expect([...popover(view.el).querySelectorAll('.lt-cm-pop-item')].map((each) => each.textContent)).toEqual(['FileRename the module.', 'Lines 2–3Why two passes?', 'FileRepo note.']);
    expect(document.activeElement).toBe(popover(view.el).querySelector('.lt-cm-pop-item'));
  });

  it('opens the clicked comment and closes the list', () => {
    const { view, onOpen } = tools();
    button(view.el, 'list').click();

    (popover(view.el).querySelector('[data-cm-id="2"]') as HTMLElement).click();

    expect(onOpen).toHaveBeenCalledWith(ITEMS[1]);
    expect(popover(view.el).hidden).toBe(true);
  });

  it('closes on Escape and gives the focus back to the control', () => {
    const { view } = tools();
    button(view.el, 'list').click();

    popover(view.el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(popover(view.el).hidden).toBe(true);
    expect(document.activeElement).toBe(button(view.el, 'list'));
  });

  it('closes when the pointer goes down elsewhere', () => {
    const { view } = tools();
    button(view.el, 'list').click();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(popover(view.el).hidden).toBe(true);
  });

  it('says what to do when there are no comments', () => {
    const { view } = tools([]);

    button(view.el, 'list').click();

    expect(popover(view.el).textContent).toContain('No comments yet');
    expect(document.activeElement).toBe(popover(view.el));
  });

  it('disables the file button when no file is open', () => {
    const { view } = tools();

    view.paint({ items: ITEMS, order: ORDER, canComment: false, choice: 'per-comment' });

    expect(button(view.el, 'file').disabled).toBe(true);
  });
});

describe('the default intent of Copy all', () => {
  const select = (root: HTMLElement) => root.querySelector('select.lt-cm-choice') as HTMLSelectElement;

  it('sits after Copy all, labelled, with per comment and one entry per intent', () => {
    const { view } = tools();

    expect(button(view.el, 'copy').nextElementSibling).toBe(select(view.el));
    expect(select(view.el).getAttribute('aria-label')).toBe('Copy all, default intent');
    expect([...select(view.el).options].map((each) => each.value)).toEqual(['per-comment', 'fix', 'explain', 'question']);
  });

  it('shows the choice it is painted with and tells the owner about a change', () => {
    const { view, onChoice } = tools(ITEMS, 'explain');
    expect(select(view.el).value).toBe('explain');

    select(view.el).value = 'question';
    select(view.el).dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChoice).toHaveBeenCalledWith('question');
  });

  it('stays usable before there is a comment to copy', () => {
    const { view } = tools([]);

    expect(button(view.el, 'copy').disabled).toBe(true);
    expect(select(view.el).disabled).toBe(false);
  });
});
