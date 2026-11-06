// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeRow } from '../src/renderer/lib/codeview';
import { createGutter } from '../src/renderer/lib/comments/gutter';
import { diffBody, fileBody } from './helpers/comment-body';

afterEach(() => document.body.replaceChildren());

function mounted(body: HTMLElement) {
  const onPreview = vi.fn();
  const onComment = vi.fn();
  const gutter = createGutter({ body, onPreview, onComment });
  gutter.ensure();
  return { gutter, onPreview, onComment };
}

const row = (body: HTMLElement, line: number) => [...body.querySelectorAll<HTMLElement>('.cl.ctx, .cl.add')].find((each) => each.querySelectorAll('.ln')[1].textContent === String(line)) as HTMLElement;
const add = (body: HTMLElement) => body.querySelector('.lt-cm-add') as HTMLButtonElement;
const pointer = (target: Element, type: string, init: MouseEventInit = {}) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

describe('the gutter plus button', () => {
  it('sits in the line number column of the first line and is a labelled button', () => {
    const body = fileBody(['a', 'b', 'c']);

    mounted(body);

    expect(add(body).parentElement).toBe(row(body, 1).querySelectorAll('.ln')[1]);
    expect(add(body).getAttribute('aria-label')).toBe('Comment on line 1');
    expect(add(body).textContent).toBe('');
  });

  it('follows the pointer to the line it hovers', () => {
    const body = fileBody(['a', 'b', 'c']);
    mounted(body);

    pointer(row(body, 3).querySelector('.code') as Element, 'pointerover');

    expect(add(body).parentElement).toBe(row(body, 3).querySelectorAll('.ln')[1]);
    expect(add(body).getAttribute('aria-label')).toBe('Comment on line 3');
  });

  it('follows the pointer even while it holds the keyboard focus, and keeps the focus', () => {
    const body = fileBody(['a', 'b', 'c']);
    mounted(body);
    add(body).focus();

    pointer(row(body, 3).querySelector('.code') as Element, 'pointerover');

    expect(add(body).getAttribute('aria-label')).toBe('Comment on line 3');
    expect(document.activeElement).toBe(add(body));
  });

  it('comments on one line when pressed and released on it', () => {
    const body = fileBody(['a', 'b', 'c']);
    const { onComment } = mounted(body);
    pointer(row(body, 2).querySelector('.code') as Element, 'pointerover');

    pointer(add(body), 'pointerdown');
    pointer(add(body), 'pointerup');

    expect(onComment).toHaveBeenCalledWith({ start: 2, end: 2 });
  });

  it('selects a range by dragging over the plus signs and previews it on the way', () => {
    const body = fileBody(['a', 'b', 'c', 'd']);
    const { onComment, onPreview } = mounted(body);
    pointer(row(body, 2).querySelector('.code') as Element, 'pointerover');

    pointer(add(body), 'pointerdown');
    pointer(row(body, 3), 'pointermove');
    pointer(row(body, 4).querySelector('.code') as Element, 'pointermove');
    pointer(row(body, 4), 'pointerup');

    expect(onPreview).toHaveBeenCalledWith({ start: 2, end: 2 });
    expect(onPreview).toHaveBeenCalledWith({ start: 2, end: 3 });
    expect(onPreview).toHaveBeenLastCalledWith({ start: 2, end: 4 });
    expect(onComment).toHaveBeenCalledWith({ start: 2, end: 4 });
  });

  it('selects a range dragged upwards in order', () => {
    const body = fileBody(['a', 'b', 'c', 'd']);
    const { onComment } = mounted(body);
    pointer(row(body, 4).querySelector('.code') as Element, 'pointerover');

    pointer(add(body), 'pointerdown');
    pointer(row(body, 2), 'pointerup');

    expect(onComment).toHaveBeenCalledWith({ start: 2, end: 4 });
  });

  it('ignores a pointer move once the drag ended, and a press with another button', () => {
    const body = fileBody(['a', 'b', 'c']);
    const { onComment, onPreview } = mounted(body);

    pointer(add(body), 'pointerdown', { button: 2 });
    pointer(row(body, 2), 'pointermove');
    pointer(add(body), 'pointerdown');
    pointer(row(body, 1), 'pointerup');
    onPreview.mockClear();
    pointer(row(body, 3), 'pointermove');

    expect(onPreview).not.toHaveBeenCalled();
    expect(onComment).toHaveBeenCalledTimes(1);
  });

  it('opens from the keyboard: Enter on the button comments on its line', () => {
    const body = fileBody(['a', 'b', 'c']);
    const { onComment } = mounted(body);

    add(body).click();

    expect(onComment).toHaveBeenCalledWith({ start: 1, end: 1 });
  });

  it('moves with the arrow keys and extends a range with Shift', () => {
    const body = fileBody(['a', 'b', 'c', 'd']);
    const { onComment, onPreview } = mounted(body);
    add(body).focus();

    key(add(body), { key: 'ArrowDown' });
    expect(add(body).getAttribute('aria-label')).toBe('Comment on line 2');
    key(add(body), { key: 'ArrowDown', shiftKey: true });
    key(add(body), { key: 'ArrowDown', shiftKey: true });

    expect(onPreview).toHaveBeenLastCalledWith({ start: 2, end: 4 });
    expect(add(body).getAttribute('aria-label')).toBe('Comment on lines 2 to 4');
    expect(document.activeElement).toBe(add(body));
    add(body).click();
    expect(onComment).toHaveBeenCalledWith({ start: 2, end: 4 });
  });

  it('drops a keyboard range on Escape', () => {
    const body = fileBody(['a', 'b', 'c']);
    const { onComment, onPreview } = mounted(body);
    key(add(body), { key: 'ArrowDown', shiftKey: true });

    key(add(body), { key: 'Escape' });
    add(body).click();

    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onComment).toHaveBeenCalledWith({ start: 2, end: 2 });
  });

  it('skips removed lines in a diff and stays on the last numbered line at the end', () => {
    const body = diffBody();
    mounted(body);

    for (let i = 0; i < 6; i += 1) key(add(body), { key: 'ArrowDown' });

    expect(add(body).getAttribute('aria-label')).toBe('Comment on line 4');
  });

  it('comes back to the first line after the body was painted again, and can be sent to a line', () => {
    const body = fileBody(['a', 'b', 'c']);
    const { gutter } = mounted(body);
    body.replaceChildren(...['a', 'b', 'c'].map((text, index) => codeRow('ctx', null, index + 1, text)));
    expect(add(body)).toBeNull();

    gutter.ensure();
    expect(add(body).getAttribute('aria-label')).toBe('Comment on line 1');
    gutter.focusLine(3);

    expect(add(body).getAttribute('aria-label')).toBe('Comment on line 3');
    expect(document.activeElement).toBe(add(body));
  });
});
