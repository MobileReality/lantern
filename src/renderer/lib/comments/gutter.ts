import { el } from '../util';
import { lineOf, lineRows, rowOfNode, spanBetween } from './rows';
import type { LineRow, LineSpan } from './rows';

interface GutterOptions {
  body: HTMLElement;
  onPreview(span: LineSpan | null): void;
  onComment(span: LineSpan): void;
}

interface Gutter {
  ensure(): void;
  focusLine(line: number): void;
  dispose(): void;
}

const PRIMARY_BUTTON = 0;

function createGutter(options: GutterOptions): Gutter {
  const { body } = options;
  const add = el('button', 'lt-cm-add');
  add.type = 'button';
  add.tabIndex = 0;
  let row: HTMLElement | null = null;
  let anchor: number | null = null;
  let drag: { from: number } | null = null;

  const currentLine = () => (row ? lineOf(row) : null);

  function place(next: HTMLElement | undefined) {
    const line = next ? lineOf(next) : null;
    if (!next || line === null) return;
    row = next;
    next.querySelectorAll('.ln')[1]?.append(add);
    add.setAttribute('aria-label', `Comment on line ${line}`);
  }

  function move(delta: number): number | undefined {
    const rows: LineRow[] = lineRows(body);
    const at = rows.findIndex((each) => each.row === row);
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + delta))];
    if (!next) return undefined;
    place(next.row);
    add.focus({ preventScroll: true });
    next.row.scrollIntoView?.({ block: 'nearest' });
    return next.line;
  }

  function extend(delta: number, keepAnchor: boolean) {
    const from = currentLine();
    const to = move(delta);
    if (from === null || to === undefined) return;
    anchor = keepAnchor ? (anchor ?? from) : null;
    options.onPreview(anchor === null ? null : spanBetween(anchor, to));
    if (anchor !== null) add.setAttribute('aria-label', `Comment on lines ${Math.min(anchor, to)} to ${Math.max(anchor, to)}`);
  }

  function lineUnder(target: EventTarget | null) {
    const hit = rowOfNode(target as Node | null);
    return hit ? lineOf(hit) : null;
  }

  function onOver(ev: PointerEvent) {
    const hit = rowOfNode(ev.target as Node | null);
    if (drag || !hit || hit === row) return;
    const held = document.activeElement === add;
    place(hit);
    if (anchor !== null) {
      anchor = null;
      options.onPreview(null);
    }
    if (held) add.focus({ preventScroll: true });
  }

  function onMove(ev: PointerEvent) {
    const line = drag ? lineUnder(ev.target) : null;
    if (drag && line !== null) options.onPreview(spanBetween(drag.from, line));
  }

  function stopDrag() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', stopDrag);
    drag = null;
  }

  function onUp(ev: PointerEvent) {
    const from = drag?.from;
    const line = lineUnder(ev.target) ?? from;
    stopDrag();
    if (from !== undefined && line !== undefined && line !== null) options.onComment(spanBetween(from, line));
  }

  function onDown(ev: PointerEvent) {
    const from = currentLine();
    if (ev.button !== PRIMARY_BUTTON || from === null) return;
    ev.preventDefault();
    drag = { from };
    options.onPreview({ start: from, end: from });
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', stopDrag);
  }

  function onClick(ev: MouseEvent) {
    const line = currentLine();
    if (ev.detail > 0 || line === null) return;
    const span = anchor === null ? { start: line, end: line } : spanBetween(anchor, line);
    anchor = null;
    options.onComment(span);
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      extend(ev.key === 'ArrowDown' ? 1 : -1, ev.shiftKey);
    } else if (ev.key === 'Escape' && anchor !== null) {
      ev.preventDefault();
      ev.stopPropagation();
      anchor = null;
      options.onPreview(null);
    }
  }

  body.addEventListener('pointerover', onOver);
  add.addEventListener('pointerdown', onDown);
  add.addEventListener('click', onClick);
  add.addEventListener('keydown', onKey);

  return {
    ensure() {
      if (!add.isConnected || !body.contains(add)) place(lineRows(body)[0]?.row);
    },
    focusLine(line) {
      const rows = lineRows(body);
      place((rows.find((each) => each.line === line) ?? rows[0])?.row);
      add.focus({ preventScroll: true });
    },
    dispose() {
      stopDrag();
      body.removeEventListener('pointerover', onOver);
      add.remove();
    },
  };
}

export { createGutter };
export type { Gutter, GutterOptions };
