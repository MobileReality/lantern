import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkoutRoot, checkoutTop, isWithin, resolveRoot } from '../src/main/projectroot';

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-root-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function repo(name: string) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.git', 'worktrees'), { recursive: true });
  return dir;
}

function linkedWorktree(main: string, dir: string, gitdir: string) {
  fs.mkdirSync(path.join(main, '.git', 'worktrees', path.basename(dir)), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${gitdir}\n`);
}

describe('isWithin', () => {
  it('matches the folder itself and descendants, not siblings sharing a prefix', () => {
    expect(isWithin('/repo', '/repo')).toBe(true);
    expect(isWithin('/repo/src', '/repo/')).toBe(true);
    expect(isWithin('/repo-two', '/repo')).toBe(false);
  });
});

describe('checkoutRoot', () => {
  it('maps a .claude worktree (and its subdirs) to the repo that owns it', () => {
    expect(checkoutRoot('/work/repo/.claude/worktrees/agent-x')).toBe('/work/repo');
    expect(checkoutRoot('/work/repo/.claude/worktrees/agent-x/src/app')).toBe('/work/repo');
  });

  it('maps a subdir of a checkout to its toplevel', () => {
    const main = repo('main');
    fs.mkdirSync(path.join(main, 'src', 'lib'), { recursive: true });
    expect(checkoutRoot(path.join(main, 'src', 'lib'))).toBe(main);
    expect(checkoutRoot(main)).toBe(main);
  });

  it('maps a linked worktree to its main checkout, absolute or relative gitdir', () => {
    const main = repo('main');
    const abs = path.join(tmp, 'elsewhere', 'feature');
    linkedWorktree(main, abs, path.join(main, '.git', 'worktrees', 'feature'));
    expect(checkoutRoot(path.join(abs, 'src'))).toBe(main);
    const rel = path.join(tmp, 'rel');
    linkedWorktree(main, rel, '../main/.git/worktrees/rel');
    expect(checkoutRoot(rel)).toBe(main);
  });

  it('keeps a submodule as its own root and a plain folder as itself', () => {
    const sub = path.join(repo('main'), 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../.git/modules/sub\n');
    expect(checkoutRoot(sub)).toBe(sub);
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    expect(checkoutRoot(plain)).toBe(plain);
  });
});

describe('resolveRoot', () => {
  const project = '/Users/me/repo';

  it('resolves a subdir and a subagent worktree to the opened project root', () => {
    expect(resolveRoot(project, [project])).toBe(project);
    expect(resolveRoot(`${project}/src/lib`, [project])).toBe(project);
    expect(resolveRoot(`${project}/.claude/worktrees/agent-x`, [project])).toBe(project);
  });

  it('prefers the closest opened root so nested projects stay separate', () => {
    const nested = `${project}/packages/app`;
    expect(resolveRoot(`${nested}/src`, [project, nested])).toBe(nested);
    expect(resolveRoot(`${project}/tools`, [project, nested])).toBe(project);
  });

  it('keeps a worktree the user opened as its own project', () => {
    const wt = `${project}/.claude/worktrees/feature`;
    expect(resolveRoot(`${wt}/src`, [project, wt])).toBe(wt);
    const main = repo('main');
    const linked = path.join(tmp, 'repo-feature');
    linkedWorktree(main, linked, path.join(main, '.git', 'worktrees', 'repo-feature'));
    expect(resolveRoot(path.join(linked, 'src'), [main, linked])).toBe(linked);
  });

  it('never targets a subagent worktree saved as a project by an older build', () => {
    const stale = `${project}/.claude/worktrees/agent-x`;
    expect(resolveRoot(`${stale}/src`, [project, stale])).toBe(project);
  });

  it('falls back to the owning checkout, not to unrelated ancestors', () => {
    expect(resolveRoot(`${project}/.claude/worktrees/agent-x`, [])).toBe(project);
    const plain = path.join(tmp, 'foo');
    fs.mkdirSync(plain);
    expect(resolveRoot(plain, [])).toBe(plain);
  });
});

describe('checkoutTop', () => {
  it('keeps a linked worktree as its own checkout', () => {
    const main = repo('main');
    const wt = path.join(tmp, 'wt');
    linkedWorktree(main, wt, path.join(main, '.git', 'worktrees', 'wt'));
    expect(checkoutTop(wt)).toBe(wt);
  });

  it('maps a subdir of a linked worktree to the worktree top', () => {
    const main = repo('main');
    const wt = path.join(tmp, 'wt');
    linkedWorktree(main, wt, path.join(main, '.git', 'worktrees', 'wt'));
    expect(checkoutTop(path.join(wt, 'src'))).toBe(wt);
  });

  it('maps a subdir of a plain repo to its toplevel', () => {
    const main = repo('main');
    fs.mkdirSync(path.join(main, 'src'));
    expect(checkoutTop(path.join(main, 'src'))).toBe(main);
  });

  it('keeps a folder outside any repo as is', () => {
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    expect(checkoutTop(plain)).toBe(plain);
  });
});
