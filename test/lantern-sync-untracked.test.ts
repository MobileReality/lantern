import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SYNC = path.join(__dirname, '..', 'skills', 'lantern-sync', 'scripts', 'sync.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-untracked-'));

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const status = (cwd: string, ...args: string[]) => execFileSync(process.execPath, [SYNC, 'status', ...args], { cwd, encoding: 'utf8' });

function makeRepo(name: string): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'README.md'), '# p\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

function addMap(dir: string): void {
  fs.mkdirSync(path.join(dir, '.lantern', 'map'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.lantern', 'map', '.lantern'), '');
}

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sync.mjs status: untracked map', () => {
  it('reports a local .lantern/ that the base commit lacks', () => {
    const dir = makeRepo('untracked');
    addMap(dir);
    expect(status(dir, '--base', 'main')).toContain('map: untracked on main');
  });

  it('stays quiet once the map is in the base commit', () => {
    const dir = makeRepo('tracked');
    addMap(dir);
    git(dir, 'add', '.lantern');
    git(dir, 'commit', '-q', '-m', 'map');
    expect(status(dir, '--base', 'main')).not.toContain('untracked');
  });
});
