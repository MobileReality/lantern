import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheStats, load, loadCoverage, loadGraph } from '../src/main/lantern';

let project: string;

function write(rel: string, text: string) {
  const file = path.join(project, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function bump(file: string) {
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
}

const record = (name: string) => `src/${name}.ts . util 000000000000 | ${name}`;
const mapText = (...names: string[]) => ['lantern 1', '# src', ...names.map(record)].join('\n') + '\n';
const langText = (text: Record<string, string>) => JSON.stringify({ model: 'claude-sonnet-5-5', text });

function seed() {
  write('src/a.ts', 'export const a = 1;\n');
  write('src/b.ts', 'export const b = 2;\n');
  const map = write('.lantern/map/src.lantern', mapText('a'));
  const lang = write('.lantern/lang/en/src.lantern.json', langText({ 'a.ts': 'first purpose' }));
  return { map, lang };
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-lantern-parse-cache-'));
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

describe('lantern parse cache', () => {
  it('serves a second load from RAM without re-reading any map or lang file', async () => {
    seed();
    const first = await loadGraph(project);
    const reads = cacheStats();
    const second = await loadGraph(project);
    const after = cacheStats();
    expect(after.mapFileReads).toBe(reads.mapFileReads);
    expect(after.langFileReads).toBe(reads.langFileReads);
    expect(second.nodes).toEqual(first.nodes);
    expect(second.nodes[0].purpose).toBe('first purpose');
  });

  it('re-reads only the map file that changed and shows the new record', async () => {
    const { map } = seed();
    write('.lantern/map/other.lantern', ['lantern 1', '# .', 'src/b.ts . util 000000000000 | b'].join('\n') + '\n');
    await loadGraph(project);
    const before = cacheStats();
    fs.writeFileSync(map, mapText('a', 'b'));
    const next = await loadGraph(project);
    expect(cacheStats().mapFileReads).toBe(before.mapFileReads + 1);
    expect(next.nodes.map((n) => n.path).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/b.ts']);
  });

  it('re-reads a lang file whose size changed', async () => {
    const { lang } = seed();
    expect((await loadGraph(project)).nodes[0].purpose).toBe('first purpose');
    const before = cacheStats().langFileReads;
    fs.writeFileSync(lang, langText({ 'a.ts': 'a much longer second purpose' }));
    expect((await loadGraph(project)).nodes[0].purpose).toBe('a much longer second purpose');
    expect(cacheStats().langFileReads).toBe(before + 1);
  });

  it('picks up a same-size rewrite once the mtime moves', async () => {
    const { lang } = seed();
    await loadGraph(project);
    const same = langText({ 'a.ts': 'FIRST purpose' });
    expect(same.length).toBe(langText({ 'a.ts': 'first purpose' }).length);
    fs.writeFileSync(lang, same);
    bump(lang);
    expect((await loadGraph(project)).nodes[0].purpose).toBe('FIRST purpose');
  });

  it('forgets a deleted map file and a deleted lang file', async () => {
    const { map, lang } = seed();
    expect((await loadGraph(project)).nodes).toHaveLength(1);
    fs.rmSync(map);
    fs.rmSync(lang);
    const next = await loadGraph(project);
    expect(next.exists).toBe(false);
    expect(next.nodes).toEqual([]);
  });

  it('keeps reporting a malformed lang file on every load, cached or not', async () => {
    seed();
    write('.lantern/lang/en/broken.lantern.json', '{ not json');
    const first = await loadGraph(project);
    const reads = cacheStats().langFileReads;
    const second = await loadGraph(project);
    expect(cacheStats().langFileReads).toBe(reads);
    expect(first.warnings.some((w) => w.includes('broken.lantern.json'))).toBe(true);
    expect(second.warnings).toEqual(first.warnings);
  });

  it('keeps reporting a malformed map file on every load, cached or not', async () => {
    seed();
    write('.lantern/map/bad.lantern', 'not a lantern file\n');
    const first = await loadGraph(project);
    const reads = cacheStats().mapFileReads;
    const second = await loadGraph(project);
    expect(cacheStats().mapFileReads).toBe(reads);
    expect(first.errors.length).toBeGreaterThan(0);
    expect(second.errors).toEqual(first.errors);
  });

  it('keeps the entries of one language when another is loaded', async () => {
    seed();
    write('.lantern/lang/pl/src.lantern.json', langText({ 'a.ts': 'pierwszy cel' }));
    await loadGraph(project);
    await loadGraph(project, 'pl');
    const reads = cacheStats().langFileReads;
    await loadGraph(project);
    await loadGraph(project, 'pl');
    expect(cacheStats().langFileReads).toBe(reads);
  });

  it('loads a second language through the same cache', async () => {
    seed();
    write('.lantern/lang/pl/src.lantern.json', langText({ 'a.ts': 'pierwszy cel' }));
    expect((await loadGraph(project, 'pl')).nodes[0].purpose).toBe('pierwszy cel');
    expect((await loadGraph(project)).nodes[0].purpose).toBe('first purpose');
  });
});

describe('lantern single flight', () => {
  const gateMapRead = () => {
    const original = fs.promises.readFile.bind(fs.promises);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let reached: () => void = () => undefined;
    const read = new Promise<void>((r) => (reached = r));
    vi.spyOn(fs.promises, 'readFile').mockImplementation((async (file: Parameters<typeof original>[0], ...rest: unknown[]) => {
      const text = await (original as (...a: unknown[]) => Promise<unknown>)(file, ...rest);
      if (String(file).endsWith('src.lantern')) {
        reached();
        await gate;
      }
      return text;
    }) as unknown as typeof fs.promises.readFile);
    return { release, read };
  };

  it('lets a fresh caller see a change made while a build was already reading', async () => {
    const { map } = seed();
    const { release, read } = gateMapRead();
    const stale = loadGraph(project);
    await read;
    fs.writeFileSync(map, mapText('a', 'b'));
    const plain = loadGraph(project);
    const fresh = loadGraph(project, undefined, true);
    const alsoFresh = loadGraph(project, undefined, true);
    release();
    vi.restoreAllMocks();
    expect(plain).toBe(stale);
    expect(alsoFresh).toBe(fresh);
    expect((await stale).nodes).toHaveLength(1);
    expect((await fresh).nodes.map((n) => n.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('runs exactly one trailing build for any number of fresh callers', async () => {
    seed();
    const runs = cacheStats().graphRuns;
    const first = loadGraph(project);
    const fresh = loadGraph(project, undefined, true);
    const alsoFresh = loadGraph(project, undefined, true);
    const plain = loadGraph(project);
    expect(plain).toBe(first);
    expect(alsoFresh).toBe(fresh);
    await Promise.all([first, fresh]);
    expect(cacheStats().graphRuns).toBe(runs + 2);
  });

  it('a fresh caller with nothing in flight starts its own build', async () => {
    seed();
    const runs = cacheStats().graphRuns;
    await loadGraph(project, undefined, true);
    expect(cacheStats().graphRuns).toBe(runs + 1);
  });

  it('keeps coverage fresh the same way', async () => {
    seed();
    const runs = cacheStats().coverageRuns;
    const first = loadCoverage(project);
    const fresh = loadCoverage(project, true);
    expect(fresh).not.toBe(first);
    await Promise.all([first, fresh]);
    expect(cacheStats().coverageRuns).toBe(runs + 2);
  });

  it('runs one build for concurrent loads of the same project and shares the result', async () => {
    seed();
    const runs = cacheStats().graphRuns;
    const [a, b, c] = await Promise.all([loadGraph(project), loadGraph(project), loadGraph(project)]);
    expect(cacheStats().graphRuns).toBe(runs + 1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('runs a fresh build once the previous one has settled', async () => {
    seed();
    await loadGraph(project);
    const runs = cacheStats().graphRuns;
    await loadGraph(project);
    expect(cacheStats().graphRuns).toBe(runs + 1);
  });

  it('keeps separate flights per language', async () => {
    seed();
    write('.lantern/lang/pl/src.lantern.json', langText({ 'a.ts': 'pierwszy cel' }));
    const runs = cacheStats().graphRuns;
    const [en, pl] = await Promise.all([loadGraph(project), loadGraph(project, 'pl')]);
    expect(cacheStats().graphRuns).toBe(runs + 2);
    expect(en.nodes[0].purpose).not.toBe(pl.nodes[0].purpose);
  });

  it('shares one coverage run between concurrent callers', async () => {
    seed();
    const runs = cacheStats().coverageRuns;
    const [a, b] = await Promise.all([loadCoverage(project), loadCoverage(project)]);
    expect(cacheStats().coverageRuns).toBe(runs + 1);
    expect(b).toBe(a);
  });

  it('starts a fresh build for each sequential call, even without a map', async () => {
    const runs = cacheStats().graphRuns;
    expect((await loadGraph(project)).exists).toBe(false);
    expect((await loadGraph(project)).exists).toBe(false);
    expect(cacheStats().graphRuns).toBe(runs + 2);
  });
});

describe('lantern two-stage payload', () => {
  it('sends the graph first with coverage pending and no enumeration', async () => {
    seed();
    const sniffed = cacheStats().sniffEntries;
    const graph = await loadGraph(project);
    expect(graph.coveragePending).toBe(true);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.total).toBe(0);
    expect(graph.unmapped).toEqual([]);
    expect(cacheStats().sniffEntries).toBe(sniffed);
  });

  it('sends the unmapped files and totals in the second stage', async () => {
    seed();
    const coverage = await loadCoverage(project);
    expect(coverage).toEqual({ unmapped: ['src/b.ts'], unmappedCount: 1, total: 2 });
  });

  it('reports a file added after the first coverage on the next one', async () => {
    seed();
    await loadCoverage(project);
    write('src/c.ts', 'export const c = 3;\n');
    expect((await loadCoverage(project)).unmapped).toEqual(['src/b.ts', 'src/c.ts']);
  });

  it('keeps load() returning both stages merged', async () => {
    seed();
    const full = await load(project);
    expect(full.coveragePending).toBe(false);
    expect(full.unmapped).toEqual(['src/b.ts']);
    expect(full.total).toBe(2);
  });

  it('returns no coverage for a project without a map', async () => {
    expect(await loadCoverage(project)).toEqual({ unmapped: [], unmappedCount: 0, total: 0 });
    expect((await loadGraph(project)).coveragePending).toBe(false);
  });
});
