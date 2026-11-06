import type { DiffRow } from './codeview';

interface Scope {
  index: number;
  line: number | null;
  text: string;
}

type FoldEdge = 'lead' | 'mid' | 'trail';

type Segment =
  | { kind: 'rows'; from: number; to: number }
  | { kind: 'hunk'; index: number; skipped: number }
  | { kind: 'fold'; from: number; to: number; edge: FoldEdge; scope: Scope | null };

const KEEP_CONTEXT = 1;
const MIN_FOLD = 3;
const MAX_SCOPE_SCAN = 3000;
const REFERENCE_LOOKAHEAD = 12;
const TAB_WIDTH = 4;

const DECL = /^(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+)?(function\*?|class|interface|enum|namespace|module|type|const|let|var|describe|it|test|suite|def|fn|func|impl|struct|trait|object|fun|pub|public|private|protected|static|mod|extends)\b/;
const CONTROL = /^(if|else|for|while|do|switch|try|catch|finally|return|case|default|with)\b|^[}\])]/;

function indentOf(text: string) {
  let n = 0;
  for (const ch of text) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += TAB_WIDTH;
    else break;
  }
  return n;
}

function isScopeLine(text: string) {
  if (!text || CONTROL.test(text)) return false;
  if (DECL.test(text)) return !/;\s*$/.test(text);
  return /\{\s*$/.test(text);
}

function referenceIndent(rows: DiffRow[], at: number, end: number) {
  for (let i = at; i < end && i < at + REFERENCE_LOOKAHEAD; i++) {
    const r = rows[i];
    if (r.type === 'hunk') break;
    if (r.type === 'del' && i !== at) continue;
    if (r.code && r.code.trim()) return indentOf(r.code);
  }
  return 0;
}

function findScope(rows: DiffRow[], hunkStart: number, hunkEnd: number, change: number): Scope | null {
  let cur = referenceIndent(rows, change, hunkEnd);
  for (let i = change - 1; i >= hunkStart && i >= change - MAX_SCOPE_SCAN && cur > 0; i--) {
    const r = rows[i];
    if (r.type === 'del' || r.type === 'hunk' || !r.code || !r.code.trim()) continue;
    const ind = indentOf(r.code);
    if (ind >= cur) continue;
    if (isScopeLine(r.code.trim())) return { index: i, line: r.newLn ?? r.oldLn ?? null, text: r.code.trim() };
    cur = ind;
  }
  return null;
}

function planHunk(rows: DiffRow[], from: number, to: number, hunkText: string, segs: Segment[]) {
  const visible = new Array<boolean>(to - from).fill(false);
  for (let i = from; i < to; i++) {
    if (rows[i].type === 'ctx') continue;
    for (let j = Math.max(from, i - KEEP_CONTEXT); j <= Math.min(to - 1, i + KEEP_CONTEXT); j++) visible[j - from] = true;
  }
  let i = from;
  while (i < to) {
    let j = i;
    if (visible[i - from]) {
      while (j < to && visible[j - from]) j++;
      segs.push({ kind: 'rows', from: i, to: j });
      i = j;
      continue;
    }
    while (j < to && !visible[j - from]) j++;
    if (j - i < MIN_FOLD) {
      segs.push({ kind: 'rows', from: i, to: j });
    } else {
      const edge: FoldEdge = i === from ? 'lead' : j === to ? 'trail' : 'mid';
      let scope: Scope | null = null;
      if (edge !== 'trail') {
        if (hunkText) scope = edge === 'lead' ? null : { index: -1, line: null, text: hunkText };
        else {
          let change = j;
          while (change < to && rows[change].type === 'ctx') change++;
          scope = findScope(rows, from, to, change);
        }
      }
      segs.push({ kind: 'fold', from: i, to: j, edge, scope });
    }
    i = j;
  }
}

function mergeRows(segs: Segment[]) {
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (s.kind === 'rows' && last && last.kind === 'rows' && last.to === s.from) last.to = s.to;
    else out.push(s);
  }
  return out;
}

function planDiff(rows: DiffRow[], collapse: boolean): Segment[] {
  const collapsible = collapse && rows.some((r) => r.type === 'ctx') && rows.some((r) => r.type !== 'ctx' && r.type !== 'hunk');
  const segs: Segment[] = [];
  let lastOld = 0;
  let i = 0;
  while (i < rows.length) {
    let from = i;
    let hunkText = '';
    if (rows[i].type === 'hunk') {
      const h = rows[i];
      segs.push({ kind: 'hunk', index: i, skipped: Math.max(0, (h.oldStart ?? 1) - 1 - lastOld) });
      hunkText = h.text ?? '';
      from = i + 1;
    }
    let to = from;
    while (to < rows.length && rows[to].type !== 'hunk') {
      const r = rows[to];
      if (r.oldLn != null) lastOld = r.oldLn;
      to++;
    }
    if (to > from) {
      if (collapsible) planHunk(rows, from, to, hunkText, segs);
      else segs.push({ kind: 'rows', from, to });
    }
    i = to;
  }
  return mergeRows(segs);
}

function hasFold(segs: Segment[]) {
  return segs.some((s) => s.kind === 'fold');
}

function diffStats(rows: DiffRow[]) {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.type === 'add') added++;
    else if (r.type === 'del') removed++;
  }
  return { added, removed };
}

export { diffStats, findScope, hasFold, planDiff };
export type { FoldEdge, Scope, Segment };
