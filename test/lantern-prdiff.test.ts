import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPrFileDiff, readRegisteredPrFileDiff } from '../src/main/lantern-prdiff';
import { resolvePrRevisions } from '../src/main/lantern-pr-revisions';
import { loadPrsDetailed } from '../src/main/lantern-prs';
import { CODE_VIEW_MAX_LINES } from '../src/shared/code-preview';
import { branchOff, commitFile, commitRecord, git, makeWorld, mergeNoFf } from './helpers/git-repo';
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

function openBranch(id: number, branch: string, change: () => void) {
  const { project } = world;
  branchOff(project, branch);
  change();
  const head = git(project, ['rev-parse', 'HEAD']);
  commitRecord(project, { id, branch, head });
  git(project, ['push', '-q', 'origin', branch]);
  git(project, ['checkout', '-q', 'main']);
  return head;
}

function editFiles() {
  const { project } = world;
  commitFile(project, 'src/app.ts', 'export {};\nexport const added = 2;\n', 'edit app');
  commitFile(project, 'src/new.ts', 'export const fresh = 1;\n', 'add new');
  git(project, ['rm', '-q', 'src/old.ts']);
  git(project, ['commit', '-q', '-m', 'drop old']);
}

describe('readPrFileDiff on an open pull request', () => {
  beforeEach(() => {
    openBranch(5, 'feat/open', editFiles);
  });

  it('shows a modified file against the merge-base', async () => {
    commitFile(world.project, 'src/app.ts', 'export {};\n// main moved on\n', 'main moves');
    git(world.project, ['push', '-q', 'origin', 'main']);
    const res = await readPrFileDiff(world.project, '5', 'src/app.ts');
    expect(res).toMatchObject({ ok: true, truncated: false, binary: false });
    expect(res.diff).toContain('+export const added = 2;');
    expect(res.diff).not.toContain('main moved on');
  });

  it('shows an added file as all additions', async () => {
    const res = await readPrFileDiff(world.project, '5', 'src/new.ts');
    expect(res.diff).toContain('new file mode');
    expect(res.diff).toContain('+export const fresh = 1;');
  });

  it('shows a removed file as all deletions', async () => {
    const res = await readPrFileDiff(world.project, '5', 'src/old.ts');
    expect(res.diff).toContain('-export const old = 1;');
  });

  it('shows a rename as a removal of the old path and an addition of the new one', async () => {
    const { project } = world;
    branchOff(project, 'feat/rename');
    git(project, ['mv', 'src/old.ts', 'src/renamed.ts']);
    git(project, ['commit', '-q', '-m', 'rename']);
    const head = git(project, ['rev-parse', 'HEAD']);
    commitRecord(project, { id: 6, branch: 'feat/rename', head, files: ['- src/old.ts', '+ src/renamed.ts'] });
    git(project, ['push', '-q', 'origin', 'feat/rename']);
    git(project, ['checkout', '-q', 'main']);
    const gone = await readPrFileDiff(project, '6', 'src/old.ts');
    const added = await readPrFileDiff(project, '6', 'src/renamed.ts');
    expect(gone.diff).toContain('deleted file mode');
    expect(gone.diff).not.toContain('rename from');
    expect(added.diff).toContain('new file mode');
    expect(added.diff).toContain('+export const old = 1;');
  });
});

describe('readPrFileDiff edge files', () => {
  it('flags a binary file without a diff body', async () => {
    const { project } = world;
    branchOff(project, 'feat/bin');
    fs.writeFileSync(path.join(project, 'logo.bin'), Buffer.from([0, 1, 2, 255, 0, 7, 9, 0]));
    git(project, ['add', 'logo.bin']);
    git(project, ['commit', '-q', '-m', 'binary']);
    const head = git(project, ['rev-parse', 'HEAD']);
    commitRecord(project, { id: 8, branch: 'feat/bin', head, files: ['+ logo.bin'] });
    git(project, ['push', '-q', 'origin', 'feat/bin']);
    git(project, ['checkout', '-q', 'main']);
    expect(await readPrFileDiff(project, '8', 'logo.bin')).toMatchObject({ ok: true, binary: true, diff: '' });
  });

  it('truncates an oversized diff at the code view line cap', async () => {
    const big = Array.from({ length: CODE_VIEW_MAX_LINES + 500 }, (_, i) => `line ${i}`).join('\n') + '\n';
    openBranch(9, 'feat/big', () => commitFile(world.project, 'src/big.txt', big, 'big'));
    const res = await readPrFileDiff(world.project, '9', 'src/big.txt');
    expect(res).toMatchObject({ ok: true, truncated: true, binary: false });
    expect(res.diff.split('\n').length).toBeLessThanOrEqual(CODE_VIEW_MAX_LINES);
  });

  it('carries every unchanged line of a file so the viewer can expand collapsed context', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `const v${i} = ${i};`);
    commitFile(world.project, 'src/long.ts', `${lines.join('\n')}\n`, 'long');
    git(world.project, ['push', '-q', 'origin', 'main']);
    openBranch(11, 'feat/long', () => commitFile(world.project, 'src/long.ts', `${lines.map((l, i) => (i === 40 ? 'const v40 = 400;' : l)).join('\n')}\n`, 'edit long'));
    const res = await readPrFileDiff(world.project, '11', 'src/long.ts');
    expect(res).toMatchObject({ ok: true, truncated: false });
    expect(res.diff).toContain(' const v0 = 0;');
    expect(res.diff).toContain(' const v79 = 79;');
    expect(res.diff.match(/^@@/gm)).toHaveLength(1);
  });

  it('falls back to three lines of context when a whole-file diff would be cut off', async () => {
    const lines = Array.from({ length: CODE_VIEW_MAX_LINES + 400 }, (_, i) => `line ${i}`);
    commitFile(world.project, 'src/huge.txt', `${lines.join('\n')}\n`, 'huge');
    git(world.project, ['push', '-q', 'origin', 'main']);
    const edited = lines.map((l, i) => (i === lines.length - 5 ? 'changed near the end' : l));
    openBranch(12, 'feat/huge', () => commitFile(world.project, 'src/huge.txt', `${edited.join('\n')}\n`, 'edit huge'));
    const res = await readPrFileDiff(world.project, '12', 'src/huge.txt');
    expect(res).toMatchObject({ ok: true, truncated: false });
    expect(res.diff).toContain('+changed near the end');
    expect(res.diff.split('\n').length).toBeLessThan(40);
  });
});

describe('readPrFileDiff on a merged pull request', () => {
  it('diffs a merge commit against its first parent, ignoring later main changes', async () => {
    const { project } = world;
    openBranch(10, 'feat/merged', editFiles);
    commitFile(project, 'src/other.ts', 'export {};\n', 'main moves on');
    mergeNoFf(project, 'feat/merged', 10);
    commitFile(project, 'src/app.ts', 'export {};\nexport const added = 2;\n// later\n', 'later');
    git(project, ['push', '-q', 'origin', 'main']);
    const res = await readPrFileDiff(project, '10', 'src/app.ts');
    expect(res.ok).toBe(true);
    expect(res.diff).toContain('+export const added = 2;');
    expect(res.diff).not.toContain('later');
  });

  it('diffs a pull request merged by fast-forward through the last change to the file', async () => {
    const { project } = world;
    openBranch(11, 'feat/ff', editFiles);
    git(project, ['merge', '-q', '--ff-only', 'feat/ff']);
    git(project, ['push', '-q', 'origin', 'main']);
    const res = await readPrFileDiff(project, '11', 'src/app.ts');
    expect(res.ok).toBe(true);
    expect(res.diff).toContain('+export const added = 2;');
  });

  it('works for a merged pull request whose branch was deleted', async () => {
    const { project } = world;
    openBranch(12, 'feat/gone', editFiles);
    mergeNoFf(project, 'feat/gone', 12);
    git(project, ['push', '-q', 'origin', 'main']);
    git(project, ['push', '-q', 'origin', '--delete', 'feat/gone']);
    git(project, ['fetch', '-q', '--prune', 'origin']);
    expect((await readPrFileDiff(project, '12', 'src/new.ts')).diff).toContain('+export const fresh = 1;');
  });
});

describe('readPrFileDiff refusals', () => {
  it('says not available for a declined pull request', async () => {
    const { project } = world;
    openBranch(13, 'feat/declined', editFiles);
    git(project, ['push', '-q', 'origin', '--delete', 'feat/declined']);
    git(project, ['fetch', '-q', '--prune', 'origin']);
    expect(await readPrFileDiff(project, '13', 'src/app.ts')).toMatchObject({ ok: false, diff: '' });
  });

  it('is not available for an unknown pull request', async () => {
    expect((await readPrFileDiff(world.project, '99', 'src/app.ts')).ok).toBe(false);
  });

  it('refuses paths that escape the project', async () => {
    openBranch(14, 'feat/paths', editFiles);
    for (const p of ['../secret', 'src/../../secret', '/etc/passwd', 'C:\\Windows\\x', 'src/a\0b', '', '..']) {
      expect(await readPrFileDiff(world.project, '14', p), p).toMatchObject({ ok: false, diff: '' });
    }
    expect((await readPrFileDiff(world.project, '14', 'src/app.ts')).ok).toBe(true);
  });

  it('refuses a bad project, a bad id and non-string arguments', async () => {
    expect((await readPrFileDiff('', '5', 'src/app.ts')).ok).toBe(false);
    expect((await readPrFileDiff(world.project, '5; rm', 'src/app.ts')).ok).toBe(false);
    expect((await readPrFileDiff(world.project, 5, 'src/app.ts')).ok).toBe(false);
    expect((await readPrFileDiff(null, '5', 'src/app.ts')).ok).toBe(false);
    expect((await readPrFileDiff(world.project, '5', { a: 1 })).ok).toBe(false);
  });

  it('refuses a project that is not registered, and reads one that is', async () => {
    openBranch(15, 'feat/reg', editFiles);
    const refused = await readRegisteredPrFileDiff(() => false, world.project, '15', 'src/app.ts');
    expect(refused).toMatchObject({ ok: false, reason: 'not a registered project' });
    const seen: string[] = [];
    const ok = await readRegisteredPrFileDiff((dir) => (seen.push(dir), true), world.project, '15', 'src/app.ts');
    expect(seen).toEqual([world.project]);
    expect(ok.ok).toBe(true);
  });
});

function stackedOnMergedParent(mergeInto = 'main') {
  const { project } = world;
  branchOff(project, 'feat/parent', mergeInto);
  const parentHead = commitFile(project, 'src/parent.ts', 'export const parent = 1;\n', 'parent work');
  commitRecord(project, { id: 1, branch: 'feat/parent', head: parentHead, files: ['+ src/parent.ts'] });
  git(project, ['push', '-q', 'origin', 'feat/parent']);
  branchOff(project, 'feat/child', 'feat/parent');
  const childHead = commitFile(project, 'src/child.ts', 'export const child = 2;\n', 'child work');
  commitRecord(project, { id: 2, branch: 'feat/child', base: 'feat/parent', head: childHead, files: ['+ src/child.ts'] });
  git(project, ['push', '-q', 'origin', 'feat/child']);
  git(project, ['checkout', '-q', mergeInto]);
  git(project, ['merge', '-q', '--no-ff', '-m', 'Merged in feat/parent (pull request #1)', 'feat/parent']);
  git(project, ['push', '-q', 'origin', mergeInto]);
  git(project, ['push', '-q', 'origin', '--delete', 'feat/parent']);
  git(project, ['branch', '-q', '-D', 'feat/parent']);
  git(project, ['fetch', '-q', '--prune', 'origin']);
}

describe('readPrFileDiff when the recorded base branch was deleted', () => {
  it('shows a stacked pull request whose parent was merged and pruned against the default line', async () => {
    stackedOnMergedParent();

    const child = await readPrFileDiff(world.project, '2', 'src/child.ts');
    const parentFile = await readPrFileDiff(world.project, '2', 'src/parent.ts');

    expect(child).toMatchObject({ ok: true, against: { name: 'main', source: 'default' }, recordedBase: 'feat/parent' });
    expect(child.diff).toContain('+export const child = 2;');
    expect(parentFile).toMatchObject({ ok: true, diff: '' });
  });

  it('leaves a pull request whose recorded base still exists without a fallback note', async () => {
    openBranch(5, 'feat/plain', editFiles);
    const res = await readPrFileDiff(world.project, '5', 'src/app.ts');
    expect(res.ok).toBe(true);
    expect(res).not.toHaveProperty('against');
  });

  it('compares against the base the host reports before the default line', async () => {
    const { project } = world;
    branchOff(project, 'develop');
    commitFile(project, 'src/dev.ts', 'export const dev = 1;\n', 'develop moves');
    git(project, ['push', '-q', 'origin', 'develop']);
    stackedOnMergedParent('develop');
    const load = await loadPrsDetailed(project, new Set());
    const child = load.prs.find((p) => p.id === '2')!;

    const fromDefault = await resolvePrRevisions(project, child, load);
    const fromHost = await resolvePrRevisions(project, { ...child, hostBase: 'develop' }, load);

    expect(fromDefault?.against).toEqual({ name: 'main', source: 'default' });
    expect(fromHost?.against).toEqual({ name: 'develop', source: 'host' });
    expect(fromHost?.before).toBe(git(project, ['rev-parse', 'origin/develop^2']));
    expect(fromDefault?.before).not.toBe(fromHost?.before);
  });

  it('ignores a host base that is not available locally and falls through to the default line', async () => {
    stackedOnMergedParent();
    const load = await loadPrsDetailed(world.project, new Set());
    const child = load.prs.find((p) => p.id === '2')!;
    const revisions = await resolvePrRevisions(world.project, { ...child, hostBase: 'feat/also-gone' }, load);
    expect(revisions?.against).toEqual({ name: 'main', source: 'default' });
  });
});

describe('readPrFileDiff when no base can be found', () => {
  function withoutDefaultLine() {
    const { project } = world;
    branchOff(project, 'feat/other');
    commitFile(project, 'src/other.ts', 'export const other = 1;\n', 'other work');
    git(project, ['push', '-q', 'origin', 'feat/other']);
    branchOff(project, 'feat/lost', 'main');
    const head = commitFile(project, 'src/lost.ts', 'export const lost = 1;\n', 'lost work');
    commitRecord(project, { id: 7, branch: 'feat/lost', base: 'feat/gone', head, files: ['+ src/lost.ts'] });
    git(project, ['push', '-q', 'origin', 'feat/lost']);
    git(project, ['branch', '-q', '-D', 'main']);
    git(project, ['update-ref', '-d', 'refs/remotes/origin/main']);
  }

  it('says why and carries the candidate bases and branches', async () => {
    withoutDefaultLine();
    const res = await readPrFileDiff(world.project, '7', 'src/lost.ts');
    expect(res).toMatchObject({ ok: false, diff: '', recordedBase: 'feat/gone' });
    expect(res.reason).toContain('feat/gone');
    expect(res.candidates?.bases).toEqual(expect.arrayContaining(['feat/other', 'feat/lost']));
    expect(res.candidates?.branches[0]).toBe('feat/lost');
    expect(res.candidates?.branches).toContain('feat/other');
  });

  it('shows the diff against the two sides the user chose, and says so', async () => {
    withoutDefaultLine();
    const res = await readPrFileDiff(world.project, '7', 'src/lost.ts', { base: 'feat/other', branch: 'feat/lost' });
    expect(res).toMatchObject({ ok: true, against: { name: 'feat/other', source: 'chosen' } });
    expect(res.diff).toContain('+export const lost = 1;');
  });

  it('does not take a chosen side that is not a listed branch', async () => {
    withoutDefaultLine();
    for (const base of ['--output=/tmp/x', 'feat/never-existed', 'HEAD~1']) {
      const res = await readPrFileDiff(world.project, '7', 'src/lost.ts', { base, branch: 'feat/lost' });
      expect(res.ok, base).toBe(false);
    }
  });
});
