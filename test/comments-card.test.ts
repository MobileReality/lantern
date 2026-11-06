// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCardPool, whereLabel } from '../src/renderer/lib/comments/card';
import type { FixItem } from '../src/renderer/lib/fixrequests/model';

afterEach(() => document.body.replaceChildren());

const RANGE: FixItem = { id: 'a', path: 'src/svc.ts', start: 2, end: 4, code: 'x', comment: 'Why two passes?' };
const WHOLE: FixItem = { id: 'b', path: 'src/svc.ts', comment: 'Rename the module.' };

function pool() {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const collapsed = new Set<string>();
  return { cards: createCardPool({ onEdit, onDelete }, collapsed), onEdit, onDelete, collapsed };
}

describe('the compact comment card', () => {
  it('names the lines and shows the comment text', () => {
    const { cards } = pool();

    const card = cards.card(RANGE);

    expect(card.querySelector('.lt-cm-where')?.textContent).toBe('Lines 2–4');
    expect(card.querySelector('.lt-cm-card-text')?.textContent).toBe('Why two passes?');
    expect(card.getAttribute('aria-label')).toBe('Comment on lines 2–4');
  });

  it('shows a quiet label for the intent it has, none for a comment without one, and follows an edit', () => {
    const { cards } = pool();

    expect(cards.card(RANGE).querySelector('.lt-cm-tag')).toBeNull();
    const asked = cards.card({ ...RANGE, intent: 'question' });
    expect(asked.querySelector('.lt-cm-tag')?.textContent).toBe('Question');
    expect(cards.card({ ...RANGE, intent: 'explain' }).querySelector('.lt-cm-tag')?.textContent).toBe('Explain');
    expect(cards.card({ ...RANGE, intent: 'fix' }).querySelector('.lt-cm-tag')?.textContent).toBe('Fix');
    expect(cards.card(RANGE).querySelector('.lt-cm-tag')).toBeNull();
  });

  it('names a single line, and a whole file', () => {
    expect(whereLabel({ ...RANGE, start: 7, end: 7 })).toBe('Line 7');
    expect(whereLabel(WHOLE)).toBe('File');
  });

  it('reports the item on Edit and on Delete, with labels that tell the cards apart', () => {
    const { cards, onEdit, onDelete } = pool();
    const card = cards.card(RANGE);
    const edit = card.querySelector('.lt-cm-card-edit') as HTMLElement;
    const remove = card.querySelector('.lt-cm-card-delete') as HTMLElement;

    edit.click();
    remove.click();

    expect(onEdit).toHaveBeenCalledWith(RANGE);
    expect(onDelete).toHaveBeenCalledWith(RANGE);
    expect(edit.getAttribute('aria-label')).toBe('Edit the comment on lines 2–4');
    expect(remove.getAttribute('aria-label')).toBe('Delete the comment on lines 2–4');
  });

  it('collapses and expands in place, remembering it for the next paint', () => {
    const { cards, collapsed } = pool();
    const card = cards.card(RANGE);
    const fold = card.querySelector('.lt-cm-fold') as HTMLElement;
    expect(fold.getAttribute('aria-expanded')).toBe('true');

    fold.click();

    expect(card.classList.contains('lt-cm-collapsed')).toBe(true);
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(card.querySelector('.lt-cm-card-text')?.getAttribute('data-tip')).toBe('Why two passes?');
    expect(collapsed.has('a')).toBe(true);
    expect(cards.card(RANGE)).toBe(card);
    expect(card.classList.contains('lt-cm-collapsed')).toBe(true);
    fold.click();
    expect(card.classList.contains('lt-cm-collapsed')).toBe(false);
    expect(card.querySelector('.lt-cm-card-text')?.hasAttribute('data-tip')).toBe(false);
  });

  it('keeps the same element for the same comment and rewrites its text after an edit', () => {
    const { cards } = pool();
    const card = cards.card(RANGE);
    const edit = card.querySelector('.lt-cm-card-edit');

    expect(cards.card(RANGE)).toBe(card);
    expect(card.querySelector('.lt-cm-card-edit')).toBe(edit);
    expect(cards.card({ ...RANGE, comment: 'Reworded.' })).toBe(card);
    expect(card.querySelector('.lt-cm-card-text')?.textContent).toBe('Reworded.');
  });

  it('finds the Edit button of a card by id, and forgets cards of removed comments', () => {
    const { cards } = pool();
    const card = cards.card(RANGE);

    expect(cards.edit('a')).toBe(card.querySelector('.lt-cm-card-edit'));
    cards.keep(new Set());
    expect(cards.edit('a')).toBeNull();
  });
});
