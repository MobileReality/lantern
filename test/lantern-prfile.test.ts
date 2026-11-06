import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPrFile, readRegisteredPrFile } from '../src/main/lantern-prfile';
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

function openBranch(id: number, branch: string, change: () => void, files?: string[]) {
  const { project } = world;
  branchOff(project, branch);
  change();
  const head = git(project, ['rev-parse', 'HEAD']);
  commitRecord(project, { id, branch, head, ...(files ? { files } : {}) });
  git(project, ['push', '-q', 'origin', branch]);
  git(project, ['checkout', '-q', 'main']);
  return head;
}

const EDITED = ['~ src/app.ts', '+ src/new.ts', '- src/old.ts'];

function editFiles() {
  const { project } = world;
  commitFile(project, 'src/app.ts', 'export {};\nexport const added = 2;\n', 'edit app');
  commitFile(project, 'src/new.ts', 'export const fresh = 1;\n', 'add new');
  git(project, ['rm', '-q', 'src/old.ts']);
  git(project, ['commit', '-q', '-m', 'drop old']);
}

describe('readPrFile on an open pull request', () => {
  beforeEach(() => {
    openBranch(5, 'feat/open', editFiles, EDITED);
  });

  it('reads an added file that is absent from the checkout from the PR branch', async () => {
    expect(fs.existsSync(path.join(world.project, 'src/new.ts'))).toBe(false);
    const res = await readPrFile(world.project, '5', 'src/new.ts');
    expect(res).toMatchObject({ ok: true, text: 'export const fresh = 1;\n', version: 'branch', binary: false, truncated: false });
  });

  it('reads a modified file as the PR leaves it', async () => {
    const res = await readPrFile(world.project, '5', 'src/app.ts');
    expect(res.text).toContain('export const added = 2;');
    expect(res.version).toBe('branch');
  });

  it('reads a removed file as it was before the PR', async () => {
    commitFile(world.project, 'src/other.ts', 'x\n', 'main moves');
    git(world.project, ['push', '-q', 'origin', 'main']);
    const res = await readPrFile(world.project, '5', 'src/old.ts');
    expect(res).toMatchObject({ ok: true, text: 'export const old = 1;\n', version: 'before' });
  });

  it('is not available for a file the version does not have', async () => {
    expect(await readPrFile(world.project, '5', 'src/nope.ts')).toMatchObject({ ok: false, text: '' });
  });
});

describe('readPrFile edge files', () => {
  it('flags a binary file', async () => {
    openBranch(
      8,
      'feat/bin',
      () => {
        fs.writeFileSync(path.join(world.project, 'logo.bin'), Buffer.from([0, 1, 2, 255, 0, 7]));
        git(world.project, ['add', 'logo.bin']);
        git(world.project, ['commit', '-q', '-m', 'binary']);
      },
      ['+ logo.bin'],
    );
    expect(await readPrFile(world.project, '8', 'logo.bin')).toMatchObject({ ok: true, binary: true, text: '' });
  });

  it('truncates an oversized file at the code view line cap', async () => {
    const big = Array.from({ length: CODE_VIEW_MAX_LINES + 500 }, (_, i) => `line ${i}`).join('\n') + '\n';
    openBranch(9, 'feat/big', () => commitFile(world.project, 'src/big.txt', big, 'big'));
    const res = await readPrFile(world.project, '9', 'src/big.txt');
    expect(res).toMatchObject({ ok: true, truncated: true });
    expect(res.text.split('\n').length).toBeLessThanOrEqual(CODE_VIEW_MAX_LINES);
  });
});

describe('readPrFile on a merged pull request', () => {
  it('works with the branch deleted, for added and removed files', async () => {
    const { project } = world;
    openBranch(12, 'feat/gone', editFiles, EDITED);
    mergeNoFf(project, 'feat/gone', 12);
    git(project, ['push', '-q', 'origin', 'main']);
    git(project, ['push', '-q', 'origin', '--delete', 'feat/gone']);
    git(project, ['fetch', '-q', '--prune', 'origin']);
    expect((await readPrFile(project, '12', 'src/new.ts')).text).toContain('fresh = 1');
    expect(await readPrFile(project, '12', 'src/old.ts')).toMatchObject({ ok: true, version: 'before', text: 'export const old = 1;\n' });
  });
});

describe('readPrFile refusals', () => {
  it('says not available for a declined pull request', async () => {
    const { project } = world;
    openBranch(13, 'feat/declined', editFiles);
    git(project, ['push', '-q', 'origin', '--delete', 'feat/declined']);
    git(project, ['fetch', '-q', '--prune', 'origin']);
    expect(await readPrFile(project, '13', 'src/app.ts')).toMatchObject({ ok: false, text: '' });
  });

  it('refuses paths that escape the project', async () => {
    openBranch(14, 'feat/paths', editFiles);
    for (const p of ['../secret', 'src/../../secret', '/etc/passwd', 'C:\\Windows\\x', 'src/a\0b', '', '..']) {
      expect(await readPrFile(world.project, '14', p), p).toMatchObject({ ok: false, text: '' });
    }
    expect((await readPrFile(world.project, '14', 'src/app.ts')).ok).toBe(true);
  });

  it('refuses a bad project, id and non-string arguments', async () => {
    expect((await readPrFile('', '5', 'a')).ok).toBe(false);
    expect((await readPrFile(world.project, '5; rm', 'a')).ok).toBe(false);
    expect((await readPrFile(world.project, 5, 'a')).ok).toBe(false);
    expect((await readPrFile(world.project, '5', { a: 1 })).ok).toBe(false);
  });

  it('refuses an unregistered project and reads a registered one', async () => {
    openBranch(15, 'feat/reg', editFiles);
    expect(await readRegisteredPrFile(() => false, world.project, '15', 'src/app.ts')).toMatchObject({ ok: false, reason: 'not a registered project' });
    expect((await readRegisteredPrFile(() => true, world.project, '15', 'src/app.ts')).ok).toBe(true);
  });
});
