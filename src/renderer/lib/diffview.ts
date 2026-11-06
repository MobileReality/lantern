import { codeRow, escapeHtml } from './codeview';
import { highlightBatch } from './syntax-client';
import { CODE_HL_MAX_BYTES } from '../../shared/code-preview';
import type { DiffRow } from './codeview';
import type { Scope, Segment } from './diffcollapse';
import { semanticLine } from './semantic-highlight';
import type { SemanticHighlightResult } from '../../shared/code-highlighting';

const REVEAL_STEP = 20;
const REVEAL_ALL_BELOW = REVEAL_STEP * 1.5;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function plural(n: number) {
  return `${n} unchanged line${n === 1 ? '' : 's'}`;
}

interface DiffSemantic {
  old?: SemanticHighlightResult;
  new?: SemanticHighlightResult;
}

async function diffLexicalLines(rows: DiffRow[], lang: string | null) {
  const rendered = new Map<number, string>();
  const sourceBytes = new TextEncoder().encode(rows.map((row) => row.code ?? '').join('\n')).byteLength;
  if (sourceBytes >= CODE_HL_MAX_BYTES) {
    rows.forEach((row, index) => { if (row.type !== 'hunk') rendered.set(index, escapeHtml(row.code ?? '')); });
    return rendered;
  }
  const chunks: number[][] = [];
  let chunk: number[] = [];
  rows.forEach((row, index) => {
    if (row.type === 'hunk') {
      if (chunk.length) chunks.push(chunk);
      chunk = [];
    } else chunk.push(index);
  });
  if (chunk.length) chunks.push(chunk);
  const batches: { indexes: number[]; text: string }[] = [];
  for (const indexes of chunks) {
    const oldIndexes = indexes.filter((index) => rows[index].type !== 'add');
    const newIndexes = indexes.filter((index) => rows[index].type !== 'del');
    batches.push({ indexes: oldIndexes, text: oldIndexes.map((index) => rows[index].code ?? '').join('\n') });
    batches.push({ indexes: newIndexes, text: newIndexes.map((index) => rows[index].code ?? '').join('\n') });
  }
  const highlighted = await highlightBatch(batches.map(({ text }) => ({ text, lang })));
  batches.forEach(({ indexes }, batch) => { indexes.forEach((index, at) => { rendered.set(index, highlighted[batch]?.[at] ?? escapeHtml(rows[index].code ?? '')); }); });
  return rendered;
}

function lineRow(r: DiffRow, lexical: string, semantic?: DiffSemantic, semanticLanguage: string | null = null) {
  const code = r.code || ' ';
  const result = r.type === 'del' ? semantic?.old : semantic?.new;
  const line = r.type === 'del' ? r.oldLn : r.newLn;
  const spans = line == null ? [] : result?.spans.filter((span) => span.line === line - 1) ?? [];
  const html = spans.length ? semanticLine(code, spans, lexical, semanticLanguage) : lexical;
  const row = codeRow(r.type, r.oldLn, r.newLn, html);
  if (r.type === 'add' || r.type === 'del') {
    const label = r.type === 'add' ? 'added' : 'removed';
    row.dataset.tip = label;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
  }
  return row;
}

function hunkRow(r: DiffRow, skipped: number) {
  const row = el('div', 'cl hunk');
  const label = skipped > 0 ? `⋯ ${plural(skipped)}${r.text ? ` · ${r.text}` : ''}` : r.text || '⋯';
  row.append(el('span', 'ln'), el('span', 'ln'), el('span', 'code', label));
  return row;
}

function scopeRow(scope: Scope) {
  const row = el('div', 'cl scope');
  row.dataset.tip = 'Enclosing scope';
  row.append(el('span', 'ln'), el('span', 'ln', scope.line == null ? '' : String(scope.line)), el('span', 'code', scope.text));
  return row;
}

function button(act: string, text: string, label: string, onClick: () => void) {
  const b = el('button', `df-btn df-${act}`, text);
  b.type = 'button';
  b.setAttribute('data-act', act);
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function renderDiff(rows: DiffRow[], lexical: Map<number, string>, segments: Segment[], semantic: DiffSemantic = {}, semanticLanguage: string | null = null): DocumentFragment {
  const frag = document.createDocumentFragment();
  const regionAt: ({ covers(i: number): boolean } | undefined)[] = [];
  const scopes: { row: HTMLElement; index: number }[] = [];
  const isShown = (i: number) => {
    const region = regionAt[i];
    return !region || region.covers(i);
  };
  const refreshScopes = () => {
    for (const s of scopes) s.row.hidden = s.index >= 0 && isShown(s.index);
  };

  function foldRegion(from: number, to: number, fromBottom: boolean, scope: Scope | null) {
    const wrap = el('div', 'df-fold');
    const built = new Map<number, HTMLElement>();
    const size = to - from;
    let revealed = 0;
    const covers = (i: number) => (fromBottom ? i >= to - revealed : i < from + revealed);
    const scopeEl = scope ? scopeRow(scope) : null;
    if (scope && scopeEl) scopes.push({ row: scopeEl, index: scope.index });
    for (let i = from; i < to; i++) regionAt[i] = { covers };

    function revealedRows() {
      const out: HTMLElement[] = [];
      const start = fromBottom ? to - revealed : from;
      for (let i = start; i < start + revealed; i++) {
        let row = built.get(i);
        if (!row) {
          row = lineRow(rows[i], lexical.get(i) ?? escapeHtml(rows[i].code ?? ''), semantic, semanticLanguage);
          built.set(i, row);
        }
        out.push(row);
      }
      return out;
    }

    function bar(): HTMLElement {
      const remaining = size - revealed;
      const row = el('div', 'cl fold');
      const code = el('span', 'code');
      row.append(el('span', 'ln'), el('span', 'ln'), code);
      if (remaining > 0) {
        const more = remaining <= REVEAL_ALL_BELOW ? remaining : REVEAL_STEP;
        const text = revealed > 0 ? `${remaining} more unchanged line${remaining === 1 ? '' : 's'}` : plural(remaining);
        const main = button('more', text, `Show ${more === remaining ? 'all ' : ''}${more} of ${plural(remaining)}`, () => reveal(more, 'more'));
        main.setAttribute('aria-expanded', String(revealed > 0));
        code.append(main);
        if (more < remaining) code.append(button('all', 'Show all', `Show all ${plural(remaining)}`, () => reveal(remaining, 'less')));
      }
      if (revealed > 0) code.append(button('less', remaining > 0 ? 'Collapse' : `Collapse ${plural(revealed)}`, `Collapse ${plural(revealed)}`, () => collapse()));
      return row;
    }

    function paint(focus: string | null) {
      const barEl = bar();
      const lines = revealedRows();
      const kids = fromBottom ? [barEl, ...lines] : [...lines, barEl];
      if (scopeEl) kids.push(scopeEl);
      wrap.replaceChildren(...kids);
      refreshScopes();
      if (focus) ((barEl.querySelector(`[data-act="${focus}"]`) ?? barEl.querySelector('button')) as HTMLElement | null)?.focus();
    }
    function reveal(count: number, focus: string) {
      revealed = Math.min(size, revealed + count);
      paint(size - revealed > 0 ? focus : 'less');
    }
    function collapse() {
      revealed = 0;
      paint('more');
    }
    paint(null);
    return wrap;
  }

  for (const seg of segments) {
    if (seg.kind === 'rows') {
      for (let i = seg.from; i < seg.to; i++) frag.appendChild(lineRow(rows[i], lexical.get(i) ?? escapeHtml(rows[i].code ?? ''), semantic, semanticLanguage));
    } else if (seg.kind === 'hunk') {
      const r = rows[seg.index];
      if (r.text || seg.skipped > 0) frag.appendChild(hunkRow(r, seg.skipped));
    } else {
      frag.appendChild(foldRegion(seg.from, seg.to, seg.edge === 'lead', seg.scope));
    }
  }
  refreshScopes();
  return frag;
}

function applyDiffSemantic(root: HTMLElement, semantic: DiffSemantic, lang: string | null = null) {
  root.querySelectorAll<HTMLElement>('.cl.add, .cl.del, .cl.ctx').forEach((row) => {
    const type = row.classList.contains('del') ? 'del' : row.classList.contains('add') ? 'add' : 'ctx';
    const numbers = row.querySelectorAll<HTMLElement>('.ln');
    const line = Number(numbers[type === 'del' ? 0 : 1]?.textContent);
    const code = row.querySelector<HTMLElement>('.code');
    const result = type === 'del' ? semantic.old : semantic.new;
    if (!code || !line || !result) return;
    const spans = result.spans.filter((span) => span.line === line - 1);
    if (spans.length) code.innerHTML = semanticLine(code.textContent ?? '', spans, code.innerHTML, lang);
  });
}

export { applyDiffSemantic, diffLexicalLines, renderDiff };
export type { DiffSemantic };
