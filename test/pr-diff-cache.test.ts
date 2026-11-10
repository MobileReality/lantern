// @vitest-environment jsdom
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrFileDiff } from '../src/main/lantern-prdiff';
import { readPrFileDiff } from '../src/main/lantern-prdiff';
import { createDiffCache, neighbourOrder } from '../src/renderer/lib/prdiffcache';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { branchOff, commitFile, commitRecord, git, makeWorld } from './helpers/git-repo';
import type { World } from './helpers/git-repo';
import { mapOf, node, pr } from './helpers/lantern-map';
import { openPrFile } from './helpers/pr-rows';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const good = (diff = 'd'): PrFileDiff => ({ ok: true, diff, truncated: false, binary: false });
const bad: PrFileDiff = { ok: false, diff: '', truncated: false, binary: false, reason: 'git could not produce this diff' };
const flush = () => new Promise((r) => setTimeout(r, 0));
const paths = (n: number) => Array.from({ length: n }, (_, i) => `src/f${i}.ts`);

function gated() {
  const waiting: Array<{ pr: string; path: string; done(res?: PrFileDiff): void; fail(): void }> = [];
  const calls: string[] = [];
  const read = (id: string, path: string) => {
    calls.push(path);
    return new Promise<PrFileDiff>((resolve, reject) => waiting.push({ pr: id, path, done: (res = good(path)) => resolve(res), fail: () => reject(new Error('x')) }));
  };
  return { read, waiting, calls };
}

describe('neighbourOrder', () => {
  it('starts at the file in view and walks outwards, next file before previous', () => {
    expect(neighbourOrder(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual(['c', 'd', 'b', 'e', 'a']);
    expect(neighbourOrder(['a', 'b', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    expect(neighbourOrder(['a', 'b', 'c'], 'c')).toEqual(['c', 'b', 'a']);
  });
});

describe('the PR diff cache', () => {
  it('preloads the file in view first, then its neighbours', async () => {
    const calls: string[] = [];
    const cache = createDiffCache(async (_pr, path) => (calls.push(path), good(path)), () => 'v1', 1);
    cache.preload('7', ['a', 'b', 'c', 'd', 'e'], 'c');
    await flush();
    expect(calls).toEqual(['c', 'd', 'b', 'e', 'a']);
  });

  it('never runs more than the limit of requests at once', async () => {
    const { read, waiting } = gated();
    let live = 0;
    let peak = 0;
    const cache = createDiffCache((id, path) => {
      live++;
      peak = Math.max(peak, live);
      return read(id, path).finally(() => live--);
    }, () => 'v1', 3);
    cache.preload('7', paths(16), 'src/f0.ts');
    expect(waiting).toHaveLength(3);
    while (waiting.length) {
      waiting.shift()!.done();
      await flush();
    }
    expect(peak).toBe(3);
    expect(cache.size()).toBe(16);
  });

  it('serves a preloaded file from the cache with no new call', async () => {
    const read = vi.fn(async (_pr: string, path: string) => good(path));
    const cache = createDiffCache(read, () => 'v1');
    cache.preload('7', paths(8), 'src/f0.ts');
    await flush();
    expect(read).toHaveBeenCalledTimes(8);
    await expect(cache.read('7', 'src/f5.ts')).resolves.toMatchObject({ diff: 'src/f5.ts' });
    await cache.read('7', 'src/f0.ts');
    expect(read).toHaveBeenCalledTimes(8);
  });

  it('passes the sides the user chose to the reader and keeps that read out of the cache', async () => {
    const read = vi.fn(async (_pr: string, path: string, sides?: { base?: string; branch?: string }) => good(sides ? `${path}@${sides.base}` : path));
    const cache = createDiffCache(read, () => 'v1');
    await cache.read('7', 'src/f0.ts');

    await expect(cache.read('7', 'src/f0.ts', { base: 'feat/other' })).resolves.toMatchObject({ diff: 'src/f0.ts@feat/other' });
    await expect(cache.read('7', 'src/f0.ts', { base: 'feat/other' })).resolves.toMatchObject({ diff: 'src/f0.ts@feat/other' });
    await expect(cache.read('7', 'src/f0.ts')).resolves.toMatchObject({ diff: 'src/f0.ts' });

    expect(read.mock.calls).toEqual([['7', 'src/f0.ts'], ['7', 'src/f0.ts', { base: 'feat/other' }], ['7', 'src/f0.ts', { base: 'feat/other' }]]);
  });

  it('stops preloading a PR the user chose sides for, until the default comparison is read again', async () => {
    const read = vi.fn(async (_pr: string, path: string, _sides?: { base?: string; branch?: string }) => good(path));
    const cache = createDiffCache(read, () => 'v1', 1);
    await cache.read('7', 'src/f0.ts', { base: 'feat/other' });
    cache.preload('7', paths(4), 'src/f1.ts');
    await flush();
    expect(read.mock.calls).toEqual([['7', 'src/f0.ts', { base: 'feat/other' }]]);

    await cache.read('7', 'src/f1.ts');
    cache.preload('7', paths(4), 'src/f1.ts');
    await flush();
    expect(read.mock.calls.filter((c) => !c[2]).map((c) => c[1]).sort()).toEqual(['src/f0.ts', 'src/f1.ts', 'src/f2.ts', 'src/f3.ts']);
  });

  it('does not block the first diff: the file in view is read at once and shared with the preload', async () => {
    const { read, waiting, calls } = gated();
    const cache = createDiffCache(read, () => 'v1', 1);
    cache.preload('7', paths(5), 'src/f2.ts');
    const first = cache.read('7', 'src/f4.ts');
    expect(calls).toEqual(['src/f2.ts', 'src/f4.ts']);
    waiting[1].done();
    await expect(first).resolves.toMatchObject({ ok: true });
    const again = cache.read('7', 'src/f2.ts');
    expect(calls).toHaveLength(2);
    waiting[0].done();
    await expect(again).resolves.toMatchObject({ ok: true });
  });

  it('restarts the order when the file in view changes, dropping what is still queued', async () => {
    const { read, waiting, calls } = gated();
    const cache = createDiffCache(read, () => 'v1', 1);
    cache.preload('7', paths(6), 'src/f0.ts');
    cache.preload('7', paths(6), 'src/f5.ts');
    waiting.shift()!.done();
    await flush();
    expect(calls).toEqual(['src/f0.ts', 'src/f5.ts']);
  });

  it('drops the diffs of an earlier PR state when the head moves', async () => {
    let version = 'old';
    const read = vi.fn(async (_pr: string, path: string) => good(`${version}:${path}`));
    const cache = createDiffCache(read, () => version);
    await cache.read('7', 'a');
    await cache.read('7', 'a');
    expect(read).toHaveBeenCalledTimes(1);
    version = 'new';
    await expect(cache.read('7', 'a')).resolves.toMatchObject({ diff: 'new:a' });
    expect(read).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(1);
  });

  it('keeps another PR when one PR changes', async () => {
    const versions: Record<string, string> = { 7: 'a', 8: 'a' };
    const read = vi.fn(async (_pr: string, path: string) => good(path));
    const cache = createDiffCache(read, (id) => versions[id]);
    await cache.read('7', 'x');
    await cache.read('8', 'x');
    versions[7] = 'b';
    await cache.read('7', 'x');
    await cache.read('8', 'x');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('does not keep an unavailable result or a failure as if it were a diff', async () => {
    const answers: Array<PrFileDiff | Error> = [bad, new Error('boom'), good('real')];
    const read = vi.fn(async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    const cache = createDiffCache(read, () => 'v1');
    await expect(cache.read('7', 'a')).resolves.toMatchObject({ ok: false });
    await expect(cache.read('7', 'a')).rejects.toThrow('boom');
    await expect(cache.read('7', 'a')).resolves.toMatchObject({ diff: 'real' });
    await cache.read('7', 'a');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('keeps preloading after a failed file and stops when told to', async () => {
    const calls: string[] = [];
    const cache = createDiffCache(async (_pr, path) => {
      calls.push(path);
      if (path === 'b') throw new Error('x');
      return good(path);
    }, () => 'v1', 1);
    cache.preload('7', ['a', 'b', 'c'], 'a');
    await flush();
    expect(calls).toEqual(['a', 'b', 'c']);
    const idle = gated();
    const stopped = createDiffCache(idle.read, () => 'v1', 1);
    stopped.preload('7', ['a', 'b', 'c'], 'a');
    stopped.stop();
    idle.waiting[0].done();
    await flush();
    expect(idle.calls).toEqual(['a']);
  });
});

describe('opening a PR in the Lantern view', () => {
  const mounted: ReturnType<typeof mountLanternView>[] = [];
  afterEach(() => {
    for (const view of mounted.splice(0)) view.dispose();
    document.body.textContent = '';
  });

  function mount(files: string[], head: string, readPrDiff: (pr: string, path: string) => Promise<PrFileDiff>) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const data = mapOf({ nodes: files.map((f) => node(f, 'service')), prs: [pr('24', { head, files: files.map((path) => ({ path, kind: 'modified' as const, mapped: true })) })] });
    mounted.push(mountLanternView(root, data, { pr: '24', readPrDiff }));
    return root;
  }

  it('fetches every file of the PR in the background, and stepping to one adds no call', async () => {
    const files = paths(16);
    const read = vi.fn(async (_pr: string, path: string) => good(path));
    const root = mount(files, 'a'.repeat(40), read);
    openPrFile(root, files[0], 'diff');
    await flush();
    await flush();
    expect(read.mock.calls.map((c) => c[1]).sort()).toEqual([...files].sort());
    const before = read.mock.calls.length;
    openPrFile(root, files[9], 'diff');
    await flush();
    expect(read).toHaveBeenCalledTimes(before);
  });
});

describe('measured on a real repository with an 18 file branch', () => {
  let world: World;
  afterEach(() => fs.rmSync(world.dir, { recursive: true, force: true }));

  it('reaches the later files from the cache with no new diff call', async () => {
    world = makeWorld();
    const { project } = world;
    const files = Array.from({ length: 18 }, (_, i) => `src/mod${i}.ts`);
    for (const f of files) commitFile(project, f, `${'export const a = 1;\n'.repeat(400)}`, `add ${f}`);
    git(project, ['push', '-q', 'origin', 'main']);
    branchOff(project, 'feat/many');
    for (const f of files) commitFile(project, f, `${'export const a = 2;\n'.repeat(400)}`, `edit ${f}`);
    const head = git(project, ['rev-parse', 'HEAD']);
    commitRecord(project, { id: 9, branch: 'feat/many', head, files: files.map((f) => `~ ${f}`) });
    git(project, ['push', '-q', 'origin', 'feat/many']);
    git(project, ['checkout', '-q', 'main']);

    let calls = 0;
    let finished = 0;
    const service = async (id: string, path: string) => {
      calls++;
      const res = await readPrFileDiff(project, id, path);
      finished++;
      return res;
    };
    const timed = async (fn: () => Promise<unknown>) => {
      const t = performance.now();
      await fn();
      return performance.now() - t;
    };

    const without = createDiffCache(service, () => head);
    const beforeMs: number[] = [];
    for (const f of files.slice(1)) beforeMs.push(await timed(() => without.read('9', f)));
    const callsBefore = calls;

    calls = 0;
    finished = 0;
    const cache = createDiffCache(service, () => head);
    cache.preload('9', files, files[0]);
    await vi.waitFor(() => expect(finished).toBe(18), { timeout: 30_000 });
    const preloadCalls = calls;
    const afterMs: number[] = [];
    for (const f of files.slice(1)) afterMs.push(await timed(() => cache.read('9', f)));

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const avg = (xs: number[]) => (sum(xs) / xs.length).toFixed(2);
    console.log(`MEASURE files=18 stepping to files 2..18: service call every click: avg ${avg(beforeMs)} ms, total ${sum(beforeMs).toFixed(0)} ms, ${callsBefore} calls; after preload: avg ${avg(afterMs)} ms, total ${sum(afterMs).toFixed(2)} ms, ${calls - preloadCalls} new calls (${preloadCalls} background calls)`);
    expect(callsBefore).toBe(17);
    expect(preloadCalls).toBe(18);
    expect(calls).toBe(preloadCalls);
    expect(sum(afterMs)).toBeLessThan(sum(beforeMs));
  });
});
