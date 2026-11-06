// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSelectionButton } from '../src/renderer/lib/comments/float';
import { fileBody, select } from './helpers/comment-body';

afterEach(() => {
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

function mounted(enabled = true) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const body = fileBody(['a', 'b', 'c', 'd']);
  host.append(body);
  const onComment = vi.fn();
  const state = { enabled };
  const float = createSelectionButton({ host, body: () => body, enabled: () => state.enabled, onComment });
  host.append(float.el);
  return { host, body, float, onComment, state };
}

describe('the floating Comment button', () => {
  it('is hidden until some lines are selected, then appears when the mouse is released', () => {
    const { host, body, float } = mounted();
    expect(float.el.hidden).toBe(true);

    select(body, 2, 3);
    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(float.el.hidden).toBe(false);
    expect(float.el.textContent).toBe('Comment');
  });

  it('hides when the selection is cleared', () => {
    const { host, body, float } = mounted();
    select(body, 1, 2);
    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));

    expect(float.el.hidden).toBe(true);
  });

  it('opens a comment on the selected lines when clicked, and clears the selection', () => {
    const { host, body, float, onComment } = mounted();
    select(body, 2, 4);
    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    float.el.click();

    expect(onComment).toHaveBeenCalledWith({ start: 2, end: 4 });
    expect(float.el.hidden).toBe(true);
    expect(document.getSelection()?.isCollapsed).toBe(true);
  });

  it('keeps the selection when the button is pressed', () => {
    const { float } = mounted();
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    float.el.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });

  it('shows after a keyboard selection and comments with Alt+Shift+C', () => {
    const { host, body, float, onComment } = mounted();
    select(body, 1, 2);
    host.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    expect(float.el.hidden).toBe(false);

    const shortcut = new KeyboardEvent('keydown', { key: 'C', code: 'KeyC', altKey: true, shiftKey: true, bubbles: true, cancelable: true });
    host.dispatchEvent(shortcut);

    expect(onComment).toHaveBeenCalledWith({ start: 1, end: 2 });
    expect(shortcut.defaultPrevented).toBe(true);
  });

  it('does nothing while a comment box is open', () => {
    const { host, body, float, state, onComment } = mounted();
    state.enabled = false;
    select(body, 1, 2);

    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(float.el.hidden).toBe(true);
    expect(float.comment()).toBe(false);
    expect(onComment).not.toHaveBeenCalled();
  });

  it('describes itself to keyboard and screen reader users', () => {
    const { float } = mounted();

    expect(float.el.getAttribute('aria-keyshortcuts')).toBe('Alt+Shift+C');
    expect(float.el.getAttribute('aria-label')).toBe('Comment on the selected lines');
  });
});
