// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { lineRows, selectionAnchor, spanBetween, spanOfSelection, textOfLines } from '../src/renderer/lib/comments/rows';
import { diffBody, fileBody, select } from './helpers/comment-body';

afterEach(() => {
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

describe('the numbered rows of a code or diff body', () => {
  it('lists file rows by line number', () => {
    const body = fileBody(['a', 'b', 'c']);

    expect(lineRows(body).map((row) => row.line)).toEqual([1, 2, 3]);
  });

  it('numbers diff rows by new-file line and leaves out removed lines, hunk headers and fold bars', () => {
    const body = diffBody();
    const fold = document.createElement('div');
    fold.className = 'cl fold';
    fold.innerHTML = '<span class="ln"></span><span class="ln">9</span><span class="code">fold</span>';
    body.append(fold);

    expect(lineRows(body).map((row) => row.line)).toEqual([1, 2, 3, 4]);
  });

  it('is empty without a body', () => {
    expect(lineRows(null)).toEqual([]);
  });
});

describe('the lines a selection covers', () => {
  it('maps a selection over several rows to its first and last line', () => {
    const body = fileBody(['a', 'b', 'c', 'd']);
    select(body, 2, 3);

    expect(spanOfSelection(body)).toEqual({ start: 2, end: 3 });
  });

  it('maps a selection in a diff by new-file numbers, skipping the removed line between', () => {
    const body = diffBody();
    select(body, 1, 3);

    expect(spanOfSelection(body)).toEqual({ start: 1, end: 3 });
  });

  it('is null for a collapsed selection or one outside the body', () => {
    const body = fileBody(['a', 'b']);
    const other = fileBody(['x', 'y']);
    select(other, 1, 2);

    expect(spanOfSelection(body)).toBeNull();
    document.getSelection()?.removeAllRanges();
    expect(spanOfSelection(body)).toBeNull();
  });

  it('does not count a row the selection only touches at its start', () => {
    const body = fileBody(['a', 'b', 'c']);
    const codes = [...body.querySelectorAll<HTMLElement>('.code')];
    document.getSelection()?.setBaseAndExtent(codes[0], 0, codes[1], 0);

    expect(spanOfSelection(body)).toEqual({ start: 1, end: 1 });
  });

  it('gives the rectangle of the last selected line for the floating button', () => {
    const body = fileBody(['a', 'b', 'c']);
    select(body, 1, 2);

    const anchor = selectionAnchor(body);

    expect(anchor?.span).toEqual({ start: 1, end: 2 });
    expect(anchor?.rect).toBeDefined();
  });
});

describe('quoting and ordering', () => {
  it('quotes the visible lines of a span with trailing blanks trimmed', () => {
    const body = fileBody(['alpha  ', 'beta', 'gamma']);

    expect(textOfLines(body, { start: 1, end: 2 })).toBe('alpha\nbeta');
  });

  it('orders two lines into a span either way round', () => {
    expect(spanBetween(5, 2)).toEqual({ start: 2, end: 5 });
    expect(spanBetween(2, 5)).toEqual({ start: 2, end: 5 });
  });
});
