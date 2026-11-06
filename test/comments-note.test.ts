// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FixItem } from '../src/renderer/lib/fixrequests/model';
import { createViewNote, noteText } from '../src/renderer/lib/comments/note';

const ITEM: FixItem = { id: 'a', path: 'f.ts', start: 40, end: 41, code: 'x', comment: 'Far away.' };

describe('the note about comments that are not in this view', () => {
  it('counts them and offers the other view', () => {
    const onShow = vi.fn();
    const note = createViewNote(onShow);

    const el = note.paint([ITEM, { ...ITEM, id: 'b' }], 'file') as HTMLElement;

    expect(el.querySelector('.lt-cm-note-text')?.textContent).toBe('2 comments not shown in this view');
    const show = el.querySelector('.lt-cm-note-show') as HTMLButtonElement;
    expect(show.textContent).toBe('Show in File');
    show.click();
    expect(onShow).toHaveBeenCalledWith('file', ITEM);
  });

  it('is absent when everything is shown, and has no button when there is no other view', () => {
    const note = createViewNote(vi.fn());

    expect(note.paint([], 'diff')).toBeNull();
    const el = note.paint([ITEM], null) as HTMLElement;
    expect((el.querySelector('.lt-cm-note-show') as HTMLElement).hidden).toBe(true);
    expect(noteText(1)).toBe('1 comment not shown in this view');
  });
});
