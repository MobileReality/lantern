import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareCommits, compareRefs, compareStat, isLocalId, localPrs, worktreeStamp } from '../src/main/lantern-local';
import { WORKTREE, compareId } from '../src/shared/local-review';
import { readPrFileDiff } from '../src/main/lantern-prdiff';
import { readPrFile } from '../src/main/lantern-prfile';
import { branchOff, commitFile, git, makeWorld, write } from './helpers/git-repo';
import type { World } from './helpers/git-repo';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let world: World;

beforeEach(() => {
  world = makeWorld();
  commitFile(world.project, 'src/old.ts', 'export const old = 1;\n', 'add old');
  git(world.project, ['push', '-q', 'origin', 'main']);
});

afterEach(() => {
  fs.rmSync(world.dir, { recursive: true, force: true });
});

const WT = compareId('main', WORKTREE);
const solo = compareId('main', 'feat/solo');
const kinds = (files: { path: string; kind: string }[]) => Object.fromEntries(files.map((f) => [f.path, f.kind]));

describe('local review ids', () => {
  it('accepts branch, commit and working-tree points only', () => {
    expect(isLocalId(WT)).toBe(true);
    expect(isLocalId(compareId('main', 'feat/x'))).toBe(true);
    expect(isLocalId(compareId('a'.repeat(40), 'feat/x'))).toBe(true);
    expect(isLocalId(compareId(WORKTREE, 'main'))).toBe(false);
    expect(isLocalId(compareId('main', '-x'))).toBe(false);
    expect(isLocalId(compareId('a..b', 'main'))).toBe(false);
    expect(isLocalId('local:cmp:main|x|y')).toBe(false);
    expect(isLocalId('5')).toBe(false);
  });
});

describe('uncommitted changes', () => {
  beforeEach(() => {
    write(world.project, 'src/app.ts', 'export {};\nexport const edited = 1;\n');
    write(world.project, 'src/fresh.ts', 'export const fresh = 1;\n');
    fs.rmSync(path.join(world.project, 'src/old.ts'));
  });

  it('lists modified, untracked and deleted files', async () => {
    const [pr] = await localPrs(world.project, [WT], new Set(['src/app.ts']));
    expect(pr).toMatchObject({ id: WT, title: 'main → working tree', state: 'open', source: 'local', base: 'main' });
    expect(pr.tip).toBeUndefined();
    expect(kinds(pr.files)).toEqual({ 'src/app.ts': 'modified', 'src/old.ts': 'removed', 'src/fresh.ts': 'added' });
    expect(pr.files.find((f) => f.path === 'src/app.ts')?.mapped).toBe(true);
  });

  it('diffs a tracked and an untracked file against HEAD', async () => {
    const edited = await readPrFileDiff(world.project, WT, 'src/app.ts');
    expect(edited).toMatchObject({ ok: true, binary: false });
    expect(edited.diff).toContain('+export const edited = 1;');
    const fresh = await readPrFileDiff(world.project, WT, 'src/fresh.ts');
    expect(fresh.ok).toBe(true);
    expect(fresh.diff).toContain('+export const fresh = 1;');
  });

  it('measures the working tree from HEAD, not from origin/HEAD', async () => {
    git(world.project, ['remote', 'set-head', 'origin', 'main']);
    branchOff(world.project, 'feat/here');
    commitFile(world.project, 'src/here.ts', 'export const here = 1;\n', 'here');
    const [pr] = await localPrs(world.project, [compareId('HEAD', WORKTREE)], new Set());
    expect(kinds(pr.files)).toEqual({ 'src/app.ts': 'modified', 'src/old.ts': 'removed', 'src/fresh.ts': 'added' });
  });

  it('leaves the Lantern map out', async () => {
    write(world.project, '.lantern/map/src.lantern', 'changed\n');
    write(world.project, '.lantern/new.txt', 'x\n');
    const [pr] = await localPrs(world.project, [WT], new Set());
    expect(pr.files.some((f) => f.path.startsWith('.lantern/'))).toBe(false);
    expect((await compareStat(world.project, 'main', WORKTREE)).files).toBe(3);
    expect((await compareRefs(world.project)).dirty).toBe(3);
  });

  it('carries a revision that moves when an already dirty file is edited again', async () => {
    const [before] = await localPrs(world.project, [WT], new Set());
    expect(before.revision).toBeTruthy();
    write(world.project, 'src/app.ts', 'export {};\nexport const edited = 2;\n');
    const [after] = await localPrs(world.project, [WT], new Set());
    expect(after.revision).not.toBe(before.revision);
  });

  it('keeps non-ASCII paths unquoted so they can be read', async () => {
    write(world.project, 'src/zażółć.ts', 'export const z = 1;\n');
    const [pr] = await localPrs(world.project, [WT], new Set());
    expect(kinds(pr.files)['src/zażółć.ts']).toBe('added');
    expect(await readPrFile(world.project, WT, 'src/zażółć.ts')).toMatchObject({ ok: true, text: 'export const z = 1;\n' });
  });

  it('refuses to follow a symlink out of the project', async () => {
    const secret = path.join(world.dir, 'secret.txt');
    fs.writeFileSync(secret, 'top secret\n');
    fs.symlinkSync(secret, path.join(world.project, 'src/link.txt'));
    const res = await readPrFile(world.project, WT, 'src/link.txt');
    expect(res.ok).toBe(false);
    expect(res.text).toBe('');
  });

  it('changes the stamp when an already modified file is edited again', async () => {
    const before = await worktreeStamp(world.project);
    write(world.project, 'src/app.ts', 'export {};\nexport const edited = 1;\nexport const more = 2;\n');
    expect(await worktreeStamp(world.project)).not.toBe(before);
  });

  it('refuses to diff an untracked path that passes through a directory symlink out of the project', async () => {
    fs.mkdirSync(path.join(world.dir, 'secret'));
    fs.writeFileSync(path.join(world.dir, 'secret', 'key.txt'), 'TOP SECRET\n');
    fs.symlinkSync(path.join(world.dir, 'secret'), path.join(world.project, 'outside'));
    const diff = await readPrFileDiff(world.project, WT, 'outside/key.txt');
    expect(diff.ok).toBe(false);
    expect(JSON.stringify(diff)).not.toContain('TOP SECRET');
  });

  it('reads the working copy, and the HEAD copy of a deleted file', async () => {
    expect(await readPrFile(world.project, WT, 'src/app.ts')).toMatchObject({ ok: true, version: 'branch', text: 'export {};\nexport const edited = 1;\n' });
    expect(await readPrFile(world.project, WT, 'src/old.ts')).toMatchObject({ ok: true, version: 'before', text: 'export const old = 1;\n' });
  });
});

describe('a branch without a pull request', () => {
  beforeEach(() => {
    branchOff(world.project, 'feat/solo');
    commitFile(world.project, 'src/solo.ts', 'export const solo = 1;\n', 'solo');
    git(world.project, ['checkout', '-q', 'main']);
    commitFile(world.project, 'src/app.ts', 'export {};\n// main moved on\n', 'main moves');
  });

  it('compares the branch with its merge-base on main', async () => {
    const [pr] = await localPrs(world.project, [solo], new Set());
    expect(pr).toMatchObject({ title: 'main → feat/solo', base: 'main', source: 'local' });
    expect(pr.tip).toBe(git(world.project, ['rev-parse', 'feat/solo']));
    expect(kinds(pr.files)).toEqual({ 'src/solo.ts': 'added' });
    const diff = await readPrFileDiff(world.project, solo, 'src/solo.ts');
    expect(diff.diff).toContain('+export const solo = 1;');
  });

  it('resolves a branch whose name looks like a sha', async () => {
    branchOff(world.project, 'deadbee');
    commitFile(world.project, 'src/hex.ts', 'export const hex = 1;\n', 'hex');
    git(world.project, ['checkout', '-q', 'main']);
    const [pr] = await localPrs(world.project, [compareId('main', 'deadbee')], new Set());
    expect(pr.title).toBe('main → deadbee');
    expect(kinds(pr.files)).toEqual({ 'src/hex.ts': 'added' });
    expect(pr.revision).toBe(pr.tip);
  });

  it('keeps a removable, empty entry for a branch that no longer exists', async () => {
    const gone = compareId('main', 'feat/gone');
    const [pr] = await localPrs(world.project, [gone], new Set());
    expect(pr).toMatchObject({ id: gone, title: 'main → feat/gone (unavailable)', files: [], source: 'local' });
  });

  it('compares a pinned commit of the branch', async () => {
    const first = git(world.project, ['rev-parse', 'feat/solo']);
    git(world.project, ['checkout', '-q', 'feat/solo']);
    commitFile(world.project, 'src/later.ts', 'export const later = 1;\n', 'later');
    git(world.project, ['checkout', '-q', 'main']);
    const [pinned] = await localPrs(world.project, [compareId('main', first)], new Set());
    expect(kinds(pinned.files)).toEqual({ 'src/solo.ts': 'added' });
    const [tip] = await localPrs(world.project, [solo], new Set());
    expect(kinds(tip.files)).toEqual({ 'src/solo.ts': 'added', 'src/later.ts': 'added' });
  });

  it('counts files and lines before the comparison is added', async () => {
    expect(await compareStat(world.project, 'main', 'feat/solo')).toEqual({ ok: true, files: 1, add: 1, del: 0 });
    write(world.project, 'src/app.ts', 'changed\n');
    write(world.project, 'src/new.ts', 'a\nb\n');
    expect(await compareStat(world.project, 'main', WORKTREE)).toEqual({ ok: true, files: 2, add: 3, del: 2 });
    expect((await compareStat(world.project, 'main', 'feat/gone')).ok).toBe(false);
    expect((await compareStat(world.project, '-x', 'main')).ok).toBe(false);
  });

  it('defaults the base to origin/main when the local main is behind it', async () => {
    git(world.project, ['push', '-q', 'origin', 'main']);
    git(world.project, ['fetch', '-q', 'origin']);
    git(world.project, ['checkout', '-q', 'feat/solo']);
    git(world.project, ['branch', '-q', '-f', 'main', 'main~1']);
    const refs = await compareRefs(world.project);
    expect(refs.base).toBe('origin/main');
    expect(refs.branches.map((b) => b.name)).toEqual(expect.arrayContaining(['main', 'origin/main', 'feat/solo']));
    expect(refs.branches.filter((b) => b.name === 'feat/solo')).toHaveLength(1);
  });

  it('lists branches with the default and current one, and commits of a branch', async () => {
    write(world.project, 'src/dirty.ts', 'x\n');
    const refs = await compareRefs(world.project);
    expect(refs).toMatchObject({ base: 'origin/main', current: 'main', dirty: 1 });
    expect(refs.branches.map((b) => b.name)).toEqual(expect.arrayContaining(['main', 'feat/solo']));
    const commits = await compareCommits(world.project, 'feat/solo');
    expect(commits[0]).toMatchObject({ subject: 'solo', sha: git(world.project, ['rev-parse', 'feat/solo']) });
    expect(await compareCommits(world.project, '--all')).toEqual([]);
  });
});
