// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseItems } from '../src/renderer/lib/fixrequests/model';
import { browserFixBackend, createFixStore, memoryFixBackend, storageKey } from '../src/renderer/lib/fixrequests/store';

afterEach(() => localStorage.clear());

let seq = 0;
const ids = () => `id-${++seq}`;

describe('the fix request store', () => {
  it('adds a whole-file item and a fragment item, each with its own id', () => {
    const store = createFixStore(memoryFixBackend(), ids);
    const file = store.add({ path: 'src/a.ts', comment: 'Fix this.' });
    const lines = store.add({ path: 'src/a.ts', start: 3, end: 5, code: 'x\ny\nz', preset: 'test', comment: 'Add a test for this.' });

    expect(file).toEqual({ id: file.id, path: 'src/a.ts', comment: 'Fix this.' });
    expect(lines).toEqual({ id: lines.id, path: 'src/a.ts', start: 3, end: 5, code: 'x\ny\nz', preset: 'test', comment: 'Add a test for this.' });
    expect(file.id).not.toBe(lines.id);
    expect(store.items().map((item) => item.id)).toEqual([file.id, lines.id]);
  });

  it('swaps a range given backwards and drops code from an item that has no range', () => {
    const store = createFixStore(memoryFixBackend(), ids);
    const backwards = store.add({ path: 'a.ts', start: 9, end: 4, code: 'c', comment: 'c' });
    const stray = store.add({ path: 'a.ts', code: 'orphan', comment: 'c' });

    expect([backwards.start, backwards.end]).toEqual([4, 9]);
    expect(stray).not.toHaveProperty('code');
  });

  it('edits the comment and the range of an item and leaves the others alone', () => {
    const store = createFixStore(memoryFixBackend(), ids);
    const first = store.add({ path: 'a.ts', start: 1, end: 2, code: 'old', comment: 'one' });
    const second = store.add({ path: 'b.ts', comment: 'two' });

    const edited = store.update(first.id, { comment: 'one, reworded', start: 2, end: 6, code: 'new' });

    expect(edited).toMatchObject({ id: first.id, path: 'a.ts', start: 2, end: 6, code: 'new', comment: 'one, reworded' });
    expect(store.items()).toEqual([edited, second]);
    expect(store.update('missing', { comment: 'x' })).toBeNull();
  });

  it('removes one item and clears them all', () => {
    const store = createFixStore(memoryFixBackend(), ids);
    const first = store.add({ path: 'a.ts', comment: 'one' });
    const second = store.add({ path: 'b.ts', comment: 'two' });

    expect(store.remove(first.id)).toBe(true);
    expect(store.remove(first.id)).toBe(false);
    expect(store.items()).toEqual([second]);
    store.clear();
    expect(store.items()).toEqual([]);
  });

  it('tells a listener about every change until it unsubscribes', () => {
    const store = createFixStore(memoryFixBackend(), ids);
    const seen = vi.fn();
    const stop = store.onChange(seen);

    const item = store.add({ path: 'a.ts', comment: 'one' });
    store.update(item.id, { comment: 'two' });
    store.remove(item.id);
    stop();
    store.add({ path: 'b.ts', comment: 'three' });

    expect(seen).toHaveBeenCalledTimes(3);
  });
});

describe('what survives a restart', () => {
  it('reads back, from the same project and pull request, what an earlier store saved', () => {
    const before = createFixStore(browserFixBackend('/work/app', '7'), ids);
    const kept = before.add({ path: 'src/a.ts', start: 2, end: 3, code: 'a\nb', preset: 'fix', comment: 'Fix this.' });
    before.add({ path: 'src/b.ts', comment: 'Rename.' });

    const after = createFixStore(browserFixBackend('/work/app', '7'), ids);

    expect(after.items()).toHaveLength(2);
    expect(after.items()[0]).toEqual(kept);
  });

  it('keeps one list per project and per pull request', () => {
    createFixStore(browserFixBackend('/work/app', '7'), ids).add({ path: 'a.ts', comment: 'seven' });
    createFixStore(browserFixBackend('/work/app', '8'), ids).add({ path: 'a.ts', comment: 'eight' });
    createFixStore(browserFixBackend('/work/other', '7'), ids).add({ path: 'a.ts', comment: 'other' });

    expect(createFixStore(browserFixBackend('/work/app', '7'), ids).items().map((item) => item.comment)).toEqual(['seven']);
    expect(createFixStore(browserFixBackend('/work/app', '8'), ids).items().map((item) => item.comment)).toEqual(['eight']);
    expect(createFixStore(browserFixBackend('/work/other', '7'), ids).items().map((item) => item.comment)).toEqual(['other']);
  });

  it('forgets the saved entry once the last item is removed', () => {
    const store = createFixStore(browserFixBackend('/work/app', '7'), ids);
    const item = store.add({ path: 'a.ts', comment: 'one' });
    expect(localStorage.getItem(storageKey('/work/app', '7'))).not.toBeNull();

    store.remove(item.id);

    expect(localStorage.getItem(storageKey('/work/app', '7'))).toBeNull();
  });

  it('starts empty, without throwing, when the saved text is damaged or storage is unavailable', () => {
    localStorage.setItem(storageKey('/work/app', '7'), '{not json');
    expect(createFixStore(browserFixBackend('/work/app', '7'), ids).items()).toEqual([]);

    const broken = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(createFixStore(browserFixBackend('/work/app', '7'), ids).items()).toEqual([]);
    broken.mockRestore();
  });

  it('drops saved entries that are not well formed and keeps the good ones', () => {
    const raw = JSON.stringify([
      { id: 'a', path: 'a.ts', comment: 'ok' },
      { id: 'a', path: 'dup.ts', comment: 'duplicate id' },
      { id: 'b', path: '', comment: 'no path' },
      { id: 'c', path: 'c.ts' },
      { id: 'd', path: 'd.ts', start: 0, end: 3, code: 'x', comment: 'bad range' },
      { id: 'e', path: 'e.ts', start: 8, end: 2, code: 'x', comment: 'backwards' },
      'nope',
    ]);

    expect(parseItems(raw)).toEqual([
      { id: 'a', path: 'a.ts', comment: 'ok' },
      { id: 'd', path: 'd.ts', comment: 'bad range' },
      { id: 'e', path: 'e.ts', start: 2, end: 8, code: 'x', comment: 'backwards' },
    ]);
    expect(parseItems(null)).toEqual([]);
    expect(parseItems('{"a":1}')).toEqual([]);
  });
});

describe('the intent of a saved comment', () => {
  it('reads a comment saved before intents existed as one without an intent of its own', () => {
    const old = JSON.stringify([{ id: 'a', path: 'a.ts', start: 1, end: 2, code: 'x', preset: 'fix', comment: 'Fix this.' }]);

    const [item] = parseItems(old);

    expect(item).toEqual({ id: 'a', path: 'a.ts', start: 1, end: 2, code: 'x', preset: 'fix', comment: 'Fix this.' });
    expect(item).not.toHaveProperty('intent');
  });

  it('keeps a known intent and drops one it does not know', () => {
    const raw = JSON.stringify([
      { id: 'a', path: 'a.ts', comment: 'q', intent: 'question' },
      { id: 'b', path: 'b.ts', comment: 'e', intent: 'explain' },
      { id: 'c', path: 'c.ts', comment: 'later', intent: 'review-later' },
      { id: 'd', path: 'd.ts', comment: 'odd', intent: 3 },
    ]);

    expect(parseItems(raw).map((item) => item.intent)).toEqual(['question', 'explain', undefined, undefined]);
  });

  it('stores an intent with the comment, changes it on edit and reads it back after a restart', () => {
    const store = createFixStore(browserFixBackend('/work/app', '7'), ids);
    const item = store.add({ path: 'a.ts', comment: 'Why?', intent: 'question' });
    store.update(item.id, { intent: 'explain' });

    const after = createFixStore(browserFixBackend('/work/app', '7'), ids);

    expect(after.items()).toEqual([{ id: item.id, path: 'a.ts', comment: 'Why?', intent: 'explain' }]);
  });

  it('forgets an intent that an edit takes away', () => {
    const store = createFixStore(browserFixBackend('/work/app', '7'), ids);
    const item = store.add({ path: 'a.ts', comment: 'Why?', intent: 'question' });

    store.update(item.id, { intent: undefined });

    expect(createFixStore(browserFixBackend('/work/app', '7'), ids).items()[0]).not.toHaveProperty('intent');
  });
});
