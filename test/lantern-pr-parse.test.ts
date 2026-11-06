import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrRecord } from '../src/main/lantern-pr-parse';

const FIXTURES = path.join(__dirname, 'fixtures', 'lantern-prs');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const HEAD = '3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c';
const VALID = ['lantern-pr 1', '# 7', '#title t', '#url https://x.test/7', '#branch b', '#base main', '#opened 2026-09-30', `#head ${HEAD}`];

function build(lines: string[]) {
  return `${lines.join('\n')}\n`;
}

describe('parsePrRecord', () => {
  it('parses the reference record with every kind and the summary', () => {
    const { pr, error } = parsePrRecord(read('24.pr'), '24.pr');
    expect(error).toBeNull();
    expect(pr).toEqual({
      id: '24',
      title: 'test: refuse to signal pids 0, 1 and -1',
      url: 'https://example.com/org/repo/pull-requests/24',
      branch: 'fix/test-process-kill-guard',
      base: 'main',
      opened: '2026-09-30',
      head: HEAD,
      summary: 'one line, optional',
      files: [
        { kind: 'added', path: 'test/support/process-guard.ts' },
        { kind: 'modified', path: 'vitest.config.ts' },
        { kind: 'removed', path: 'src/old/legacy.ts' },
      ],
    });
  });

  it('decodes %20 %23 %25 in file paths and leaves summary null when absent', () => {
    const { pr } = parsePrRecord(read('25.pr'), '25.pr');
    expect(pr?.summary).toBeNull();
    expect(pr?.files[0]).toEqual({ kind: 'added', path: 'docs/my notes #50.md' });
    expect(parsePrRecord(build([...VALID, '~ a%2520b.ts']), '7.pr').pr?.files[0].path).toBe('a%20b.ts');
  });

  it('rejects a record missing required keys', () => {
    expect(parsePrRecord(read('bad.pr'), 'bad.pr').error).toMatch(/file name/);
    expect(parsePrRecord(read('bad.pr'), '26.pr').error).toBe('missing #url');
  });

  it('rejects a wrong header, an id that differs from the file name, and a non-id first # line', () => {
    expect(parsePrRecord(build(['lantern 1', ...VALID.slice(1)]), '7.pr').error).toMatch(/first line/);
    expect(parsePrRecord(build(VALID), '8.pr').error).toMatch(/does not match/);
    expect(parsePrRecord(build(['lantern-pr 1', '#title t', ...VALID.slice(1)]), '7.pr').error).toMatch(/first # line/);
  });

  it('rejects duplicate keys, a short head, a bad date and stray lines', () => {
    expect(parsePrRecord(build([...VALID, '#title again']), '7.pr').error).toMatch(/duplicate #title/);
    expect(parsePrRecord(build(VALID.map((l) => (l.startsWith('#head') ? '#head abc123' : l))), '7.pr').error).toMatch(/full commit sha/);
    expect(parsePrRecord(build(VALID.map((l) => (l.startsWith('#opened') ? '#opened yesterday' : l))), '7.pr').error).toMatch(/ISO date/);
    expect(parsePrRecord(build([...VALID, 'src/a.ts']), '7.pr').error).toMatch(/not a file line/);
    expect(parsePrRecord(build([...VALID, '* src/a.ts']), '7.pr').error).toMatch(/not a file line/);
  });

  it('rejects unsafe and duplicate paths', () => {
    expect(parsePrRecord(build([...VALID, '+ ../etc/passwd']), '7.pr').error).toMatch(/unsafe path/);
    expect(parsePrRecord(build([...VALID, '+ /abs/x']), '7.pr').error).toMatch(/unsafe path/);
    expect(parsePrRecord(build([...VALID, '+ a.ts', '- a.ts']), '7.pr').error).toMatch(/listed twice/);
  });

  it('ignores unknown # lines, blank lines and CRLF endings', () => {
    const text = build([...VALID, '#reviewer someone', '', '~ a.ts']).replace(/\n/g, '\r\n');
    const { pr, error } = parsePrRecord(text, '7.pr');
    expect(error).toBeNull();
    expect(pr?.files).toEqual([{ kind: 'modified', path: 'a.ts' }]);
  });

  it('accepts a record with no changed files', () => {
    expect(parsePrRecord(build(VALID), '7.pr').pr?.files).toEqual([]);
  });

  describe('reasons (#reason lines)', () => {
    const reasonLine = (path: string, text: string) => `#reason ${path} ${text}`;

    it('attaches a reason to its file, decoding the path, and leaves other files without one', () => {
      const { pr, error } = parsePrRecord(build([...VALID, '+ a%20b.ts', '~ c.ts', reasonLine('a%20b.ts', 'Spaces survive the round trip.')]), '7.pr');
      expect(error).toBeNull();
      expect(pr?.files).toEqual([{ kind: 'added', path: 'a b.ts', reason: 'Spaces survive the round trip.' }, { kind: 'modified', path: 'c.ts' }]);
      expect(Object.keys(pr!.files[1])).toEqual(['kind', 'path']);
    });

    it('keeps a record without any #reason exactly as before', () => {
      const { pr } = parsePrRecord(read('24.pr'), '24.pr');
      expect(pr?.files.every((f) => !('reason' in f))).toBe(true);
    });

    it('reads reasons written above the file lines, with CRLF endings, and trims them', () => {
      const text = build([...VALID, reasonLine('a.ts', '  padded reason  '), '+ a.ts']).replace(/\n/g, '\r\n');
      expect(parsePrRecord(text, '7.pr').pr?.files).toEqual([{ kind: 'added', path: 'a.ts', reason: 'padded reason' }]);
    });

    it('accepts exactly 160 characters and drops a longer reason without rejecting the record', () => {
      const ok = parsePrRecord(build([...VALID, '+ a.ts', reasonLine('a.ts', 'x'.repeat(160))]), '7.pr');
      expect(ok.pr?.files[0].reason).toHaveLength(160);
      const over = parsePrRecord(build([...VALID, '+ a.ts', reasonLine('a.ts', 'x'.repeat(161))]), '7.pr');
      expect(over.error).toBeNull();
      expect(over.pr?.files).toEqual([{ kind: 'added', path: 'a.ts' }]);
    });

    it('ignores a reason with no text, one for an unlisted file, and a repeated one (first wins)', () => {
      const text = build([...VALID, '+ a.ts', '+ b.ts', '#reason a.ts', reasonLine('ghost.ts', 'nobody'), reasonLine('b.ts', 'first'), reasonLine('b.ts', 'second')]);
      expect(parsePrRecord(text, '7.pr').pr?.files).toEqual([{ kind: 'added', path: 'a.ts' }, { kind: 'added', path: 'b.ts', reason: 'first' }]);
    });

    it('keeps markup and a literal # or = in a reason verbatim', () => {
      const reason = 'Use <b> & #tags, a=b';
      expect(parsePrRecord(build([...VALID, '+ a.ts', reasonLine('a.ts', reason)]), '7.pr').pr?.files[0].reason).toBe(reason);
    });
  });

  describe('review order (#order lines)', () => {
    const order = (path: string) => `#order ${path}`;
    const FILES = ['+ a.ts', '~ b.ts', '~ c%20d.ts', '- e.ts'];
    const paths = (text: string) => parsePrRecord(text, '7.pr').pr?.files.map((f) => f.path);

    it('lists the files in review order and marks the record ordered', () => {
      const { pr, error } = parsePrRecord(build([...VALID, ...FILES, order('e.ts'), order('c%20d.ts'), order('a.ts'), order('b.ts')]), '7.pr');
      expect(error).toBeNull();
      expect(pr?.files.map((f) => f.path)).toEqual(['e.ts', 'c d.ts', 'a.ts', 'b.ts']);
      expect(pr?.files.map((f) => f.kind)).toEqual(['removed', 'modified', 'added', 'modified']);
      expect(pr?.ordered).toBe(true);
    });

    it('puts the files with no #order line after the ordered ones, in their normal order', () => {
      const text = build([...VALID, ...FILES, order('c%20d.ts'), order('b.ts')]);
      expect(paths(text)).toEqual(['c d.ts', 'b.ts', 'a.ts', 'e.ts']);
    });

    it('keeps a reason with its file when the order moves it', () => {
      const text = build([...VALID, ...FILES, order('b.ts'), '#reason b.ts Defines the contract.', '#reason a.ts Uses it.']);
      expect(parsePrRecord(text, '7.pr').pr?.files.slice(0, 2)).toEqual([{ kind: 'modified', path: 'b.ts', reason: 'Defines the contract.' }, { kind: 'added', path: 'a.ts', reason: 'Uses it.' }]);
    });

    it('is not ordered, and keeps the file order, without #order lines', () => {
      const { pr } = parsePrRecord(build([...VALID, ...FILES]), '7.pr');
      expect(pr?.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c d.ts', 'e.ts']);
      expect(pr && 'ordered' in pr).toBe(false);
    });

    it('drops an unlisted path, a repeated path and a bare #order, and keeps the record', () => {
      const text = build([...VALID, ...FILES, '#order', order('ghost.ts'), order('b.ts'), order('b.ts'), order('a.ts')]);
      const { pr, error } = parsePrRecord(text, '7.pr');
      expect(error).toBeNull();
      expect(pr?.files.map((f) => f.path)).toEqual(['b.ts', 'a.ts', 'c d.ts', 'e.ts']);
    });

    it('is not ordered when no #order names a listed file', () => {
      const { pr } = parsePrRecord(build([...VALID, ...FILES, order('ghost.ts')]), '7.pr');
      expect(pr?.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c d.ts', 'e.ts']);
      expect(pr && 'ordered' in pr).toBe(false);
    });
  });
});
