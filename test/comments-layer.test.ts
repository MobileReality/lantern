// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeRow } from '../src/renderer/lib/codeview';
import { createCommentLayer } from '../src/renderer/lib/comments/layer';
import type { BoxPlacement, LayerView } from '../src/renderer/lib/comments/layer';
import type { LineSpan } from '../src/renderer/lib/comments/rows';
import type { FixItem } from '../src/renderer/lib/fixrequests/model';
import { diffBody, fileBody } from './helpers/comment-body';

afterEach(() => document.body.replaceChildren());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const first: FixItem = { id: 'a', path: 'f.ts', start: 2, end: 3, code: 'b\nc', comment: 'Why two passes?' };
const second: FixItem = { id: 'b', path: 'f.ts', start: 3, end: 3, code: 'c', comment: 'Rename.' };

function makeView(items: FixItem[]) {
  const state: { items: FixItem[]; highlight: LineSpan | null; box: BoxPlacement | null; hidden: FixItem[] } = { items, highlight: null, box: null, hidden: [] };
  const cards = new Map<string, HTMLElement>();
  const view: LayerView = {
    items: () => state.items,
    card(item) {
      let card = cards.get(item.id);
      if (!card) {
        card = document.createElement('article');
        card.className = 'lt-cm-card';
        card.dataset.cmId = item.id;
        cards.set(item.id, card);
      }
      return card;
    },
    highlight: () => state.highlight,
    box: () => state.box,
    note(hidden) {
      state.hidden = hidden;
      if (!hidden.length) return null;
      const note = document.createElement('div');
      note.className = 'lt-cm-note';
      note.textContent = `${hidden.length} not shown`;
      return note;
    },
    synced: vi.fn(),
  };
  return { state, view, cards };
}

const order = (body: HTMLElement) => [...body.children].map((child) => (child.classList.contains('lt-cm-card') ? `card:${(child as HTMLElement).dataset.cmId}` : (child.querySelectorAll('.ln')[1]?.textContent ?? child.className)));

describe('the comment layer over a code body', () => {
  it('puts a card under the last line of its range and marks every line of it', () => {
    const body = fileBody(['a', 'b', 'c', 'd']);
    const { view } = makeView([first]);

    createCommentLayer(body, view);

    expect(order(body)).toEqual(['1', '2', '3', 'card:a', '4']);
    expect([...body.querySelectorAll('.cl.lt-cm-mark')].map((row) => row.querySelectorAll('.ln')[1].textContent)).toEqual(['2', '3']);
  });

  it('stacks cards that end on the same line, in the given order', () => {
    const body = fileBody(['a', 'b', 'c', 'd']);
    const { view } = makeView([first, second]);

    createCommentLayer(body, view);

    expect(order(body)).toEqual(['1', '2', '3', 'card:a', 'card:b', '4']);
  });

  it('highlights the lines of the open selection and clears it again', () => {
    const body = fileBody(['a', 'b', 'c']);
    const { view, state } = makeView([]);
    const layer = createCommentLayer(body, view);

    state.highlight = { start: 1, end: 2 };
    layer.paintHighlight();
    expect(body.querySelectorAll('.cl.lt-cm-live')).toHaveLength(2);

    state.highlight = null;
    layer.paintHighlight();
    expect(body.querySelectorAll('.cl.lt-cm-live')).toHaveLength(0);
  });

  it('puts a new box under the line and under the cards already there, then moves it away when closed', () => {
    const body = fileBody(['a', 'b', 'c', 'd']);
    const { view, state } = makeView([first]);
    const layer = createCommentLayer(body, view);
    const box = document.createElement('form');
    box.className = 'lt-cm-box';

    state.box = { el: box, line: 3 };
    layer.sync();
    expect(order(body)).toEqual(['1', '2', '3', 'card:a', 'lt-cm-box', '4']);

    state.box = null;
    layer.sync();
    expect(box.isConnected).toBe(false);
  });

  it('shows an edit box in the place of the card it edits', () => {
    const body = fileBody(['a', 'b', 'c']);
    const { view, state } = makeView([first]);
    const layer = createCommentLayer(body, view);
    const box = document.createElement('form');
    box.className = 'lt-cm-box';

    state.box = { el: box, line: 3, replaces: 'a' };
    layer.sync();

    expect(order(body)).toEqual(['1', '2', '3', 'lt-cm-box']);
  });

  it('keeps the box element and its focus when it syncs again', () => {
    const body = fileBody(['a', 'b', 'c']);
    const { view, state } = makeView([]);
    const layer = createCommentLayer(body, view);
    const box = document.createElement('form');
    box.className = 'lt-cm-box';
    const text = document.createElement('textarea');
    box.append(text);
    state.box = { el: box, line: 2 };
    layer.sync();
    text.focus();

    layer.sync();

    expect(document.activeElement).toBe(text);
    expect(box.parentElement).toBe(body);
  });

  it('lists comments whose lines are not in this view and says nothing when all are shown', () => {
    const body = diffBody();
    const { view, state } = makeView([{ id: 'far', path: 'f.ts', start: 40, end: 41, code: 'x', comment: 'Far away.' }, { id: 'near', path: 'f.ts', start: 2, end: 3, code: 'x', comment: 'Near.' }]);

    const layer = createCommentLayer(body, view);

    expect(state.hidden.map((item) => item.id)).toEqual(['far']);
    expect(body.firstElementChild?.className).toBe('lt-cm-note');
    expect(layer.isShown('near')).toBe(true);
    expect(layer.isShown('far')).toBe(false);

    state.items = [];
    layer.sync();
    expect(body.querySelector('.lt-cm-note')).toBeNull();
  });

  it('numbers diff cards by new-file line and anchors them under added lines, past the removed one', () => {
    const body = diffBody();
    const { view } = makeView([{ id: 'd', path: 'f.ts', start: 2, end: 3, code: 'x', comment: 'In the diff.' }]);

    createCommentLayer(body, view);

    expect(order(body)).toEqual(['', '1', '', '2', '3', 'card:d', '4']);
  });

  it('puts the cards back after the body is painted again', async () => {
    const body = fileBody(['a', 'b', 'c']);
    const { view, state } = makeView([first]);
    createCommentLayer(body, view);
    const box = document.createElement('form');
    box.className = 'lt-cm-box';
    state.box = { el: box, line: 1 };

    body.textContent = '';
    body.append(...['a', 'b', 'c', 'd'].map((text, index) => codeRow('ctx', null, index + 1, text)));
    await flush();

    expect(order(body)).toEqual(['1', 'lt-cm-box', '2', '3', 'card:a', '4']);
    expect(body.querySelectorAll('.cl.lt-cm-mark')).toHaveLength(2);
  });

  it('says nothing about hidden comments while the body has no lines yet', () => {
    const body = document.createElement('div');
    document.body.appendChild(body);
    const { view, state } = makeView([first]);

    const layer = createCommentLayer(body, view);

    expect(state.hidden).toEqual([]);
    expect(layer.loaded()).toBe(false);
  });

  it('does not sync again when text inside its own elements changes', async () => {
    const body = fileBody(['a', 'b']);
    const { view } = makeView([first]);
    const layer = createCommentLayer(body, view);
    const synced = view.synced as ReturnType<typeof vi.fn>;
    synced.mockClear();

    const note = document.createElement('div');
    note.className = 'lt-cm-note';
    body.prepend(note);
    await flush();
    synced.mockClear();
    note.textContent = 'changed';
    await flush();

    expect(synced).not.toHaveBeenCalled();
    expect(layer.loaded()).toBe(true);
  });

  it('does not sync again for its own changes', async () => {
    const body = fileBody(['a', 'b']);
    const { view } = makeView([first]);
    const layer = createCommentLayer(body, view);
    const synced = view.synced as ReturnType<typeof vi.fn>;
    synced.mockClear();

    layer.sync();
    await flush();

    expect(synced).toHaveBeenCalledTimes(1);
  });
});
