import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGraph } from '../src/main/lantern';
import { loadPrOverlay, loadRegisteredPrOverlay, overlayCacheSize } from '../src/main/lantern-proverlay';
import { branchOff, commitFile, commitRecord, git, mergeNoFf, write } from './helpers/git-repo';
import type { World } from './helpers/git-repo';
import { makeWorld } from './helpers/git-repo';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let world: World;

beforeEach(() => {
  world = makeWorld();
});

afterEach(() => {
  fs.rmSync(world.dir, { recursive: true, force: true });
});

const SRC_MAP = [
  'lantern 1',
  '# src',
  '',
  'src/app.ts . service 111111111111',
  '  > src/new.ts | uses the cache',
  'src/new.ts . util 222222222222 | cache helper',
  '  < src/app.ts | called by app',
  '',
].join('\n');

const LIB_MAP = ['lantern 1', '# lib', '', 'lib/extra.ts . util 333333333333 | extra helper', '  > src/app.ts | reads app', ''].join('\n');

function srcLang(purpose: string) {
  return JSON.stringify({ model: 'claude-sonnet-5-5', text: { 'new.ts': purpose, 'app.ts': 'app entry, now cached', 'app.ts > src/new.ts': 'uses the cache' } });
}

function openBranch(id: number, branch: string, extra: () => void = () => undefined, files = ['~ src/app.ts', '+ src/new.ts', '+ lib/extra.ts', '+ lib/nomap.ts']) {
  const { project } = world;
  branchOff(project, branch);
  commitFile(project, 'src/new.ts', 'export const cache = 1;\n', 'add new');
  commitFile(project, 'lib/extra.ts', 'export const extra = 1;\n', 'add extra');
  commitFile(project, 'lib/nomap.ts', 'export const nomap = 1;\n', 'add nomap');
  extra();
  const head = git(project, ['rev-parse', 'HEAD']);
  commitRecord(project, { id, branch, head, files });
  git(project, ['push', '-q', 'origin', branch]);
  git(project, ['checkout', '-q', 'main']);
  return head;
}

function mapRecords() {
  const { project } = world;
  write(project, '.lantern/map/src.lantern', SRC_MAP);
  write(project, '.lantern/map/lib.lantern', LIB_MAP);
  write(project, '.lantern/lang/en/src.lantern.json', srcLang('cache helper for reads'));
  git(project, ['add', '.lantern']);
  git(project, ['commit', '-q', '-m', 'map the change']);
}

describe('loadPrOverlay on an open pull request', () => {
  beforeEach(() => {
    openBranch(9, 'feat/cache', mapRecords);
  });

  it('turns the branch records of the added files into nodes marked new', async () => {
    const ov = await loadPrOverlay(world.project, '9');
    const added = ov.nodes.filter((n) => n.prNew).map((n) => n.path);
    expect(added.sort()).toEqual(['lib/extra.ts', 'src/new.ts']);
    const created = ov.nodes.find((n) => n.path === 'src/new.ts');
    expect(created).toMatchObject({ role: 'util', hash: '222222222222', marker: '.', freshness: 'fresh', dir: 'src', prNew: true });
    expect(ov.tip).toBe(git(world.project, ['rev-parse', 'refs/remotes/origin/feat/cache']));
  });

  it('reads the texts from the branch language file and falls back to the inline text', async () => {
    const ov = await loadPrOverlay(world.project, '9');
    expect(ov.nodes.find((n) => n.path === 'src/new.ts')?.purpose).toBe('cache helper for reads');
    expect(ov.nodes.find((n) => n.path === 'lib/extra.ts')?.purpose).toBe('extra helper');
    expect(ov.relations.find((r) => r.from === 'src/app.ts')?.label).toBe('uses the cache');
  });

  it('carries relations to files that exist in the working tree and to other new files', async () => {
    const ov = await loadPrOverlay(world.project, '9');
    const targets = ov.relations.map((r) => `${r.from} ${r.arrow} ${r.to}`).sort();
    expect(targets).toEqual(['lib/extra.ts > src/app.ts', 'src/app.ts > src/new.ts', 'src/new.ts < src/app.ts']);
  });

  it('returns the branch version of a modified file without marking it new', async () => {
    const ov = await loadPrOverlay(world.project, '9');
    const modified = ov.nodes.find((n) => n.path === 'src/app.ts');
    expect(modified).toMatchObject({ hash: '111111111111' });
    expect(modified?.prNew).toBeUndefined();
  });

  it('names a file whose record is missing on the branch instead of inventing a node', async () => {
    const ov = await loadPrOverlay(world.project, '9');
    expect(ov.missing).toEqual(['lib/nomap.ts']);
    expect(ov.nodes.some((n) => n.path === 'lib/nomap.ts')).toBe(false);
  });

  it('never leaks into the normal graph, whose map still comes from the working tree', async () => {
    await loadPrOverlay(world.project, '9');
    const graph = await loadGraph(world.project);
    expect(graph.nodes.map((n) => n.path)).toEqual(['src/app.ts']);
    expect(graph.nodes[0].hash).toBe('000000000000');
    expect(graph.relations).toEqual([]);
    expect(graph.nodes.every((n) => !n.prNew)).toBe(true);
  });

  it('exposes the branch tip on the open pull request so the view can key its cache', async () => {
    const graph = await loadGraph(world.project);
    const open = graph.prs.find((p) => p.id === '9');
    expect(open?.tip).toBe(git(world.project, ['rev-parse', 'refs/remotes/origin/feat/cache']));
  });

  it('caches by branch tip and reads again only when the branch moves', async () => {
    const first = await loadPrOverlay(world.project, '9');
    const again = await loadPrOverlay(world.project, '9');
    expect(again).toBe(first);
    const size = overlayCacheSize();
    git(world.project, ['checkout', '-q', 'feat/cache']);
    write(world.project, '.lantern/lang/en/src.lantern.json', srcLang('cache helper, reworded'));
    git(world.project, ['add', '.lantern']);
    git(world.project, ['commit', '-q', '-m', 'reword']);
    git(world.project, ['push', '-q', 'origin', 'feat/cache']);
    git(world.project, ['checkout', '-q', 'main']);
    const moved = await loadPrOverlay(world.project, '9');
    expect(moved).not.toBe(first);
    expect(moved.tip).not.toBe(first.tip);
    expect(moved.nodes.find((n) => n.path === 'src/new.ts')?.purpose).toBe('cache helper, reworded');
    expect(overlayCacheSize()).toBe(size + 1);
  });

  it('keeps one overlay per pull request when the user switches between them', async () => {
    openBranch(
      10,
      'feat/other',
      () => {
        write(world.project, '.lantern/map/lib.lantern', LIB_MAP);
        git(world.project, ['add', '.lantern']);
        git(world.project, ['commit', '-q', '-m', 'map lib']);
      },
      ['+ lib/extra.ts'],
    );
    const a = await loadPrOverlay(world.project, '9');
    const b = await loadPrOverlay(world.project, '10');
    expect(a.prId).toBe('9');
    expect(b.prId).toBe('10');
    expect(b.nodes.map((n) => n.path)).toEqual(['lib/extra.ts']);
    expect(a.nodes.length).toBeGreaterThan(b.nodes.length);
    expect(await loadPrOverlay(world.project, '9')).toBe(a);
  });
});

describe('loadPrOverlay when there is nothing to overlay', () => {
  it('is empty for a merged pull request, whose files the working tree already holds', async () => {
    openBranch(9, 'feat/cache', mapRecords);
    mergeNoFf(world.project, 'feat/cache', 9);
    git(world.project, ['push', '-q', 'origin', 'main']);
    const ov = await loadPrOverlay(world.project, '9');
    expect(ov.nodes).toEqual([]);
    expect(ov.relations).toEqual([]);
  });

  it('is empty for a declined pull request whose branch is gone', async () => {
    openBranch(9, 'feat/cache', mapRecords);
    commitFile(world.project, 'src/app.ts', 'export {};\n// edit\n', 'main moves');
    const record = git(world.project, ['show', 'origin/feat/cache:.lantern/prs/9.pr']);
    write(world.project, '.lantern/prs/9.pr', `${record}\n`);
    git(world.project, ['add', '.lantern']);
    git(world.project, ['commit', '-q', '-m', 'keep the record in the tree']);
    git(world.project, ['push', '-q', 'origin', ':feat/cache']);
    git(world.project, ['fetch', '-q', '--prune', 'origin']);
    expect((await loadGraph(world.project)).prs.find((p) => p.id === '9')?.state).toBe('closed');
    expect((await loadPrOverlay(world.project, '9')).nodes).toEqual([]);
  });

  it('is empty for an unknown pull request, a bad id and an unregistered project', async () => {
    openBranch(9, 'feat/cache', mapRecords);
    expect((await loadPrOverlay(world.project, '404')).nodes).toEqual([]);
    expect((await loadPrOverlay(world.project, '../9')).nodes).toEqual([]);
    expect((await loadPrOverlay('', '9')).nodes).toEqual([]);
    expect((await loadRegisteredPrOverlay(() => false, world.project, '9')).nodes).toEqual([]);
    expect((await loadRegisteredPrOverlay(() => true, world.project, '9')).nodes.length).toBeGreaterThan(0);
  });

  it('gives a branch that carries no map record for its added files an empty overlay naming them', async () => {
    openBranch(11, 'feat/bare', () => undefined, ['+ src/new.ts']);
    const ov = await loadPrOverlay(world.project, '11');
    expect(ov.nodes).toEqual([]);
    expect(ov.missing).toEqual(['src/new.ts']);
  });
});
