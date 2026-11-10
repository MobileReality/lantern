import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { numstatOf, readPrFileStats, readRegisteredPrFileStats } from '../src/main/lantern-prdiff';
import { branchOff, commitFile, commitRecord, git, makeWorld } from './helpers/git-repo';
import type { World } from './helpers/git-repo';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let world: World;

beforeEach(() => {
  world = makeWorld();
  commitFile(world.project, 'src/old.ts', 'export const old = 1;\n', 'add old');
  git(world.project, ['push', '-q', 'origin', 'main']);
  branchOff(world.project, 'feat/open');
  commitFile(world.project, 'src/app.ts', 'export {};\nexport const added = 2;\n', 'edit app');
  commitFile(world.project, 'src/new.ts', 'export const fresh = 1;\nexport const two = 2;\n', 'add new');
  git(world.project, ['rm', '-q', 'src/old.ts']);
  git(world.project, ['commit', '-q', '-m', 'drop old']);
  const head = git(world.project, ['rev-parse', 'HEAD']);
  commitRecord(world.project, { id: 5, branch: 'feat/open', head });
  git(world.project, ['push', '-q', 'origin', 'feat/open']);
  git(world.project, ['checkout', '-q', 'main']);
});

afterEach(() => {
  fs.rmSync(world.dir, { recursive: true, force: true });
});

describe('numstatOf', () => {
  it('reads -z entries and skips binary files', () => {
    expect(numstatOf('3\t1\tsrc/a.ts\0-\t-\timg.png\0' + '0\t2\tdir with space/b.ts\0')).toEqual({
      'src/a.ts': { added: 3, removed: 1 },
      'dir with space/b.ts': { added: 0, removed: 2 },
    });
  });
});

describe('readPrFileStats', () => {
  it('counts added and removed lines per file of an open pull request against the merge-base', async () => {
    commitFile(world.project, 'src/app.ts', 'export {};\n// main moved on\n', 'main moves');
    git(world.project, ['push', '-q', 'origin', 'main']);
    expect(await readPrFileStats(world.project, '5')).toEqual({
      '.lantern/prs/5.pr': expect.any(Object),
      'src/app.ts': { added: 1, removed: 0 },
      'src/new.ts': { added: 2, removed: 0 },
      'src/old.ts': { added: 0, removed: 1 },
    });
  });

  it('returns nothing for a bad id, an unknown pull request or an unregistered project', async () => {
    expect(await readPrFileStats(world.project, '../5')).toEqual({});
    expect(await readPrFileStats(world.project, '77')).toEqual({});
    expect(await readRegisteredPrFileStats(() => false, world.project, '5')).toEqual({});
  });
});
