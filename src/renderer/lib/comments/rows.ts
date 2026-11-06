interface LineSpan {
  start: number;
  end: number;
}

interface LineRow {
  line: number;
  row: HTMLElement;
  code: HTMLElement;
}

const NUMBERED_ROW = '.cl.ctx, .cl.add';

function lineRows(body: ParentNode | null): LineRow[] {
  if (!body) return [];
  const rows: LineRow[] = [];
  for (const row of body.querySelectorAll<HTMLElement>(NUMBERED_ROW)) {
    const code = row.querySelector<HTMLElement>('.code');
    const line = Number(row.querySelectorAll('.ln')[1]?.textContent);
    if (code && Number.isInteger(line) && line >= 1) rows.push({ line, row, code });
  }
  return rows;
}

function rowOfNode(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return element?.closest<HTMLElement>(NUMBERED_ROW) ?? null;
}

function lineOf(row: HTMLElement): number | null {
  const line = Number(row.querySelectorAll('.ln')[1]?.textContent);
  return Number.isInteger(line) && line >= 1 ? line : null;
}

function spanBetween(a: number, b: number): LineSpan {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

function overlaps(range: Range, code: HTMLElement) {
  const whole = document.createRange();
  whole.selectNodeContents(code);
  return range.compareBoundaryPoints(Range.START_TO_END, whole) > 0 && range.compareBoundaryPoints(Range.END_TO_START, whole) < 0;
}

function selectedRows(body: HTMLElement | null): { rows: LineRow[]; range: Range } | null {
  const selection = document.getSelection();
  if (!body || !selection || !selection.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!body.contains(range.commonAncestorContainer)) return null;
  const rows = lineRows(body).filter((each) => overlaps(range, each.code));
  return rows.length ? { rows, range } : null;
}

function spanOfSelection(body: HTMLElement | null): LineSpan | null {
  const found = selectedRows(body);
  if (!found) return null;
  const lines = found.rows.map((each) => each.line);
  return { start: Math.min(...lines), end: Math.max(...lines) };
}

function textOfLines(body: ParentNode | null, span: LineSpan) {
  return lineRows(body)
    .filter((each) => each.line >= span.start && each.line <= span.end)
    .map((each) => (each.code.textContent ?? '').replace(/\s+$/, ''))
    .join('\n');
}

function lastClientRect(range: Range): DOMRect | null {
  const rects = typeof range.getClientRects === 'function' ? [...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0) : [];
  return rects[rects.length - 1] ?? null;
}

interface SelectionAnchor {
  span: LineSpan;
  rect: DOMRect;
}

function selectionAnchor(body: HTMLElement | null): SelectionAnchor | null {
  const found = selectedRows(body);
  if (!found) return null;
  const lines = found.rows.map((each) => each.line);
  const last = found.rows.reduce((best, each) => (each.line >= best.line ? each : best));
  return { span: { start: Math.min(...lines), end: Math.max(...lines) }, rect: lastClientRect(found.range) ?? last.code.getBoundingClientRect() };
}

export { lineOf, lineRows, rowOfNode, selectionAnchor, spanBetween, spanOfSelection, textOfLines };
export type { LineRow, LineSpan, SelectionAnchor };
