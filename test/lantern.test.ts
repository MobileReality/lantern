import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedToolsFor, buildArgs, buildPrompt, exitEvent } from '../src/main/agent';
import { cacheStats, count, InvalidProjectError, load, MAX_CACHED_PROJECTS, parseMapFile, requireProject } from '../src/main/lantern';

const FIXTURES = path.join(__dirname, 'fixtures', 'lantern-map');
let project: string;

function writeMap(rel: string, text: string) {
  const file = path.join(project, '.lantern', 'map', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-lantern-'));
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

describe('lantern.load on the reference sample', () => {
  beforeEach(() => {
    writeMap('.lantern', fs.readFileSync(path.join(FIXTURES, 'root.lantern'), 'utf8'));
    writeMap('src/services.lantern', fs.readFileSync(path.join(FIXTURES, 'src', 'services.lantern'), 'utf8'));
  });

  it('reads every record and relation from the map files', async () => {
    const map = await load(project);
    expect(map.errors).toEqual([]);
    expect(map.exists).toBe(true);
    expect(map.nodes).toHaveLength(13);
    expect(map.relations).toHaveLength(15);
  });

  it('parses roles, directories and purposes', async () => {
    const { nodes } = await load(project);
    const byPath = new Map(nodes.map((n) => [n.path, n]));
    expect(byPath.get('src/services/orderService.ts')).toMatchObject({
      role: 'service',
      dir: 'src/services',
      marker: '.',
      hash: '63297ee1aeb2',
      purpose: 'order lifecycle; payment deducts stock',
    });
    expect(byPath.get('src/services/discountService.ts')?.role).toBe('repository');
    expect(byPath.get('src/services/mailService.ts')?.role).toBe('gateway');
    expect(byPath.get('package.json')).toMatchObject({ role: 'config', dir: '.' });
  });

  it('keeps relation arrow, symbol, label and external targets', async () => {
    const { relations } = await load(project);
    const from = relations.filter((r) => r.from === 'src/services/orderService.ts');
    expect(from.map((r) => r.arrow)).toEqual(['=', '=', '=', '>', '<']);
    expect(from[1]).toMatchObject({ to: 'src/utils/priceUtils.ts', symbol: 'calculateTotal', label: 'prices, discounts' });
    const ext = relations.find((r) => r.ext);
    expect(ext).toMatchObject({ from: 'src/services/shopSettingsService.ts', ext: 'hosted-database', to: null, label: 'settings/mailRelay' });
  });

  it('marks records whose file is missing as gone', async () => {
    const { nodes } = await load(project);
    expect(nodes.every((n) => n.freshness === 'gone')).toBe(true);
  });
});

describe('lantern.load freshness', () => {
  it('ignores file content: an edited file stays fresh, a missing one is gone', async () => {
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'one\ntwo\n');
    fs.writeFileSync(path.join(project, 'src', 'b.ts'), 'changed\n');
    writeMap(
      'src.lantern',
      ['lantern 1', '# src', 'src/a.ts . util 000000000000 | a', 'src/b.ts . util 000000000000 | b', 'src/c.ts ~@dev util 000000000000 | c', 'src/d.ts . util 000000000000 | d'].join('\n'),
    );
    const { nodes } = await load(project);
    expect(nodes.map((n) => [n.path, n.freshness])).toEqual([
      ['src/a.ts', 'fresh'],
      ['src/b.ts', 'fresh'],
      ['src/c.ts', 'fresh'],
      ['src/d.ts', 'gone'],
    ]);
    expect(nodes[2]).toMatchObject({ marker: '~', owner: 'dev' });
  });

  it('never looks at a path outside the project', async () => {
    writeMap('.lantern', ['lantern 1', '# .', '../outside.ts . util 000000000000 | x'].join('\n'));
    expect((await load(project)).nodes[0].freshness).toBe('gone');
  });
});

describe('lantern.load without a map', () => {
  it('reports exists=false', async () => {
    expect(await load(project)).toMatchObject({ exists: false, nodes: [], relations: [] });
  });

  it('reports exists=false for an empty path', async () => {
    expect((await load('')).exists).toBe(false);
  });
});

describe('parseMapFile', () => {
  it('reports malformed records and a mismatched directory header', () => {
    const { errors, records } = parseMapFile(['lantern 1', '# wrong', 'src/a.ts . util | no hash', '  > src/b.ts', 'src/ok.ts . util abc | ok', '  ? nope'].join('\n'), '.lantern/map/src.lantern');
    expect(records).toHaveLength(1);
    expect(errors).toHaveLength(4);
    expect(errors.join('\n')).toContain('first # line must be "# src"');
  });

  it('decodes escaped characters in paths', () => {
    const { records } = parseMapFile(['lantern 1', '# .', 'my%20file%23x.ts . util abc | odd'].join('\n'), '.lantern/map/.lantern');
    expect(records[0].path).toBe('my file#x.ts');
  });

  it('ignores a legacy #model line', () => {
    const text = ['lantern 1', '# src', '#model claude-sonnet-5-5', 'src/a.ts . util abc', '#model gpt-6.1-sol', 'src/b.ts . util def'].join('\n');
    const { errors, records } = parseMapFile(text, '.lantern/map/src.lantern');
    expect(errors).toEqual([]);
    expect(records.map((r) => r.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

const LANTERN_TOOLS = ['Bash(node:*)', 'Read', 'Agent', 'Bash(cat:*)', 'Bash(ls:*)', 'Bash(wc:*)', 'Bash(head:*)', 'Bash(grep:*)', 'Bash(tail:*)', 'Bash(sort:*)', 'Bash(uniq:*)', 'Bash(cut:*)', 'Bash(du:*)'];

describe('lantern agent prompts', () => {
  it('setup and refresh both run the lantern-setup skill', () => {
    expect(buildPrompt('lantern')).toContain('lantern-setup');
    expect(buildPrompt('lantern-refresh')).toContain('lantern-setup');
    expect(buildPrompt('lantern-refresh')).toContain('refresh');
  });
});

describe('lantern agent args', () => {
  it('lets the lantern kinds run node scripts and no other kind', () => {
    for (const kind of ['lantern', 'lantern-refresh'] as const) {
      const args = buildArgs(kind, 'p');
      expect(args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--allowedTools') + 14)).toEqual(LANTERN_TOOLS);
    }
    expect(buildArgs('explain', 'p')).not.toContain('--allowedTools');
    expect(buildArgs('explain', 'p', 'sess')).toEqual(expect.arrayContaining(['--resume', 'sess', '--fork-session']));
  });
});

describe('lantern.load existence check', () => {
  const source = () => path.join(project, 'a.ts');

  beforeEach(() => {
    fs.writeFileSync(source(), 'export const a = 1;\n');
    writeMap('.lantern', 'lantern 1\n# .\na.ts . util 000000000000 | a\n');
  });

  afterEach(() => vi.restoreAllMocks());

  it('never reads a mapped file, and an edit does not change its freshness', async () => {
    expect((await load(project)).nodes[0].freshness).toBe('fresh');
    const spy = vi.spyOn(fs.promises, 'readFile');
    fs.writeFileSync(source(), 'export const a = 22222;\n');
    expect((await load(project)).nodes[0].freshness).toBe('fresh');
    expect(spy.mock.calls.map((c) => String(c[0])).filter((f) => f.endsWith('a.ts'))).toEqual([]);
  });

  it('reports a deleted file as gone', async () => {
    await load(project);
    fs.rmSync(source());
    expect((await load(project)).nodes[0].freshness).toBe('gone');
  });

  it('counts records without touching the mapped files', async () => {
    const spy = vi.spyOn(fs.promises, 'stat');
    expect(await count(project)).toBe(1);
    expect(spy.mock.calls.map((c) => String(c[0])).filter((f) => f.endsWith('a.ts'))).toEqual([]);
  });
});

describe('requireProject', () => {
  it('accepts a non-empty string and rejects everything else', () => {
    expect(requireProject('/tmp/x')).toBe('/tmp/x');
    for (const bad of ['', '   ', undefined, null, 42, {}]) expect(() => requireProject(bad)).toThrow(InvalidProjectError);
  });
});

describe('agent exit handling', () => {
  it('stays silent when the child exits after a cancel', () => {
    expect(exitEvent(null, true, '')).toBeNull();
    expect(exitEvent(137, true, 'killed')).toBeNull();
  });

  it('still reports a genuine failure and ignores a clean exit', () => {
    expect(exitEvent(1, false, ' boom \n')).toEqual({ kind: 'error', text: 'boom' });
    expect(exitEvent(null, false, '')).toEqual({ kind: 'error', text: 'claude exited null' });
    expect(exitEvent(0, false, '')).toBeNull();
  });

  it('reports a Codex run that exits without a terminal event', () => {
    expect(exitEvent(null, false, '', false, 'codex')).toEqual({ kind: 'error', text: 'Codex exited null' });
    expect(exitEvent(0, false, '', false, 'codex')).toEqual({ kind: 'error', text: 'Codex exited without a completion event.' });
    expect(exitEvent(0, false, '', true, 'codex')).toBeNull();
  });

  it('keeps the node allowance for lantern runs only', () => {
    expect(allowedToolsFor('lantern')).toEqual(LANTERN_TOOLS);
    expect(allowedToolsFor('explain')).toEqual([]);
  });
});

describe('lantern sniff cache bounds', () => {
  const makeProject = (files: number) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-lantern-cache-'));
    const lines = ['lantern 1', '# .'];
    for (let i = 0; i < files; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.ts`), `export const v${i} = ${i};\n`);
      lines.push(`f${i}.ts . util 000000000000 | f${i}`);
    }
    fs.mkdirSync(path.join(dir, '.lantern', 'map'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.lantern', 'map', '.lantern'), lines.join('\n') + '\n');
    return dir;
  };

  it('keeps sniff verdicts for enumerated files', async () => {
    const dir = makeProject(2);
    await load(dir);
    expect(cacheStats().sniffEntries).toBeGreaterThanOrEqual(2);
    expect(cacheStats().sniffProjects).toBeGreaterThanOrEqual(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('caps how many projects stay cached', async () => {
    const dirs = Array.from({ length: MAX_CACHED_PROJECTS + 3 }, () => makeProject(1));
    for (const dir of dirs) await load(dir);
    expect(cacheStats().sniffProjects).toBeLessThanOrEqual(MAX_CACHED_PROJECTS);
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });
});
