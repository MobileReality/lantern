import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const userData = vi.hoisted(() => {
  const o = require('node:os');
  const p = require('node:path');
  const f = require('node:fs');
  return f.mkdtempSync(p.join(o.tmpdir(), 'ccm-ud-'));
});
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

import * as skills from '../src/main/skills';

let repo: string;
let project: string;

function makeSkill(role: string, name: string) {
  const dir = path.join(repo, role, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}`);
}

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-repo-'));
  fs.mkdirSync(path.join(repo, '.git'));
  makeSkill('core', 'foo');
  makeSkill('nextjs', 'bar');
  const res = (await skills.clone(repo)) as { ok: boolean; adopted?: boolean };
  expect(res.ok).toBe(true);
  expect(res.adopted).toBe(true);
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
});

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skp-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(project, { recursive: true, force: true });
});

describe('listFor', () => {
  it('discovers skills by role/name from the adopted repo', () => {
    const res = skills.listFor(project);
    expect(res.installed).toBe(true);
    expect(res.repo).toBe(repo);
    expect(res.available).toEqual([
      { role: 'core', name: 'foo' },
      { role: 'nextjs', name: 'bar' },
    ]);
  });

  it('ignores the repo own dot-folders', () => {
    for (const rel of ['.ai/runs/x', '.claude/skills/y']) {
      const dir = path.join(repo, rel);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '# dot');
    }
    try {
      expect(skills.listFor(project).available).toEqual([
        { role: 'core', name: 'foo' },
        { role: 'nextjs', name: 'bar' },
      ]);
    } finally {
      fs.rmSync(path.join(repo, '.ai'), { recursive: true, force: true });
      fs.rmSync(path.join(repo, '.claude'), { recursive: true, force: true });
    }
  });

  it('recommends the skills of a role that is named like a dependency of the project', () => {
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ dependencies: { next: '1' } }));
    const res = skills.listFor(project);
    expect(res.recommended).toEqual(['bar']);
  });

  it('does not match a role to the package name inside a scope', () => {
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ devDependencies: { '@babel/core': '7' } }));
    expect(skills.listFor(project).recommended).toEqual([]);
  });

  it('recommends nothing when no role matches the project and no role is assumed', () => {
    expect(skills.listFor(project).recommended).toEqual([]);
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ dependencies: { lodash: '1' } }));
    expect(skills.listFor(project).recommended).toEqual([]);
  });
});

describe('a skills repo with its own layout', () => {
  let other: string;

  async function adopt(layout: string[]) {
    other = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-other-'));
    fs.mkdirSync(path.join(other, '.git'));
    for (const rel of layout) {
      fs.mkdirSync(path.join(other, rel), { recursive: true });
      fs.writeFileSync(path.join(other, rel, 'SKILL.md'), `# ${rel}`);
    }
    expect(((await skills.clone(other)) as { ok: boolean }).ok).toBe(true);
  }

  afterEach(async () => {
    await skills.clone(repo);
    fs.rmSync(other, { recursive: true, force: true });
  });

  it('lists skills of a repo with no groups, recommends nothing and links them', async () => {
    await adopt(['alpha', 'beta']);
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ dependencies: { next: '1' } }));
    const res = skills.listFor(project);
    expect(res.installed).toBe(true);
    expect(res.available).toEqual([
      { role: '', name: 'alpha' },
      { role: '', name: 'beta' },
    ]);
    expect(res.recommended).toEqual([]);
    expect(skills.link(project, ['alpha'])).toEqual({ alpha: 'linked' });
    expect(skills.listFor(project).linked).toEqual(['alpha']);
  });

  it('handles other group names and pre-selects only the group that matches the project', async () => {
    await adopt(['general/commit', 'stack-a/lint', 'vue/forms']);
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ devDependencies: { vue: '3' } }));
    const res = skills.listFor(project);
    expect(res.available).toEqual([
      { role: 'general', name: 'commit' },
      { role: 'stack-a', name: 'lint' },
      { role: 'vue', name: 'forms' },
    ]);
    expect(res.recommended).toEqual(['forms']);
  });
});

const PRIVATE_GROUPS = new RegExp(`${['dev', 'process'].join('-')}|${['tech', 'stack'].join('-')}`);

describe('no layout of one particular skills repo in the app', () => {
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  it('names no group of a skills repo in the main skills code or the renderer', () => {
    const root = path.resolve(__dirname, '..', 'src');
    const sources = ['main/skills.ts', ...files(path.join(root, 'renderer')).map((f) => path.relative(root, f))].filter((f) => /\.(ts|css|html)$/.test(f));
    const offenders = sources.filter((f) => PRIVATE_GROUPS.test(fs.readFileSync(path.join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('names no private skills repo group in any tracked file outside the PR and plan history', () => {
    const repo = path.resolve(__dirname, '..');
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' })
      .split('\0')
      .filter((f) => f && !f.startsWith('.lantern/prs/') && !f.startsWith('.lantern/plans/') && fs.existsSync(path.join(repo, f)));
    const offenders = tracked.filter((f) => PRIVATE_GROUPS.test(f) || (!/\.(png|ico|icns|woff2?|zip)$/.test(f) && PRIVATE_GROUPS.test(fs.readFileSync(path.join(repo, f), 'latin1'))));
    expect(offenders).toEqual([]);
  });
});

function makeRealFolder(name: string, marked: boolean) {
  const dir = path.join(project, '.claude', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}`);
  if (marked) fs.writeFileSync(path.join(dir, '.lantern-bundle'), '');
  return dir;
}

describe('bundled and local folders', () => {
  it('reports marked folders as bundled and unmarked ones as local, apart from links', () => {
    makeRealFolder('shipped', true);
    makeRealFolder('mine', false);
    skills.link(project, ['foo']);
    const brokenDest = path.join(project, '.claude', 'skills', 'gone');
    fs.symlinkSync(path.join(repo, 'core', 'gone'), brokenDest);
    const res = skills.listFor(project);
    expect(res.bundled).toEqual(['shipped']);
    expect(res.local).toEqual(['mine']);
    expect(res.linked.sort()).toEqual(['foo', 'gone']);
    expect(res.broken).toEqual(['gone']);
  });

  it('link returns skipped-bundled for a marked folder and leaves it untouched', () => {
    const dir = makeRealFolder('foo', true);
    const results = skills.link(project, ['foo']);
    expect(results).toEqual({ foo: 'skipped-bundled' });
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toBe('# foo');
    expect(fs.existsSync(path.join(dir, '.lantern-bundle'))).toBe(true);
  });

  it('link returns skipped-local for an unmarked folder', () => {
    const dir = makeRealFolder('bar', false);
    expect(skills.link(project, ['bar'])).toEqual({ bar: 'skipped-local' });
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
  });

  it('link returns linked for a free name and missing-source for an unknown one', () => {
    expect(skills.link(project, ['foo', 'nope'])).toEqual({ foo: 'linked', nope: 'missing-source' });
  });
});

describe('link safety', () => {
  it('keeps an existing symlink when the name is not in the skills repo', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-out-'));
    const dest = path.join(project, '.claude', 'skills', 'nope');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(outside, dest);
    expect(skills.link(project, ['nope'])).toEqual({ nope: 'missing-source' });
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('rejects names with path separators or dots and touches nothing outside the skills dir', () => {
    const victim = path.join(project, 'victim');
    fs.symlinkSync(repo, victim);
    fs.mkdirSync(path.join(project, '.claude', 'skills'), { recursive: true });
    const names = ['../../victim', 'a/b', '..', '.', ''];
    const results = skills.link(project, names);
    expect(Object.values(results).every((r) => r !== 'linked')).toBe(true);
    skills.unlink(project, names);
    expect(fs.lstatSync(victim).isSymbolicLink()).toBe(true);
  });

  it('ignores plain files in the skills dir when listing', () => {
    const dir = path.join(project, '.claude', 'skills');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.DS_Store'), '');
    const res = skills.listFor(project);
    expect(res.bundled).toEqual([]);
    expect(res.local).toEqual([]);
  });

  it('replaces a foreign symlink with the repo link when the name exists in the repo (old behaviour)', () => {
    const dir = path.join(project, '.claude', 'skills');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(os.tmpdir(), path.join(dir, 'foo'));
    expect(skills.link(project, ['foo'])).toEqual({ foo: 'linked' });
    expect(skills.listFor(project).linked).toContain('foo');
  });
});

describe('clone', () => {
  it('exposes the adopted repo path and remote', () => {
    expect(skills.repoPath()).toBe(repo);
    expect(typeof skills.listFor(null).remote).toBe('string');
    expect(typeof skills.defaultCloneParent()).toBe('string');
  });

  it('refuses to clone over an existing non-repo skills dir', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-base-'));
    fs.mkdirSync(path.join(base, 'skills'));
    const res = (await skills.clone(base)) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('already exists');
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('refuses a skills dir that has skills but no .git, or a .git but no skills', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-base-'));
    const noGit = path.join(base, 'skills');
    fs.mkdirSync(path.join(noGit, 'core', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(noGit, 'core', 'foo', 'SKILL.md'), '# foo');
    expect(((await skills.clone(base)) as { ok: boolean }).ok).toBe(false);
    fs.rmSync(noGit, { recursive: true, force: true });
    fs.mkdirSync(path.join(noGit, '.git'), { recursive: true });
    expect(((await skills.clone(base)) as { ok: boolean }).ok).toBe(false);
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('adopts the skills folder of a parent, laid out like the real checkout', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-base-'));
    const checkout = path.join(base, 'skills');
    fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
    fs.mkdirSync(path.join(checkout, 'core', 'team-conventions'), { recursive: true });
    fs.writeFileSync(path.join(checkout, 'core', 'team-conventions', 'SKILL.md'), '# team-conventions');
    const res = (await skills.clone(base)) as { ok: boolean; adopted?: boolean; repo?: string };
    expect(res).toMatchObject({ ok: true, adopted: true, repo: checkout });
    await skills.clone(repo);
    fs.rmSync(base, { recursive: true, force: true });
  });
});

describe('link / unlink', () => {
  it('links a skill into the project and reports it', () => {
    skills.link(project, ['foo']);
    const dest = path.join(project, '.claude', 'skills', 'foo');
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(skills.listFor(project).linked).toContain('foo');
  });

  it.each([
    ['claude', '.claude/skills'],
    ['codex', '.agents/skills'],
  ] as const)('excludes only the linked %s skill names from git, once each', (provider, dir) => {
    fs.mkdirSync(path.join(project, '.git', 'info'), { recursive: true });
    skills.link(project, ['foo'], provider);
    skills.link(project, ['foo'], provider);
    const lines = fs.readFileSync(path.join(project, '.git', 'info', 'exclude'), 'utf8').split('\n');
    expect(lines.filter((line) => line === `${dir}/foo`)).toHaveLength(1);
    expect(lines.some((line) => line.replace(/\/$/, '') === dir)).toBe(false);
    expect(lines.some((line) => line.startsWith(provider === 'codex' ? '.claude/' : '.agents/'))).toBe(false);
  });

  it('keeps a skill the user adds next to linked ones visible to git', () => {
    execFileSync('git', ['init', '-q'], { cwd: project });
    skills.link(project, ['foo']);
    fs.mkdirSync(path.join(project, '.claude', 'skills', 'mine'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'skills', 'mine', 'SKILL.md'), '# mine\n');
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: project, encoding: 'utf8' });
    expect(status).toContain('.claude/skills/mine/SKILL.md');
    expect(status).not.toContain('.claude/skills/foo');
  });

  it('unlinks a previously linked skill', () => {
    skills.link(project, ['foo']);
    skills.unlink(project, ['foo']);
    expect(fs.existsSync(path.join(project, '.claude', 'skills', 'foo'))).toBe(false);
    expect(skills.listFor(project).linked).not.toContain('foo');
  });

  it('ignores unknown skill names', () => {
    skills.link(project, ['nope']);
    expect(fs.existsSync(path.join(project, '.claude', 'skills', 'nope'))).toBe(false);
  });

  it('links and unlinks a Codex skill in its native directory', () => {
    skills.link(project, ['foo'], 'codex');
    const dest = path.join(project, '.agents', 'skills', 'foo');
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(skills.listFor(project, 'codex').linked).toContain('foo');
    skills.unlink(project, ['foo'], 'codex');
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('does not edit shared excludes when .git is a worktree file', () => {
    fs.writeFileSync(path.join(project, '.git'), 'gitdir: /shared/worktrees/demo\n');
    skills.link(project, ['foo'], 'codex');
    expect(fs.readFileSync(path.join(project, '.git'), 'utf8')).toBe('gitdir: /shared/worktrees/demo\n');
  });

  it.each(['.agents', path.join('.agents', 'skills')])('rejects a symlinked Codex ancestor at %s', (ancestor) => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-external-'));
    const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-unrelated-'));
    const externalSkills = ancestor === '.agents' ? path.join(external, 'skills') : external;
    fs.mkdirSync(externalSkills, { recursive: true });
    fs.writeFileSync(path.join(externalSkills, 'sentinel'), 'keep');
    fs.symlinkSync(unrelated, path.join(externalSkills, 'foo'));
    fs.symlinkSync(path.join(repo, 'nextjs', 'bar'), path.join(externalSkills, 'bar'));
    if (ancestor !== '.agents') fs.mkdirSync(path.join(project, '.agents'));
    fs.symlinkSync(external, path.join(project, ancestor));

    expect(skills.listFor(project, 'codex').linked).toEqual([]);
    skills.link(project, ['foo'], 'codex');
    skills.unlink(project, ['bar'], 'codex');

    expect(fs.readFileSync(path.join(externalSkills, 'sentinel'), 'utf8')).toBe('keep');
    expect(fs.readlinkSync(path.join(externalSkills, 'foo'))).toBe(unrelated);
    expect(fs.readlinkSync(path.join(externalSkills, 'bar'))).toBe(path.join(repo, 'nextjs', 'bar'));
    fs.rmSync(external, { recursive: true, force: true });
    fs.rmSync(unrelated, { recursive: true, force: true });
  });

  it('rejects a project that resolves to the home directory', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-home-'));
    const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-unrelated-'));
    const homeSkills = path.join(fakeHome, '.agents', 'skills');
    fs.mkdirSync(homeSkills, { recursive: true });
    fs.writeFileSync(path.join(homeSkills, 'sentinel'), 'keep');
    fs.symlinkSync(unrelated, path.join(homeSkills, 'foo'));
    fs.symlinkSync(path.join(repo, 'nextjs', 'bar'), path.join(homeSkills, 'bar'));
    fs.rmSync(project, { recursive: true, force: true });
    fs.symlinkSync(fakeHome, project);
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    expect(skills.listFor(project, 'codex').linked).toEqual([]);
    skills.link(project, ['foo'], 'codex');
    skills.unlink(project, ['bar'], 'codex');

    expect(fs.readFileSync(path.join(homeSkills, 'sentinel'), 'utf8')).toBe('keep');
    expect(fs.readlinkSync(path.join(homeSkills, 'foo'))).toBe(unrelated);
    expect(fs.readlinkSync(path.join(homeSkills, 'bar'))).toBe(path.join(repo, 'nextjs', 'bar'));
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(unrelated, { recursive: true, force: true });
  });
});
