import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localPrs, recordReasons } from '../src/main/lantern-local';
import { WORKTREE, compareId } from '../src/shared/local-review';
import { commitFile, git } from './helpers/git-repo';

const SYNC = path.join(__dirname, '..', 'skills', 'lantern-sync', 'scripts', 'sync.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-sync-local-'));
const repo = path.join(tmp, 'repo');
const WT = compareId('main', WORKTREE);

function sync(...args: string[]) {
  const run = spawnSync(process.execPath, [SYNC, ...args], { cwd: repo, encoding: 'utf8' });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

function reasonFile(name: string, value: unknown) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

beforeAll(() => {
  fs.mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  commitFile(repo, 'src/app.ts', 'export {};\n', 'base');
  git(repo, ['checkout', '-q', '-b', 'feat/x']);
  commitFile(repo, 'src/x.ts', 'export const x = 1;\n', 'feat: x');
  git(repo, ['checkout', '-q', 'main']);
  fs.mkdirSync(path.join(repo, '.lantern', 'map'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.lantern', 'map', '.lantern'), '');
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export {};\nexport const edited = 1;\n');
  fs.writeFileSync(path.join(repo, 'src', 'fresh.ts'), 'export const fresh = 1;\n');
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sync.mjs local', () => {
  it('writes the reasons of the working tree into an ignored .lantern/local record the app reads', async () => {
    const run = sync('local', '--base', 'main', '--reason-file', reasonFile('wt.json', { 'src/app.ts': 'Exports the edited flag the panel reads.' }), '--reason', 'src/fresh.ts=Adds the constant the new view needs.');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('wrote .lantern/local/main__worktree.reason: 2/2');
    expect(run.stdout).toContain('lantern --compare main');
    const text = fs.readFileSync(path.join(repo, '.lantern', 'local', 'main__worktree.reason'), 'utf8');
    expect(text.split('\n').slice(0, 3)).toEqual(['lantern-local 1', '#base main', `#head ${WORKTREE}`]);
    expect(text).toMatch(/^#reason src\/app\.ts [0-9a-f]{40}:\d+:[\d.]+ Exports the edited flag the panel reads\.$/m);
    expect(fs.readFileSync(path.join(repo, '.lantern', 'local', '.gitignore'), 'utf8')).toBe('*\n');
    expect(git(repo, ['check-ignore', '.lantern/local/main__worktree.reason']).trim()).toBe('.lantern/local/main__worktree.reason');

    const [pr] = await localPrs(repo, [WT], new Set(), recordReasons(repo));
    expect(pr.files.find((f) => f.path === 'src/app.ts')?.reason).toBe('Exports the edited flag the panel reads.');
    expect(pr.files.find((f) => f.path === 'src/fresh.ts')?.reason).toBe('Adds the constant the new view needs.');

    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export {};\nexport const edited = 2;\n');
    const [again] = await localPrs(repo, [WT], new Set(), recordReasons(repo));
    expect(again.files.find((f) => f.path === 'src/app.ts')?.reason).toBeUndefined();
    expect(again.files.find((f) => f.path === 'src/fresh.ts')?.reason).toBe('Adds the constant the new view needs.');
  });

  it('keys a branch comparison by its tip and keeps partial reasons', async () => {
    const run = sync('local', '--base', 'main', '--head', 'feat/x', '--reason', 'src/x.ts=Introduces x for the feature.');
    expect(run.status, run.stderr).toBe(0);
    const [pr] = await localPrs(repo, [compareId('main', 'feat/x')], new Set(), recordReasons(repo));
    expect(pr.files).toEqual([{ path: 'src/x.ts', kind: 'added', mapped: false, reason: 'Introduces x for the feature.' }]);
  });

  it('refuses a path outside the comparison, a run with no reason, and leaves status and verify untouched', () => {
    expect(sync('local', '--base', 'main', '--reason', 'src/nope.ts=Nothing.').status).toBe(2);
    expect(sync('local', '--base', 'main', '--head', 'main').status).toBe(1);
    const status = sync('status', '--base', 'main');
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).not.toContain('.lantern/local');
  });
});
