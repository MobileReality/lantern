import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../src/main/lantern';
import { branchOff, commitFile, commitRecord, git, makeWorld, mergeNoFf } from './helpers/git-repo';
import type { World } from './helpers/git-repo';

let world: World;

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

beforeEach(() => {
  world = makeWorld();
});

afterEach(() => {
  fs.rmSync(world.dir, { recursive: true, force: true });
});

function stackedMergeThenDelete(id: number, date?: string) {
  const { project } = world;
  branchOff(project, 'chore/x');
  commitFile(project, 'src/x.ts', 'export const x = 1;\n', 'base work', date);
  git(project, ['push', '-q', 'origin', 'chore/x']);
  branchOff(project, 'feat/stacked', 'chore/x');
  const head = commitFile(project, 'src/stacked.ts', 'export const s = 1;\n', 'stacked work', date);
  commitRecord(project, { id, branch: 'feat/stacked', base: 'chore/x', head }, date);
  git(project, ['push', '-q', 'origin', 'feat/stacked']);
  git(project, ['checkout', '-q', 'chore/x']);
  git(project, ['merge', '-q', '--no-ff', '-m', `Merged in feat/stacked (pull request #${id})`, 'feat/stacked'], date);
  git(project, ['checkout', '-q', 'main']);
  git(project, ['merge', '-q', '--no-ff', '-m', `Merged in chore/x (pull request #${id - 1})`, 'chore/x'], date);
  git(project, ['push', '-q', 'origin', 'main']);
  git(project, ['push', '-q', 'origin', '--delete', 'chore/x', 'feat/stacked']);
  git(project, ['branch', '-q', '-D', 'chore/x', 'feat/stacked']);
  git(project, ['fetch', '-q', '--prune', 'origin']);
  return head;
}

describe('lantern.load merge detection through the default line', () => {
  it('counts a PR as merged when its base branch was merged into main and deleted', async () => {
    stackedMergeThenDelete(37);
    expect(git(world.project, ['branch', '-a'])).not.toContain('chore/x');

    const map = await load(world.project);

    expect(map.prs).toMatchObject([{ id: '37', base: 'chore/x', state: 'merged' }]);
  });

  it('finds the merge by its message when the head is not an ancestor (squash style)', async () => {
    const { project } = world;
    commitRecord(project, { id: 70, branch: 'feat/squashed', base: 'chore/gone', head: 'c'.repeat(40) });
    commitFile(project, 'src/sq.ts', 'export {};\n', 'Merged in feat/squashed (pull request #70)\n\nsquash body');
    git(project, ['push', '-q', 'origin', 'main']);

    const map = await load(project);

    expect(map.prs).toMatchObject([{ id: '70', state: 'merged' }]);
  });

  it('takes mergedAt from the merge commit', async () => {
    stackedMergeThenDelete(37, '2026-09-20T10:00:00Z');

    const map = await load(world.project);

    expect(new Date(map.prs[0].mergedAt as string).toISOString()).toBe('2026-09-20T10:00:00.000Z');
  });

  it('takes mergedAt from the first commit after the head when only ancestry shows the merge', async () => {
    const { project } = world;
    const head = git(project, ['rev-parse', 'HEAD']);
    commitRecord(project, { id: 71, branch: 'feat/ff', base: 'chore/gone', head }, '2026-09-22T08:30:00Z');
    commitFile(project, 'src/after.ts', 'export {};\n', 'after', '2026-09-25T08:30:00Z');
    commitFile(project, 'src/later.ts', 'export {};\n', 'later', '2026-09-29T08:30:00Z');
    git(project, ['push', '-q', 'origin', 'main']);

    const map = await load(project);

    expect(map.prs[0].state).toBe('merged');
    expect(new Date(map.prs[0].mergedAt as string).toISOString()).toBe('2026-09-22T08:30:00.000Z');
  });

  it('does not call a PR merged because a stacked branch that contains it is checked out', async () => {
    const { project } = world;
    branchOff(project, 'feat/lower');
    const head = commitFile(project, 'src/lower.ts', 'export {};\n', 'lower');
    commitRecord(project, { id: 74, branch: 'feat/lower', head });
    git(project, ['push', '-q', 'origin', 'feat/lower']);
    branchOff(project, 'feat/upper', 'feat/lower');
    commitFile(project, 'src/upper.ts', 'export {};\n', 'upper');

    const map = await load(project);

    expect(map.prs).toMatchObject([{ id: '74', state: 'open' }]);
  });

  it('marks a PR declined (closed) when its branch is gone and nothing mentions it', async () => {
    commitRecord(world.project, { id: 72, branch: 'feat/dropped', base: 'chore/gone', head: 'd'.repeat(40) });
    git(world.project, ['push', '-q', 'origin', 'main']);

    const map = await load(world.project);

    expect(map.prs).toMatchObject([{ id: '72', state: 'closed' }]);
    expect(map.prs[0].mergedAt).toBeUndefined();
  });

  it('keeps a map-only PR open when its head is already on the base and its branch is unmerged', async () => {
    const { project } = world;
    const head = git(project, ['rev-parse', 'HEAD']);
    branchOff(project, 'chore/map-only');
    commitRecord(project, { id: 75, branch: 'chore/map-only', head });
    git(project, ['push', '-q', 'origin', 'chore/map-only']);
    git(project, ['checkout', '-q', 'main']);
    commitFile(project, 'src/other.ts', 'export {};\n', 'later main work');
    git(project, ['push', '-q', 'origin', 'main']);

    const map = await load(project);

    expect(map.prs).toMatchObject([{ id: '75', state: 'open' }]);
    expect(map.prs[0].mergedAt).toBeUndefined();
  });

  it('marks a map-only PR merged once a Merged in commit for it lands on the base', async () => {
    const { project } = world;
    const head = git(project, ['rev-parse', 'HEAD']);
    branchOff(project, 'chore/map-only');
    commitRecord(project, { id: 76, branch: 'chore/map-only', head });
    git(project, ['push', '-q', 'origin', 'chore/map-only']);
    mergeNoFf(project, 'chore/map-only', 76);
    git(project, ['push', '-q', 'origin', 'main']);

    const map = await load(project);

    expect(map.prs).toMatchObject([{ id: '76', state: 'merged' }]);
  });

  it('does not treat the record commit message on its own branch as a merge', async () => {
    const { project } = world;
    branchOff(project, 'feat/live');
    const head = commitFile(project, 'src/live.ts', 'export {};\n', 'work');
    commitRecord(project, { id: 73, branch: 'feat/live', head });
    commitFile(project, 'src/more.ts', 'export {};\n', 'chore: record pull request #73 in the map');
    git(project, ['push', '-q', 'origin', 'feat/live']);

    const map = await load(project);

    expect(map.prs).toMatchObject([{ id: '73', state: 'open' }]);
    expect(map.prs[0].mergedAt).toBeUndefined();
  });
});
