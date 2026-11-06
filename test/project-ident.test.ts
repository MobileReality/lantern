import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectIdent } from '../src/main/project-ident';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ident-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('projectIdent', () => {
  it('names a plain checkout by its folder and its branch, with no worktree', () => {
    const root = path.join(dir, 'lantern');
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/feat/top-bar\n');
    expect(projectIdent(root)).toEqual({ name: 'lantern', branch: 'feat/top-bar', worktree: '' });
  });

  it('names a linked worktree by its main checkout and shows the worktree', () => {
    const main = path.join(dir, 'lantern');
    const wt = path.join(main, '.git', 'worktrees', 'command-palette');
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, 'HEAD'), 'ref: refs/heads/loop/command-palette\n');
    const root = path.join(main, '.claude', 'worktrees', 'command-palette');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, '.git'), `gitdir: ${wt}\n`);
    expect(projectIdent(root)).toEqual({ name: 'lantern', branch: 'loop/command-palette', worktree: 'command-palette' });
  });

  it('leaves the git part empty outside a repository and for bad input', () => {
    expect(projectIdent(dir)).toEqual({ name: path.basename(dir), branch: '', worktree: '' });
    expect(projectIdent(null)).toEqual({ name: '', branch: '', worktree: '' });
  });
});
