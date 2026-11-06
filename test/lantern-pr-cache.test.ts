import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPrFile } from '../src/main/lantern-prfile';
import { readPrFileDiff } from '../src/main/lantern-prdiff';
import { enterPr, fetchAndWarmPrs, refreshPrData, warmPrs } from '../src/main/lantern-pr-warm';
import { dropPrCache, loadPrs, loadPrsDetailed, revalidatePrs } from '../src/main/lantern-prs';
import { branchOff, commitFile, commitRecord, git, makeWorld, mergeNoFf, prRecord, write } from './helpers/git-repo';
import type { World } from './helpers/git-repo';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const seen = vi.hoisted(() => ({ calls: [] as string[][] }));

vi.mock('../src/main/lantern-git', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/lantern-git')>();
  return {
    ...real,
    git: (project: string, args: string[], timeout?: number) => {
      seen.calls.push(args);
      return real.git(project, args, timeout);
    },
  };
});

let world: World;

const scans = () => seen.calls.filter((a) => a[0] === 'symbolic-ref' && a.includes('--short')).length;
const forget = () => {
  seen.calls.length = 0;
};

beforeEach(() => {
  world = makeWorld();
  commitFile(world.project, 'src/old.ts', 'export const old = 1;\n', 'add old');
  git(world.project, ['push', '-q', 'origin', 'main']);
  forget();
});

afterEach(() => {
  dropPrCache(world.project);
  fs.rmSync(world.dir, { recursive: true, force: true });
});

function openBranch(id: number, branch: string) {
  const { project } = world;
  branchOff(project, branch);
  commitFile(project, `src/pr${id}.ts`, `export const n = ${id};\n`, `work ${id}`);
  const head = git(project, ['rev-parse', 'HEAD']);
  commitRecord(project, { id, branch, head, files: [`+ src/pr${id}.ts`] });
  git(project, ['push', '-q', 'origin', branch]);
  git(project, ['checkout', '-q', 'main']);
  return head;
}

function mergedBranch(id: number, branch: string) {
  const { project } = world;
  branchOff(project, branch);
  commitFile(project, `src/pr${id}.ts`, `export const n = ${id};\n`, `work ${id}`);
  const head = git(project, ['rev-parse', 'HEAD']);
  commitRecord(project, { id, branch, head, files: [`+ src/pr${id}.ts`] });
  mergeNoFf(project, branch, id);
  git(project, ['push', '-q', 'origin', 'main']);
}

function pushMoreWork(branch: string, file: string) {
  const { project } = world;
  git(project, ['checkout', '-q', branch]);
  commitFile(project, file, 'export const more = 1;\n', `more on ${branch}`);
  git(project, ['push', '-q', 'origin', branch]);
  git(project, ['checkout', '-q', 'main']);
  return git(project, ['rev-parse', branch]);
}

function stackedOnMergedParent() {
  const { project } = world;
  branchOff(project, 'feat/parent', 'main');
  const parentHead = commitFile(project, 'src/parent.ts', 'export const parent = 1;\n', 'parent work');
  commitRecord(project, { id: 1, branch: 'feat/parent', head: parentHead, files: ['+ src/parent.ts'] });
  git(project, ['push', '-q', 'origin', 'feat/parent']);
  branchOff(project, 'feat/child', 'feat/parent');
  const childHead = commitFile(project, 'src/child.ts', 'export const child = 2;\n', 'child work');
  commitRecord(project, { id: 2, branch: 'feat/child', base: 'feat/parent', head: childHead, files: ['+ src/child.ts'] });
  git(project, ['push', '-q', 'origin', 'feat/child']);
  git(project, ['checkout', '-q', 'main']);
  git(project, ['merge', '-q', '--no-ff', '-m', 'Merged in feat/parent (pull request #1)', 'feat/parent']);
  git(project, ['push', '-q', 'origin', 'main']);
  git(project, ['push', '-q', 'origin', '--delete', 'feat/parent']);
  git(project, ['branch', '-q', '-D', 'feat/parent']);
  git(project, ['fetch', '-q', '--prune', 'origin']);
}

describe('the cache of loadPrsDetailed', () => {
  beforeEach(() => {
    openBranch(5, 'feat/open');
    forget();
  });

  it('answers the second call from the cache with the ref check only', async () => {
    const first = await loadPrsDetailed(world.project, new Set());
    expect(scans()).toBe(1);
    forget();

    const second = await loadPrsDetailed(world.project, new Set());

    expect(scans()).toBe(0);
    expect(seen.calls.some((a) => a[0] === 'log' || a[0] === 'merge-base' || a[0] === 'show' || a[0] === 'ls-tree')).toBe(false);
    expect(seen.calls.length).toBeLessThanOrEqual(3);
    expect(second.prs).toEqual(first.prs);
  });

  it('reads a diff and a file without scanning the pull requests again', async () => {
    await loadPrsDetailed(world.project, new Set());
    forget();

    const diff = await readPrFileDiff(world.project, '5', 'src/pr5.ts');
    const file = await readPrFile(world.project, '5', 'src/pr5.ts');

    expect(diff).toMatchObject({ ok: true });
    expect(diff.diff).toContain('+export const n = 5;');
    expect(file).toMatchObject({ ok: true });
    expect(scans()).toBe(0);
    expect(seen.calls.some((a) => a[0] === 'ls-tree' || a.includes('--grep=pull request #[0-9]+'))).toBe(false);
  });

  it('works out the revisions of a pull request once and serves them to the next read', async () => {
    await readPrFileDiff(world.project, '5', 'src/pr5.ts');
    forget();
    await readPrFileDiff(world.project, '5', 'src/pr5.ts');
    expect(seen.calls.filter((a) => a[0] === 'merge-base')).toHaveLength(0);
  });

  it('loads again when a branch tip moves', async () => {
    const before = await loadPrsDetailed(world.project, new Set());
    const tip = pushMoreWork('feat/open', 'src/more.ts');
    forget();

    const after = await loadPrsDetailed(world.project, new Set());

    expect(scans()).toBe(1);
    expect(before.prs.find((p) => p.id === '5')?.tip).not.toBe(tip);
    expect(after.prs.find((p) => p.id === '5')?.tip).toBe(tip);
  });

  it('loads again when the base moves', async () => {
    await loadPrsDetailed(world.project, new Set());
    commitFile(world.project, 'src/main-moves.ts', 'export {};\n', 'main moves');
    git(world.project, ['push', '-q', 'origin', 'main']);
    forget();
    await loadPrsDetailed(world.project, new Set());
    expect(scans()).toBe(1);
  });

  it('loads again when a record in the checked-out tree appears, changes or goes', async () => {
    await loadPrsDetailed(world.project, new Set());
    const head = git(world.project, ['rev-parse', 'HEAD']);
    forget();

    write(world.project, '.lantern/prs/9.pr', prRecord({ id: 9, branch: 'feat/nine', head }));
    const added = await loadPrsDetailed(world.project, new Set());
    expect(scans()).toBe(1);
    expect(added.prs.map((p) => p.id)).toContain('9');

    write(world.project, '.lantern/prs/9.pr', prRecord({ id: 9, branch: 'feat/nine', head, title: 'a new title' }));
    const edited = await loadPrsDetailed(world.project, new Set());
    expect(scans()).toBe(2);
    expect(edited.prs.find((p) => p.id === '9')?.title).toBe('a new title');

    fs.rmSync(path.join(world.project, '.lantern/prs/9.pr'));
    const removed = await loadPrsDetailed(world.project, new Set());
    expect(scans()).toBe(3);
    expect(removed.prs.map((p) => p.id)).not.toContain('9');
  });

  it('keeps one cache per project root', async () => {
    const other = makeWorld();
    try {
      await loadPrsDetailed(world.project, new Set());
      await loadPrsDetailed(other.project, new Set());
      expect(scans()).toBe(2);
      forget();
      await loadPrsDetailed(world.project, new Set());
      await loadPrsDetailed(other.project, new Set());
      expect(scans()).toBe(0);
    } finally {
      dropPrCache(other.project);
      fs.rmSync(other.dir, { recursive: true, force: true });
    }
  });

  it('applies the mapped files of the caller to the shared data without mutating it', async () => {
    const plain = await loadPrsDetailed(world.project, new Set());
    const mapped = await loadPrsDetailed(world.project, new Set(['src/pr5.ts']));
    expect(mapped.prs.find((p) => p.id === '5')?.files[0].mapped).toBe(true);
    expect(plain.prs.find((p) => p.id === '5')?.files[0].mapped).toBe(false);
    const again = await loadPrsDetailed(world.project, new Set());
    expect(again.prs.find((p) => p.id === '5')?.files[0].mapped).toBe(false);
    expect(scans()).toBe(1);
  });

  it('shares one load between callers that ask while it runs', async () => {
    const loads = await Promise.all([loadPrsDetailed(world.project, new Set()), loadPrsDetailed(world.project, new Set()), loadPrsDetailed(world.project, new Set())]);
    expect(scans()).toBe(1);
    expect(loads[1].prs).toEqual(loads[0].prs);
  });
});

describe('warming', () => {
  beforeEach(() => {
    openBranch(5, 'feat/open');
    mergedBranch(3, 'feat/merged');
    forget();
  });

  it('works out the revisions of open pull requests and leaves the merged ones for when they are entered', async () => {
    await warmPrs(world.project);

    const load = await loadPrsDetailed(world.project, new Set());
    const warmed = [...load.revisions.keys()].map((key) => key.split('\0')[0]);
    expect(load.prs.map((p) => `${p.id}:${p.state}`).sort()).toEqual(['3:merged', '5:open']);
    expect(warmed).toEqual(['5']);
  });

  it('reads a merged pull request only when it is entered', async () => {
    await warmPrs(world.project);
    await enterPr(world.project, '3');

    await vi.waitFor(async () => {
      const load = await loadPrsDetailed(world.project, new Set());
      expect([...load.revisions.keys()].map((key) => key.split('\0')[0]).sort()).toEqual(['3', '5']);
    });
  });

  it('never runs two warm-ups for a project at once', async () => {
    const first = warmPrs(world.project);
    const second = warmPrs(world.project);
    const third = warmPrs(world.project);

    expect(second).toBe(first);
    expect(third).toBe(first);
    await first;
    expect(scans()).toBe(1);
  });

  it('runs again after a warm-up that was asked for while one ran, and can start another once done', async () => {
    const running = warmPrs(world.project);
    pushMoreWork('feat/open', 'src/more.ts');
    void warmPrs(world.project);
    await running;
    expect(scans()).toBe(2);

    forget();
    await warmPrs(world.project);
    expect(scans()).toBe(0);
  });

  it('does not block the caller: the first diff is not waiting for the warm-up', async () => {
    const warm = warmPrs(world.project);
    const diff = await readPrFileDiff(world.project, '5', 'src/pr5.ts');
    expect(diff.ok).toBe(true);
    await warm;
    expect(scans()).toBe(1);
  });

  it('warms after a fetch', async () => {
    const fetched = await fetchAndWarmPrs(world.project, false);
    expect(fetched.ok).toBe(true);
    await vi.waitFor(async () => {
      const load = await loadPrsDetailed(world.project, new Set());
      expect([...load.revisions.keys()].map((key) => key.split('\0')[0])).toEqual(['5']);
    });
  });
});

describe('entering a pull request', () => {
  beforeEach(() => {
    openBranch(5, 'feat/open');
    forget();
  });

  it('serves the cache and reports no change while nothing moved', async () => {
    await loadPrs(world.project, new Set());
    forget();
    expect(await enterPr(world.project, '5')).toEqual({ changed: false });
    expect(scans()).toBe(0);
  });

  it('reports a change once a branch moved, so the view updates, and then settles', async () => {
    await loadPrs(world.project, new Set());
    pushMoreWork('feat/open', 'src/more.ts');
    forget();

    expect(await enterPr(world.project, '5')).toEqual({ changed: true });
    expect(scans()).toBe(1);

    await loadPrs(world.project, new Set());
    expect(await enterPr(world.project, '5')).toEqual({ changed: false });
  });

  it('does not call a ref change a data change when the pull requests came out the same', async () => {
    await loadPrs(world.project, new Set());
    git(world.project, ['branch', 'unrelated']);
    git(world.project, ['push', '-q', 'origin', 'unrelated']);
    forget();

    const revalidated = await revalidatePrs(world.project);

    expect(scans()).toBe(1);
    expect(revalidated.changed).toBe(false);
  });

  it('says nothing changed for a project the view has not loaded yet', async () => {
    expect(await enterPr(world.project, '5')).toEqual({ changed: false });
  });
});

describe('refreshPrData', () => {
  beforeEach(() => {
    openBranch(5, 'feat/open');
    forget();
  });

  it('fetches, drops the cache and reads the pull requests again even though no ref moved', async () => {
    await loadPrsDetailed(world.project, new Set());
    forget();

    const result = await refreshPrData(world.project);

    expect(result.ok).toBe(true);
    expect(scans()).toBe(1);
    forget();
    await loadPrsDetailed(world.project, new Set());
    expect(scans()).toBe(0);
  });

  it('picks up what the remote gained', async () => {
    const before = await loadPrsDetailed(world.project, new Set());
    const clone = path.join(world.dir, 'clone');
    git(world.dir, ['clone', '-q', world.origin, clone]);
    git(clone, ['checkout', '-q', 'feat/open']);
    commitFile(clone, 'src/elsewhere.ts', 'export {};\n', 'work elsewhere');
    git(clone, ['push', '-q', 'origin', 'feat/open']);
    const tip = git(clone, ['rev-parse', 'HEAD']);

    const result = await refreshPrData(world.project);

    expect(result.ok).toBe(true);
    expect(before.prs.find((p) => p.id === '5')?.tip).not.toBe(tip);
    expect((await loadPrsDetailed(world.project, new Set())).prs.find((p) => p.id === '5')?.tip).toBe(tip);
  });

  it('reports a fetch that failed and still serves what is here', async () => {
    await loadPrsDetailed(world.project, new Set());
    git(world.project, ['remote', 'set-url', 'origin', path.join(world.dir, 'gone.git')]);

    const result = await refreshPrData(world.project);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    const load = await loadPrsDetailed(world.project, new Set());
    expect(load.prs.map((p) => p.id)).toEqual(['5']);
  });
});

describe('a deleted base through the cache', () => {
  beforeEach(() => {
    stackedOnMergedParent();
    forget();
  });

  it('still resolves against the default line, from the first read and from the cached ones', async () => {
    const first = await readPrFileDiff(world.project, '2', 'src/child.ts');
    forget();
    const cached = await readPrFileDiff(world.project, '2', 'src/child.ts');

    for (const res of [first, cached]) {
      expect(res).toMatchObject({ ok: true, against: { name: 'main', source: 'default' }, recordedBase: 'feat/parent' });
      expect(res.diff).toContain('+export const child = 2;');
    }
    expect(scans()).toBe(0);
  });

  it('keeps the choice of a base working on top of the cache', async () => {
    await readPrFileDiff(world.project, '2', 'src/child.ts');
    const chosen = await readPrFileDiff(world.project, '2', 'src/child.ts', { base: 'main', branch: 'feat/child' });
    expect(chosen).toMatchObject({ ok: true, against: { name: 'main', source: 'chosen' } });
  });
});
