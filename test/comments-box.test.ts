// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommentBox, insertText } from '../src/renderer/lib/comments/box';
import { fixPresets } from '../src/shared/lang/fix-requests';

afterEach(() => document.body.replaceChildren());

function opened(spec: Partial<Parameters<ReturnType<typeof createCommentBox>['open']>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const box = createCommentBox({ onSave, onCancel });
  document.body.appendChild(box.el);
  box.open({ heading: 'Comment on lines 2-3', submit: 'Save', comment: '', preset: '', presets: fixPresets('en'), ...spec });
  const text = box.el.querySelector('textarea') as HTMLTextAreaElement;
  return { box, text, onSave, onCancel };
}

const key = (target: HTMLElement, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const chip = (box: HTMLElement, id: string) => box.querySelector(`.lt-cm-chip[data-preset="${id}"]`) as HTMLButtonElement;

describe('the inline comment box', () => {
  it('opens under a heading with a chip per predefined text of the shown intent and a comment field', () => {
    const { box } = opened();

    expect(box.el.hidden).toBe(false);
    expect(box.el.querySelector('.lt-cm-box-title')?.textContent).toBe('Comment on lines 2-3');
    expect([...box.el.querySelectorAll('.lt-cm-chip')].map((each) => each.textContent)).toEqual(['Fix this.', 'Add a test for this.', 'Rename this.', 'Simplify this.', 'Remove this.']);
    expect(box.el.querySelector('select')).toBeNull();
  });

  it('inserts a chip text into the comment and keeps it editable', () => {
    const { text, box } = opened();

    chip(box.el, 'simplify').click();

    expect(text.value).toBe('Simplify this.');
    text.value = 'Simplify this, it loops twice.';
    expect(text.value).toBe('Simplify this, it loops twice.');
  });

  it('adds a second chip after what is written, separated by a space', () => {
    const { text, box } = opened({ comment: 'Look again.' });

    chip(box.el, 'test').click();

    expect(text.value).toBe('Look again. Add a test for this.');
  });

  it('saves the trimmed comment with the last chip used', () => {
    const { text, box, onSave } = opened();
    chip(box.el, 'rename').click();
    text.value = '  Rename it to total.  ';

    box.el.requestSubmit();

    expect(onSave).toHaveBeenCalledWith({ comment: 'Rename it to total.', preset: 'rename', intent: 'fix' });
  });

  it('saves with Ctrl+Enter or Cmd+Enter from the comment field', () => {
    const { text, onSave } = opened();
    text.value = 'by keyboard';

    key(text, { key: 'Enter', ctrlKey: true });
    key(text, { key: 'Enter', metaKey: true });

    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('does not save on a plain Enter, which stays a new line', () => {
    const { text, onSave } = opened();
    text.value = 'line';

    key(text, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses an empty comment and says why', () => {
    const { box, onSave } = opened();

    box.el.requestSubmit();

    expect(onSave).not.toHaveBeenCalled();
    expect((box.el.querySelector('.lt-cm-error') as HTMLElement).hidden).toBe(false);
    expect(box.el.querySelector('.lt-cm-error')?.getAttribute('role')).toBe('alert');
  });

  it('cancels on Escape without letting the key reach the page', () => {
    const { text, onCancel } = opened();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);

    key(text, { key: 'Escape' });
    document.removeEventListener('keydown', outer);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('cancels from the Cancel button and closes', () => {
    const { box, onCancel } = opened();

    (box.el.querySelector('.lt-cm-btn:not(.lt-cm-primary)') as HTMLElement).click();
    box.close();

    expect(onCancel).toHaveBeenCalled();
    expect(box.isOpen()).toBe(false);
  });

  it('reopens with a saved comment and its chip for editing', () => {
    const { text } = opened({ comment: 'Why two passes?', preset: 'explain', submit: 'Save' });

    expect(text.value).toBe('Why two passes?');
  });

  it('puts the cursor in the comment field on focus and remembers it wanted the focus', () => {
    const { box, text } = opened();

    box.focus();

    expect(document.activeElement).toBe(text);
    expect(box.wantsFocus()).toBe(true);
  });
});

describe('the intent choice in the comment box', () => {
  const radios = (box: HTMLElement) => [...box.querySelectorAll<HTMLInputElement>('.lt-cm-intent input[type="radio"]')];

  it('is one labelled radio group with Fix selected, so the arrow keys move through it', () => {
    const { box } = opened();

    const group = box.el.querySelector('.lt-cm-intent') as HTMLElement;

    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Intent');
    expect(new Set(radios(box.el).map((each) => each.name)).size).toBe(1);
    expect(radios(box.el).map((each) => each.checked)).toEqual([true, false, false]);
  });

  it('gives each box its own group, so two boxes do not steal each other\'s selection', () => {
    const first = opened();
    const second = opened();

    radios(second.box.el)[2].click();

    expect(radios(first.box.el)[0].name).not.toBe(radios(second.box.el)[0].name);
    expect(radios(first.box.el)[0].checked).toBe(true);
  });

  it('saves without an intent when nobody chose one', () => {
    const { text, box, onSave } = opened();
    text.value = 'plain';

    box.el.requestSubmit();

    expect(onSave).toHaveBeenCalledWith({ comment: 'plain', preset: '', intent: undefined });
  });

  it('saves the intent that was clicked, even Fix', () => {
    const { text, box, onSave } = opened();
    text.value = 'why?';
    radios(box.el)[2].click();
    box.el.requestSubmit();
    expect(onSave).toHaveBeenLastCalledWith({ comment: 'why?', preset: '', intent: 'question' });

    radios(box.el)[0].click();
    box.el.requestSubmit();
    expect(onSave).toHaveBeenLastCalledWith({ comment: 'why?', preset: '', intent: 'fix' });
  });

  it('opens with the intent of the comment being edited and offers only its texts', () => {
    const { text, box, onSave } = opened({ comment: 'why?', intent: 'question' });
    expect(radios(box.el).map((each) => each.checked)).toEqual([false, false, true]);
    expect([...box.el.querySelectorAll<HTMLElement>('.lt-cm-chip')].map((each) => each.dataset.preset)).toEqual(['why', 'covered']);

    chip(box.el, 'covered').click();
    text.value = 'why?';
    box.el.requestSubmit();

    expect(onSave).toHaveBeenCalledWith({ comment: 'why?', preset: 'covered', intent: 'question' });
  });

  it('swaps the texts when another intent is chosen', () => {
    const { box } = opened();

    radios(box.el)[1].click();

    expect([...box.el.querySelectorAll<HTMLElement>('.lt-cm-chip')].map((each) => each.dataset.preset)).toEqual(['explain', 'what']);
  });

  it('shows the save shortcut as key chips', () => {
    const { box } = opened();

    expect(box.el.querySelectorAll('.lt-cm-hint .lt-key').length).toBe(2);
    expect(box.el.querySelector('.lt-cm-hint')?.textContent).toMatch(/to save$/);
  });

  it('shows the intent the copy will follow for a comment without one, and still saves it unset', () => {
    const { text, box, onSave } = opened({ fallback: 'question' });
    expect(radios(box.el).map((each) => each.checked)).toEqual([false, false, true]);
    text.value = 'why?';

    box.el.requestSubmit();

    expect(onSave).toHaveBeenCalledWith({ comment: 'why?', preset: '', intent: undefined });
  });

  it('starts from Fix again each time it opens', () => {
    const { box } = opened();
    radios(box.el)[1].click();

    box.open({ heading: 'again', submit: 'Save', comment: '', preset: '', presets: fixPresets('en') });

    expect(radios(box.el).map((each) => each.checked)).toEqual([true, false, false]);
  });
});

describe('inserting text at the caret', () => {
  it('replaces the selection and moves the caret behind the text', () => {
    expect(insertText('fix X now', 4, 5, 'Y')).toEqual({ value: 'fix Y now', caret: 5 });
  });

  it('starts an empty comment without a leading space', () => {
    expect(insertText('', 0, 0, 'Fix this.')).toEqual({ value: 'Fix this.', caret: 9 });
  });
});
