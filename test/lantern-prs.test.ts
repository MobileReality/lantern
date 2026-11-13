import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPrs, load } from '../src/main/lantern';
import { MAX_BRANCHES, remoteCacheSize } from '../src/main/lantern-pr-remote';
import { branchOff, commitFile, commitRecord, git, makeTmp, makeWorld, mergeNoFf, prRecord, write } from './helpers/git-repo';
import type { World } from './helpers/git-repo';
import { FLOW_STORY, FLOW_STORY_VALUE } from './helpers/lantern-flow-cases';

const FIXTURES = path.join(__dirname, 'fixtures', 'lantern-prs');
let world: World;

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

beforeEach(() => {
  world = makeWorld();
});

afterEach(() => {
  fs.rmSync(world.dir, { recursive: true, force: true });
});

function pushBranchWithRecord(branch: string, id: number, extra: Partial<Parameters<typeof prRecord>[0]> = {}, date?: string) {
  const { project } = world;
  branchOff(project, branch);
  const head = git(project, ['rev-parse', 'HEAD']);
  const first = commitFile(project, `src/${branch.replace(/\W/g, '-')}.ts`, `export const x = ${id};\n`, `work ${id}`, date);
  commitRecord(project, { id, branch, head: first, ...extra }, date);
  git(project, ['push', '-q', 'origin', branch]);
  git(project, ['checkout', '-q', 'main']);
  return { base: head, head: first };
}

describe('lantern.load pull requests from git', () => {
  it('returns a remote-only record as an open PR with its files and mapped flags', async () => {
    pushBranchWithRecord('feat/open', 30, { files: ['+ src/new.ts', '~ src/app.ts', '- src/old.ts'] });
    expect(fs.existsSync(path.join(world.project, '.lantern/prs/30.pr'))).toBe(false);

    const map = await load(world.project);

    expect(map.warnings).toEqual([]);
    expect(map.prs).toHaveLength(1);
    expect(map.prs[0]).toMatchObject({
      id: '30',
      branch: 'feat/open',
      base: 'main',
      state: 'open',
      source: 'remote',
      title: 'pr 30',
      url: 'https://example.test/pull-requests/30',
    });
    expect(map.prs[0].files).toEqual([
      { path: 'src/new.ts', kind: 'added', mapped: false },
      { path: 'src/app.ts', kind: 'modified', mapped: true },
      { path: 'src/old.ts', kind: 'removed', mapped: false },
    ]);
  });

  it('carries a #reason reason onto its file and leaves the other files without one', async () => {
    pushBranchWithRecord('feat/why', 31, { files: ['+ src/new.ts', '~ src/app.ts', '#reason src/app.ts Wire the new flag through.', '#reason src/new.ts ' + 'x'.repeat(161)] });

    const map = await load(world.project);

    expect(map.warnings).toEqual([]);
    expect(map.prs[0].files).toEqual([
      { path: 'src/new.ts', kind: 'added', mapped: false },
      { path: 'src/app.ts', kind: 'modified', mapped: true, reason: 'Wire the new flag through.' },
    ]);
  });

  it('carries the description of a record onto the pull request and leaves a record without one bare', async () => {
    pushBranchWithRecord('feat/describe', 35, { files: ['~ src/app.ts', '#describe what Adds a flag.', '#describe verified <!-- note --> Tests green.'] });
    pushBranchWithRecord('feat/bare', 36, { files: ['~ src/app.ts'] });

    const map = await load(world.project);

    expect(map.prs.find((p) => p.id === '35')?.description).toEqual({ what: ['Adds a flag.'], verified: ['Tests green.'] });
    expect(map.prs.find((p) => p.id === '36')).not.toHaveProperty('description');
  });

  it('carries the flow of a record onto the pull request the app already loads', async () => {
    pushBranchWithRecord('feat/flow', 34, { files: ['~ src/app.ts', ...FLOW_STORY] });

    const map = await load(world.project);

    expect(map.warnings).toEqual([]);
    expect(map.prs[0].flow).toEqual([FLOW_STORY_VALUE]);
    expect(map.prs[0].flowError).toBeUndefined();
  });

  it('carries the files a step points at onto the pull request, in the order written', async () => {
    pushBranchWithRecord('feat/flowfiles', 36, { files: ['~ src/app.ts', '+ src/new.ts', '#story s', '#step actor A', '#file src/new.ts', '#file src/app.ts', '#step action does'] });

    const map = await load(world.project);

    expect(map.warnings).toEqual([]);
    expect(map.prs[0].flowError).toBeUndefined();
    expect(map.prs[0].flow?.[0].steps[0].files).toEqual(['src/new.ts', 'src/app.ts']);
    expect(map.prs[0].flow?.[0].steps[1]).not.toHaveProperty('files');
  });

  it('shows a pull request whose step points at a file it does not change, without the flow and with the reason', async () => {
    pushBranchWithRecord('feat/flowghost', 37, { files: ['~ src/app.ts', '#story s', '#step actor A', '#file src/ghost.ts'] });

    const map = await load(world.project);

    expect(map.prs[0].files).toHaveLength(1);
    expect(map.prs[0].flow).toBeUndefined();
    expect(map.prs[0].flowError).toMatch(/#file names src\/ghost\.ts, which is not a file line of this record/);
  });

  it('shows a pull request whose flow is malformed, without the flow and with the reason', async () => {
    pushBranchWithRecord('feat/badflow', 35, { files: ['~ src/app.ts', '#story s', '#step person Admin'] });

    const map = await load(world.project);

    expect(map.prs[0].files).toHaveLength(1);
    expect(map.prs[0].flow).toBeUndefined();
    expect(map.prs[0].flowError).toMatch(/unknown kind "person"/);
  });

  it('lists the files in review order and flags the pull request ordered', async () => {
    pushBranchWithRecord('feat/ordered', 32, { files: ['+ src/new.ts', '~ src/app.ts', '- src/old.ts', '#order src/old.ts', '#order src/app.ts'] });

    const map = await load(world.project);

    expect(map.prs[0].ordered).toBe(true);
    expect(map.prs[0].files.map((f) => f.path)).toEqual(['src/old.ts', 'src/app.ts', 'src/new.ts']);
  });

  it('leaves a pull request without #order lines unflagged', async () => {
    pushBranchWithRecord('feat/plain', 33, { files: ['+ src/new.ts', '~ src/app.ts'] });

    const map = await load(world.project);

    expect('ordered' in map.prs[0]).toBe(false);
  });

  it('reports a merged PR as merged, not open, even while its branch is still on origin', async () => {
    const { project } = world;
    pushBranchWithRecord('feat/done', 31);
    mergeNoFf(project, 'feat/done', 31);
    git(project, ['push', '-q', 'origin', 'main']);
    expect(git(world.origin, ['branch', '--list', 'feat/done'])).toContain('feat/done');

    const map = await load(project);

    expect(map.prs.map((p) => [p.id, p.state, p.source])).toEqual([['31', 'merged', 'tree']]);
  });

  it('marks a PR merged when its head is an ancestor of the base, with no merge message', async () => {
    const { project } = world;
    const head = git(project, ['rev-parse', 'HEAD']);
    commitRecord(project, { id: 32, branch: 'feat/rebased', head });
    git(project, ['push', '-q', 'origin', 'main']);
    git(project, ['push', '-q', 'origin', 'main:refs/heads/feat/rebased']);

    const map = await load(project);

    expect(map.prs).toMatchObject([{ id: '32', state: 'merged' }]);
  });

  it('marks an unmerged tree record whose branch is gone as closed', async () => {
    const { project } = world;
    commitRecord(project, { id: 33, branch: 'feat/abandoned', head: 'a'.repeat(40) });

    const map = await load(project);

    expect(map.prs).toMatchObject([{ id: '33', state: 'closed', source: 'tree' }]);
  });

  it('derives all three states at once and sorts open first, then newest first', async () => {
    const { project } = world;
    commitRecord(project, { id: 40, branch: 'feat/abandoned', head: 'b'.repeat(40), opened: '2026-09-27' });
    pushBranchWithRecord('feat/merged', 41, { opened: '2026-09-28' });
    mergeNoFf(project, 'feat/merged', 41);
    git(project, ['push', '-q', 'origin', 'main']);
    pushBranchWithRecord('feat/open-old', 42, { opened: '2026-09-25' });
    pushBranchWithRecord('feat/open-new', 43, { opened: '2026-09-29' });

    const map = await load(project);

    expect(map.prs.map((p) => `${p.id}:${p.state}`)).toEqual(['43:open', '42:open', '41:merged', '40:closed']);
  });

  it('lets the working tree win when the same record exists on a remote branch', async () => {
    const { project } = world;
    pushBranchWithRecord('feat/both', 34);
    git(project, ['checkout', '-q', 'feat/both']);

    const map = await load(project);

    expect(map.prs).toMatchObject([{ id: '34', state: 'open', source: 'tree' }]);
  });

  it('prefers the record on origin when the checked-out copy records an older head of the same pull request', async () => {
    const { project } = world;
    const { head: stale } = pushBranchWithRecord('feat/ahead', 37);
    git(project, ['checkout', '-q', 'feat/ahead']);
    const newer = commitFile(project, 'src/more.ts', 'export const more = 1;\n', 'more work');
    commitRecord(project, { id: 37, branch: 'feat/ahead', head: newer });
    git(project, ['push', '-q', 'origin', 'feat/ahead']);
    git(project, ['reset', '-q', '--hard', 'HEAD~2']);
    expect(fs.readFileSync(path.join(project, '.lantern/prs/37.pr'), 'utf8')).toContain(`#head ${stale}`);

    const map = await load(project);

    expect(map.prs).toMatchObject([{ id: '37', state: 'open', source: 'remote', head: newer }]);
  });

  it('skips a malformed record and reports it in warnings without dropping the good ones', async () => {
    const { project } = world;
    pushBranchWithRecord('feat/bad', 35);
    git(project, ['checkout', '-q', 'feat/bad']);
    write(project, '.lantern/prs/36.pr', 'lantern-pr 1\n# 99\n');
    git(project, ['add', '.']);
    git(project, ['commit', '-q', '-m', 'bad remote record']);
    git(project, ['push', '-q', 'origin', 'feat/bad']);
    git(project, ['checkout', '-q', 'main']);
    write(project, '.lantern/prs/26.pr', fs.readFileSync(path.join(FIXTURES, 'bad.pr'), 'utf8'));

    const map = await load(project);

    expect(map.prs.map((p) => p.id)).toEqual(['35']);
    expect(map.warnings.some((w) => w.startsWith('.lantern/prs/26.pr:') && w.includes('missing #url'))).toBe(true);
    expect(map.warnings.some((w) => w.startsWith('origin/feat/bad:.lantern/prs/36.pr:') && w.includes('does not match'))).toBe(true);
  });

  it('loads the reference fixtures as tree records', async () => {
    const { project } = world;
    for (const name of ['24.pr', '25.pr', 'bad.pr']) write(project, `.lantern/prs/${name}`, fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

    const map = await load(project);

    expect(map.prs.map((p) => p.id)).toEqual(['24', '25']);
    expect(map.prs.find((p) => p.id === '25')?.files[0]).toEqual({ path: 'docs/my notes #50.md', kind: 'added', mapped: false });
    expect(map.warnings).toHaveLength(1);
  });

  it('carries the plan items a record ticks onto the pull request', async () => {
    const { project } = world;
    const head = git(project, ['rev-parse', 'HEAD']);
    write(project, '.lantern/prs/40.pr', prRecord({ id: 40, branch: 'feat/plan-item', head, files: ['#plan add-planning s1.1', '#plan add-planning s1.2', '~ src/app.ts'] }));
    write(project, '.lantern/prs/41.pr', prRecord({ id: 41, branch: 'feat/no-plan', head }));

    const map = await load(project);

    expect(map.prs.find((p) => p.id === '40')?.plans).toEqual([{ slug: 'add-planning', item: 's1.1' }, { slug: 'add-planning', item: 's1.2' }]);
    expect(map.prs.find((p) => p.id === '41')).not.toHaveProperty('plans');
  });

  it('returns prs [] without warnings for a non-git project', async () => {
    const dir = makeTmp('ccm-lantern-nogit-');
    try {
      write(dir, '.lantern/map/src.lantern', 'lantern 1\n# src\n\nsrc/app.ts . service 000000000000 | app entry\n');
      write(dir, '.lantern/prs/24.pr', fs.readFileSync(path.join(FIXTURES, '24.pr'), 'utf8'));
      const map = await load(dir);
      expect(map.exists).toBe(true);
      expect(map.prs).toEqual([]);
      expect(map.warnings).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns prs [] without warnings for a git project with no origin', async () => {
    const { project } = world;
    git(project, ['remote', 'remove', 'origin']);
    write(project, '.lantern/prs/24.pr', fs.readFileSync(path.join(FIXTURES, '24.pr'), 'utf8'));

    const map = await load(project);

    expect(map.prs).toEqual([]);
    expect(map.warnings).toEqual([]);
  });

  it('returns prs on a project that has no map yet', async () => {
    const { project } = world;
    git(project, ['rm', '-q', '-r', '.lantern/map']);
    git(project, ['commit', '-q', '-m', 'drop map']);
    pushBranchWithRecord('feat/unmapped', 37);
    write(project, '.lantern/prs/26.pr', fs.readFileSync(path.join(FIXTURES, 'bad.pr'), 'utf8'));

    const map = await load(project);

    expect(map.exists).toBe(false);
    expect(map.prs).toMatchObject([{ id: '37', state: 'open' }]);
    expect(map.warnings).toHaveLength(1);
  });

  it('ignores records nested in subfolders of .lantern/prs on a remote branch', async () => {
    const { project } = world;
    branchOff(project, 'feat/nested');
    const head = commitFile(project, 'src/nested.ts', 'export {};\n', 'work');
    commitFile(project, '.lantern/prs/sub/77.pr', prRecord({ id: 77, branch: 'feat/nested', head }), 'nested record');
    git(project, ['push', '-q', 'origin', 'feat/nested']);
    git(project, ['checkout', '-q', 'main']);

    const map = await load(project);

    expect(map.prs).toEqual([]);
    expect(map.warnings).toEqual([]);
  });

  it('examines only the newest branches and says so', async () => {
    const { project } = world;
    pushBranchWithRecord('rec/old', 50, {}, '2000-01-01T00:00:00Z');
    const filler = commitFile(project, 'src/filler.ts', 'export {};\n', 'filler', '2029-01-01T00:00:00Z');
    git(project, ['branch', 'filler-src', filler]);
    for (let i = 0; i < MAX_BRANCHES; i++) git(project, ['branch', `fill/b${i}`, 'filler-src']);
    git(project, ['push', '-q', 'origin', 'refs/heads/fill/*:refs/heads/fill/*']);
    git(project, ['reset', '-q', '--hard', 'HEAD~1']);
    pushBranchWithRecord('rec/new', 51, {}, '2030-01-01T00:00:00Z');

    const map = await load(project);

    expect(map.prs.map((p) => p.id)).toEqual(['51']);
    expect(map.warnings.some((w) => w.includes(`${MAX_BRANCHES} newest remote branches`))).toBe(true);
  });

  it('caches branch records by ref sha and re-reads a branch whose sha moved', async () => {
    pushBranchWithRecord('feat/cached', 52);
    const before = remoteCacheSize();
    const first = await load(world.project);
    const afterFirst = remoteCacheSize();
    const second = await load(world.project);
    expect(afterFirst).toBe(before + 1);
    expect(remoteCacheSize()).toBe(afterFirst);
    expect(second.prs).toEqual(first.prs);

    git(world.project, ['checkout', '-q', 'feat/cached']);
    commitFile(world.project, 'src/more.ts', 'export {};\n', 'more');
    git(world.project, ['push', '-q', 'origin', 'feat/cached']);
    git(world.project, ['checkout', '-q', 'main']);
    await load(world.project);
    expect(remoteCacheSize()).toBe(afterFirst + 1);
  });
});

describe('fetchPrs', () => {
  it('fetches a branch pushed to origin by someone else, and keeps its pull request as closed once the branch is deleted', async () => {
    const other = path.join(world.dir, 'other');
    git(world.dir, ['clone', '-q', world.origin, other]);
    branchOff(other, 'feat/theirs');
    const head = commitFile(other, 'src/theirs.ts', 'export {};\n', 'theirs');
    commitRecord(other, { id: 60, branch: 'feat/theirs', head });
    git(other, ['push', '-q', 'origin', 'feat/theirs']);

    expect((await load(world.project)).prs).toEqual([]);
    expect(await fetchPrs(world.project)).toEqual({ ok: true });
    expect((await load(world.project)).prs).toMatchObject([{ id: '60', state: 'open', source: 'remote' }]);

    git(other, ['push', '-q', 'origin', '--delete', 'feat/theirs']);
    expect(await fetchPrs(world.project)).toEqual({ ok: true });
    const { prs } = await load(world.project);
    expect(prs).toMatchObject([{ id: '60', state: 'closed', source: 'remote' }]);
    expect(prs[0]).not.toHaveProperty('tip');
    expect(Number.isFinite(Date.parse(prs[0].closedAt as string))).toBe(true);
  });

  it('returns ok:false instead of throwing for a non-git dir, a missing origin and bad input', async () => {
    const dir = makeTmp('ccm-lantern-nogit-');
    try {
      expect((await fetchPrs(dir)).ok).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect((await fetchPrs(path.join(world.dir, 'does-not-exist'))).ok).toBe(false);
    expect((await fetchPrs(42)).ok).toBe(false);
    expect((await fetchPrs('')).ok).toBe(false);
    git(world.project, ['remote', 'set-url', 'origin', path.join(world.dir, 'gone.git')]);
    const res = await fetchPrs(world.project);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('load itself never fetches', async () => {
    const other = path.join(world.dir, 'other');
    git(world.dir, ['clone', '-q', world.origin, other]);
    branchOff(other, 'feat/unseen');
    const head = commitFile(other, 'src/unseen.ts', 'export {};\n', 'unseen');
    commitRecord(other, { id: 61, branch: 'feat/unseen', head });
    git(other, ['push', '-q', 'origin', 'feat/unseen']);

    await load(world.project);

    expect(git(world.project, ['branch', '-r'])).not.toContain('feat/unseen');
  });
});
