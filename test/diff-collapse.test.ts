import { describe, expect, it } from 'vitest';
import { parseDiffRows } from '../src/renderer/lib/codeview';
import { diffStats, findScope, hasFold, planDiff } from '../src/renderer/lib/diffcollapse';
import type { Segment } from '../src/renderer/lib/diffcollapse';
import { fullContextDiff, numbered, pureAddDiff, pureRemoveDiff } from './helpers/diff-text';

const rowsOf = (diff: string) => parseDiffRows(diff);
const folds = (segs: Segment[]) => segs.filter((s): s is Extract<Segment, { kind: 'fold' }> => s.kind === 'fold');

describe('planDiff', () => {
  it('hides context far from a change and keeps one line on each side', () => {
    const rows = rowsOf(fullContextDiff(numbered(40), [{ line: 20, to: 'changed' }]));
    const segs = planDiff(rows, true);
    const shape = segs.filter((s) => s.kind !== 'hunk').map((s) => (s.kind === 'fold' ? `fold:${s.edge}:${s.to - s.from}` : `rows:${s.to - s.from}`));
    expect(shape).toEqual(['fold:lead:18', 'rows:4', 'fold:trail:19']);
    const kept = segs.find((s) => s.kind === 'rows');
    expect(kept && kept.kind === 'rows' && rows.slice(kept.from, kept.to).map((r) => r.type)).toEqual(['ctx', 'del', 'add', 'ctx']);
  });

  it('shows runs of one or two unchanged lines instead of folding them', () => {
    const lines = numbered(30);
    const near = planDiff(rowsOf(fullContextDiff(lines, [{ line: 10, to: 'a' }, { line: 14, to: 'b' }])), true);
    expect(folds(near).map((f) => f.edge)).toEqual(['lead', 'trail']);
    const far = planDiff(rowsOf(fullContextDiff(lines, [{ line: 10, to: 'a' }, { line: 16, to: 'b' }])), true);
    expect(folds(far).map((f) => f.edge)).toEqual(['lead', 'mid', 'trail']);
    const mid = folds(far)[1];
    expect(mid.to - mid.from).toBe(3);
  });

  it('merges adjacent visible rows into one segment', () => {
    const rows = rowsOf(fullContextDiff(numbered(30), [{ line: 10, to: 'a' }, { line: 12, to: 'b' }]));
    expect(planDiff(rows, true).filter((s) => s.kind === 'rows')).toHaveLength(1);
  });

  it('does not fold anything when collapsing is off', () => {
    const rows = rowsOf(fullContextDiff(numbered(40), [{ line: 20, to: 'changed' }]));
    expect(hasFold(planDiff(rows, false))).toBe(false);
    expect(hasFold(planDiff(rows, true))).toBe(true);
  });

  it('never folds a new file or a removed file', () => {
    expect(hasFold(planDiff(rowsOf(pureAddDiff(numbered(200))), true))).toBe(false);
    expect(hasFold(planDiff(rowsOf(pureRemoveDiff(numbered(200))), true))).toBe(false);
  });

  it('never folds a tiny diff', () => {
    const rows = rowsOf(fullContextDiff(numbered(5), [{ line: 3, to: 'x' }]));
    expect(hasFold(planDiff(rows, true))).toBe(false);
  });

  it('counts added and removed lines', () => {
    const rows = rowsOf(fullContextDiff(numbered(20), [{ line: 3, to: 'x' }, { line: 8 }, { line: 12, to: 'y', insert: true }]));
    expect(diffStats(rows)).toEqual({ added: 2, removed: 2 });
  });

  it('reports lines git left out between -U3 hunks', () => {
    const diff = ['@@ -2,3 +2,3 @@', ' a', '-b', '+c', '@@ -20,3 +20,3 @@ function far() {', ' d', '-e', '+f'].join('\n');
    const hunks = planDiff(rowsOf(diff), true).filter((s) => s.kind === 'hunk');
    expect(hunks.map((h) => (h.kind === 'hunk' ? h.skipped : -1))).toEqual([1, 16]);
  });
});

describe('enclosing scope', () => {
  const body = (nested: string[]) => ['import a from "a";', '', 'export class Store {', '  private x = 1;', '', '  async load(id: string) {', '    if (id) {', ...nested, '    }', '  }', '}'];

  it('finds the nearest enclosing declaration above a change, skipping control flow', () => {
    const lines = [...body(numbered(12, '      '))];
    const rows = rowsOf(fullContextDiff(lines, [{ line: 12, to: 'changed' }]));
    const change = rows.findIndex((r) => r.type === 'del');
    expect(findScope(rows, 0, rows.length, change)?.text).toBe('async load(id: string) {');
  });

  it('walks out to the class when the change is a field', () => {
    const rows = rowsOf(fullContextDiff(body(['      go();']), [{ line: 4, to: '  private x = 2;' }]));
    const change = rows.findIndex((r) => r.type === 'del');
    expect(findScope(rows, 0, rows.length, change)?.text).toBe('export class Store {');
  });

  it('has no scope for a top-level change', () => {
    const rows = rowsOf(fullContextDiff(body(['      go();']), [{ line: 1, to: 'import b from "b";' }]));
    expect(findScope(rows, 0, rows.length, rows.findIndex((r) => r.type === 'del'))).toBeNull();
  });

  it('attaches the scope to the fold that precedes the change', () => {
    const lines = [...body(numbered(40, '      '))];
    const rows = rowsOf(fullContextDiff(lines, [{ line: 30, to: 'changed' }]));
    const lead = folds(planDiff(rows, true))[0];
    expect(lead.edge).toBe('lead');
    expect(lead.scope?.text).toBe('async load(id: string) {');
    expect(lead.scope?.line).toBe(6);
  });

  it('prefers the hunk header text git provides over scanning', () => {
    const diff = ['@@ -1,12 +1,12 @@', ...Array.from({ length: 5 }, (_, i) => ` l${i}`), '-old', '+new', ...Array.from({ length: 5 }, (_, i) => ` t${i}`)].join('\n');
    const rows = rowsOf(diff.replace('@@ -1,12 +1,12 @@', '@@ -1,12 +1,12 @@ function owner() {'));
    const segs = planDiff(rows, true);
    expect(folds(segs)[0].scope).toBeNull();
    const twoChanges = ['@@ -1,20 +1,20 @@ function owner() {', ' a', '-b', '+b2', ...Array.from({ length: 8 }, (_, i) => ` m${i}`), '-c', '+c2', ' z'].join('\n');
    const mid = folds(planDiff(rowsOf(twoChanges), true)).find((f) => f.edge === 'mid');
    expect(mid?.scope?.text).toBe('function owner() {');
  });
});
