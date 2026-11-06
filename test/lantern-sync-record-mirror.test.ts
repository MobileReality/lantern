import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, makeTmp, write } from './helpers/git-repo';
import { REPO, removeDir, runSync } from './helpers/lantern-plan-world';

let lib: { hashFile: (root: string, rel: string) => string };
let main: string;
let worktree: string;

const BRANCH = 'feat/change-b';
const RECORD = '.lantern/local/feat__change-b.branch';
const REASON = 'Moves b to 2 so the caller gets the new default.';

const FLOW = [
  {
    title: 'A caller gets the new default',
    steps: [
      { kind: 'actor', text: 'The caller' },
      { kind: 'action', text: 'asks for b' },
      { kind: 'subject', text: 'the helper', files: ['src/b.ts'] },
    ],
    below: [{ kind: 'consequence', old: 'b answered 1', new: 'b answers 2' }],
  },
];
const DESCRIBE = { what: ['b answers 2 now.'], before: ['b answered 1.'], after: ['b answers 2.'], verified: ['The unit tests pass.'] };

function writeMap(root: string) {
  const hashOfA = lib.hashFile(root, 'src/a.ts');
  const hashOfB = lib.hashFile(root, 'src/b.ts');
  write(root, '.lantern/map/src.lantern', `lantern 1\n# src\n\nsrc/a.ts . service ${hashOfA}\n#feature core\n  = src/b.ts\nsrc/b.ts . util ${hashOfB}\n#feature core\n`);
}

function commitAll(root: string, message: string, ...paths: string[]) {
  git(root, ['add', ...paths]);
  git(root, ['commit', '-q', '-m', message]);
}

function buildWorld() {
  main = makeTmp('lantern-mirror-main-');
  write(main, 'src/a.ts', 'export const a = 1;\n');
  write(main, 'src/b.ts', 'export const b = 1;\n');
  write(main, '.lantern/features', 'core\n');
  write(main, '.lantern/lang/en/features.json', '{"text":{"core":"the core"}}\n');
  write(main, '.lantern/lang/en/src.lantern.json', '{"text":{"a.ts":"entry","b.ts":"helper","a.ts = src/b.ts":"calls"}}\n');
  writeMap(main);
  git(main, ['init', '-q', '-b', 'main']);
  write(main, '.git/info/exclude', '.ai/tmp/\n.claude/worktrees/\n');
  commitAll(main, 'base', '.');
  worktree = path.join(main, '.claude', 'worktrees', 'agent-1');
  git(main, ['worktree', 'add', '-q', '-b', BRANCH, worktree, 'main']);
  write(worktree, 'src/b.ts', 'export const b = 2;\n');
  commitAll(worktree, 'change b', 'src/b.ts');
  writeMap(worktree);
  commitAll(worktree, 'chore: update the Lantern map', '.lantern');
}

function writeRecord() {
  write(worktree, '.ai/tmp/order.json', JSON.stringify(['src/b.ts']));
  write(worktree, '.ai/tmp/flow.json', JSON.stringify(FLOW));
  write(worktree, '.ai/tmp/describe.json', JSON.stringify(DESCRIBE));
  return runSync(worktree, 'pr', '--base', 'main', '--branch', BRANCH, '--reason', `src/b.ts=${REASON}`, '--order-file', '.ai/tmp/order.json', '--flow-file', '.ai/tmp/flow.json', '--describe-file', '.ai/tmp/describe.json');
}

const verifyAll = () => runSync(worktree, 'verify', '--base', 'main', '--require-pr', '--require-reason', '--require-order', '--require-flow', '--branch', BRANCH);

beforeEach(async () => {
  lib = await import(pathToFileURL(path.join(REPO, 'skills', 'lantern-setup', 'scripts', 'lib.mjs')).href);
  buildWorld();
});

afterEach(() => {
  removeDir(main);
});

describe('a branch record written in a linked worktree', () => {
  it('is in the project checkout the moment sync.mjs pr writes it, with no carry', () => {
    const run = writeRecord();
    expect(run.status, run.stderr).toBe(0);
    expect(fs.existsSync(path.join(main, RECORD))).toBe(true);
    expect(fs.readFileSync(path.join(main, RECORD), 'utf8')).toBe(fs.readFileSync(path.join(worktree, RECORD), 'utf8'));
    expect(fs.readFileSync(path.join(main, RECORD), 'utf8')).toContain(`#reason src/b.ts ${REASON}`);
    expect(git(main, ['check-ignore', RECORD])).toBe(RECORD);
    git(main, ['add', '.lantern']);
    expect(git(main, ['ls-files', '--', '.lantern/local'])).toBe('');
  });

  it('survives the worktree being removed', () => {
    expect(writeRecord().status).toBe(0);
    git(main, ['worktree', 'remove', '--force', worktree]);
    expect(fs.readFileSync(path.join(main, RECORD), 'utf8')).toContain(`#branch ${BRANCH}`);
  });

  it('makes verify red until the project holds an identical copy', () => {
    expect(writeRecord().status).toBe(0);
    expect(verifyAll().status).toBe(0);
    fs.unlinkSync(path.join(main, RECORD));
    const missing = verifyAll();
    expect(missing.status).toBe(1);
    expect(missing.stdout).toMatch(/has no identical copy/);
    expect(missing.stdout).toContain('sync.mjs carry');
    expect(runSync(main, 'carry', '--from', worktree, '--branch', BRANCH).status).toBe(0);
    expect(verifyAll().status).toBe(0);
    write(main, RECORD, `${fs.readFileSync(path.join(main, RECORD), 'utf8')}#summary stale\n`);
    expect(verifyAll().status).toBe(1);
  });

  it('is removed from the project when a pull request adopts it', () => {
    expect(writeRecord().status).toBe(0);
    expect(fs.existsSync(path.join(main, RECORD))).toBe(true);
    const run = runSync(worktree, 'pr', '301', '--url', 'https://example.test/301', '--title', 'Change b', '--base', 'main', '--branch', BRANCH);
    expect(run.status, run.stderr).toBe(0);
    expect(fs.existsSync(path.join(main, RECORD))).toBe(false);
    expect(fs.existsSync(path.join(worktree, RECORD))).toBe(false);
  });
});
