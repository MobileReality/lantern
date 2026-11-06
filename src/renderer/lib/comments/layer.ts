import { hasRange } from '../fixrequests/model';
import type { FixItem } from '../fixrequests/model';
import { lineRows } from './rows';
import type { LineRow, LineSpan } from './rows';

interface BoxPlacement {
  el: HTMLElement;
  line: number;
  replaces?: string;
}

interface LayerView {
  items(): FixItem[];
  card(item: FixItem): HTMLElement;
  highlight(): LineSpan | null;
  box(): BoxPlacement | null;
  note(hidden: FixItem[]): HTMLElement | null;
  synced(): void;
}

interface CommentLayer {
  sync(): void;
  paintHighlight(): void;
  rowOf(line: number): HTMLElement | null;
  isShown(id: string): boolean;
  hasLine(line: number): boolean;
  loaded(): boolean;
  dispose(): void;
}

const OWN_CLASS = 'lt-cm-';
const OBSERVE = { childList: true, subtree: true } as const;

function isOwn(node: Node) {
  return node instanceof Element && [...node.classList].some((name) => name.startsWith(OWN_CLASS));
}

function touchesCode(record: MutationRecord) {
  if (record.target instanceof Element && record.target.closest(`[class*="${OWN_CLASS}"]`)) return false;
  return [...record.addedNodes, ...record.removedNodes].some((node) => !isOwn(node));
}

function visibleRows(rows: LineRow[], item: FixItem) {
  if (!hasRange(item)) return [];
  return rows.filter((each) => each.line >= item.start && each.line <= item.end);
}

function createCommentLayer(body: HTMLElement, view: LayerView): CommentLayer {
  let placed = new Set<HTMLElement>();
  let note: HTMLElement | null = null;
  let rows: LineRow[] = [];
  let shown = new Set<string>();

  function paintHighlight() {
    const live = view.highlight();
    for (const each of rows) each.row.classList.toggle('lt-cm-live', !!live && each.line >= live.start && each.line <= live.end);
  }

  function settle(anchors: Map<HTMLElement, HTMLElement[]>) {
    const next = new Set<HTMLElement>();
    for (const [row, nodes] of anchors) {
      let prev: Element = row;
      for (const node of nodes) {
        if (prev.nextElementSibling !== node) prev.after(node);
        prev = node;
        next.add(node);
      }
    }
    for (const node of placed) if (!next.has(node)) node.remove();
    placed = next;
  }

  function sync() {
    rows = lineRows(body);
    const anchors = new Map<HTMLElement, HTMLElement[]>();
    const marked = new Set<HTMLElement>();
    const hidden: FixItem[] = [];
    const place = view.box();
    shown = new Set();
    for (const item of view.items()) {
      const visible = visibleRows(rows, item);
      if (!visible.length) {
        if (rows.length) hidden.push(item);
        continue;
      }
      for (const each of visible) marked.add(each.row);
      const anchor = visible[visible.length - 1].row;
      anchors.set(anchor, [...(anchors.get(anchor) ?? []), place?.replaces === item.id ? place.el : view.card(item)]);
      shown.add(item.id);
    }
    const target = place && !place.replaces ? rows.find((each) => each.line === place.line) : undefined;
    if (place && target) anchors.set(target.row, [...(anchors.get(target.row) ?? []), place.el]);
    settle(anchors);
    for (const each of rows) each.row.classList.toggle('lt-cm-mark', marked.has(each.row));
    paintHighlight();
    const next = view.note(hidden);
    if (note && note !== next) note.remove();
    note = next;
    if (note && body.firstElementChild !== note) body.prepend(note);
    view.synced();
  }

  const observer = new MutationObserver((records) => {
    if (records.some(touchesCode)) sync();
  });
  observer.observe(body, OBSERVE);
  sync();

  return {
    sync,
    paintHighlight,
    rowOf: (line) => rows.find((each) => each.line === line)?.row ?? null,
    isShown: (id) => shown.has(id),
    hasLine: (line) => rows.some((each) => each.line === line),
    loaded: () => rows.length > 0,
    dispose() {
      observer.disconnect();
      for (const node of placed) node.remove();
      note?.remove();
    },
  };
}

function reconcile(parent: HTMLElement, nodes: readonly HTMLElement[]) {
  nodes.forEach((node, index) => {
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null);
  });
  while (parent.children.length > nodes.length) parent.lastElementChild?.remove();
}

export { createCommentLayer, reconcile };
export type { BoxPlacement, CommentLayer, LayerView };
