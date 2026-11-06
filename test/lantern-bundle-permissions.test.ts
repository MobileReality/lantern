import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBundleGuarded, syncDelegatePermissions } from '../scripts/lantern-bundle.mjs';
import { missingPermissions, requiredAllow, settingsSnippet } from '../skills/lantern-delegate/scripts/permissions.mjs';
import { resolveSkillLinker } from '../skills/lantern-delegate/scripts/skill-linker.mjs';
import { git, makeBundle, makeHome, makeLinker, makeRepo } from './support/bundle-fixtures';

const REAL_ROOT = path.join(__dirname, '..', 'skills');

let tmp: string;
let project: string;
let home: string;

const settingsFile = (at = project) => path.join(at, '.claude', 'settings.local.json');
const readSettings = (at = project) => JSON.parse(fs.readFileSync(settingsFile(at), 'utf8'));
const install = (root = REAL_ROOT, provider: 'claude' | 'codex' = 'claude') => installBundleGuarded({ project, root, home, provider });

function neededFor(at: string, forHome = home) {
  const skillRoots = [path.join(fs.realpathSync(at), '.claude', 'skills'), path.join(forHome, '.claude', 'skills')];
  return requiredAllow(skillRoots, resolveSkillLinker({ home: forHome }).path ?? undefined);
}

beforeEach(() => {
  vi.stubEnv('SKILL_LINKER', '');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-perms-'));
  home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  project = makeRepo(path.join(tmp, 'project'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('delegate permissions written on open', () => {
  it('leaves nothing missing for the project, and never touches the tracked or user settings', async () => {
    expect(missingPermissions([settingsFile()], neededFor(project))).not.toEqual([]);
    const result = await install();
    expect(result.permissions).toEqual({ status: 'written' });
    expect(missingPermissions([settingsFile()], neededFor(project))).toEqual([]);
    expect(fs.existsSync(path.join(project, '.claude', 'settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.claude', 'settings.json'))).toBe(false);
    const wanted = JSON.parse(settingsSnippet({ skillRoots: [path.join(fs.realpathSync(project), '.claude', 'skills'), path.join(home, '.claude', 'skills')], skillLinker: resolveSkillLinker({ home }).path ?? undefined })).permissions;
    expect(readSettings().permissions.deny).toEqual(wanted.deny);
    expect(readSettings().permissions.allow).toEqual(wanted.allow);
  });

  it('keeps every existing key and rule, adds only what is missing, and drops nothing', async () => {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ model: 'opus', env: { A: '1' }, permissions: { defaultMode: 'plan', allow: ['Bash(ls:*)', 'Bash(git status:*)'], deny: ['Bash(rm -rf:*)'], ask: ['Bash(curl:*)'] } }),
    );
    await install();
    const merged = readSettings();
    expect(merged.model).toBe('opus');
    expect(merged.env).toEqual({ A: '1' });
    expect(merged.permissions.defaultMode).toBe('plan');
    expect(merged.permissions.ask).toEqual(['Bash(curl:*)']);
    expect(merged.permissions.allow.slice(0, 2)).toEqual(['Bash(ls:*)', 'Bash(git status:*)']);
    expect(merged.permissions.allow.filter((rule: string) => rule === 'Bash(git status:*)')).toHaveLength(1);
    expect(merged.permissions.deny[0]).toBe('Bash(rm -rf:*)');
    expect(merged.permissions.deny).toContain('Bash(git push --force*)');
    expect(missingPermissions([settingsFile()], neededFor(project))).toEqual([]);
  });

  it('is idempotent: a second run changes nothing', async () => {
    await install();
    const first = fs.readFileSync(settingsFile(), 'utf8');
    const mtime = fs.statSync(settingsFile()).mtimeMs;
    const second = await install();
    expect(second.permissions).toEqual({ status: 'current' });
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(first);
    expect(fs.statSync(settingsFile()).mtimeMs).toBe(mtime);
  });

  it('leaves an unparseable file untouched and reports it', async () => {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(settingsFile(), '{ "permissions": ');
    const result = await install();
    expect(result.permissions).toEqual({ status: 'unparseable' });
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe('{ "permissions": ');
  });

  it('leaves a file whose permissions have the wrong shape untouched', async () => {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(settingsFile(), '{"permissions":{"allow":"Bash(ls:*)"}}');
    expect((await install()).permissions).toEqual({ status: 'unparseable' });
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe('{"permissions":{"allow":"Bash(ls:*)"}}');
  });

  it('does not write where git would not ignore the file and cannot be made to', async () => {
    const bare = makeRepo(path.join(tmp, 'plain'), null);
    const result = await installBundleGuarded({ project: bare, root: REAL_ROOT, home });
    expect(['written', 'not-ignored']).toContain(result.permissions?.status);
    if (result.permissions?.status === 'written') expect(git(bare, 'status', '--porcelain', '--', '.claude/settings.local.json')).toBe('');
  });

  it('reports not-ignored and leaves a git-tracked settings file byte-identical', async () => {
    const tracked = makeRepo(path.join(tmp, 'tracked'), null);
    const bytes = '{"model":"opus"}\n';
    fs.mkdirSync(path.join(tracked, '.claude'), { recursive: true });
    fs.writeFileSync(settingsFile(tracked), bytes);
    git(tracked, 'add', '-f', '.claude/settings.local.json');
    git(tracked, 'commit', '-q', '-m', 'track settings');
    const result = await installBundleGuarded({ project: tracked, root: REAL_ROOT, home });
    expect(result.permissions).toEqual({ status: 'not-ignored' });
    expect(fs.readFileSync(settingsFile(tracked), 'utf8')).toBe(bytes);
    const exclude = fs.readFileSync(path.join(tracked, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n')).toContain('.claude/settings.local.json');
  });

  it('keeps the project extensions file out of git on open, before anyone writes it', async () => {
    const open = makeRepo(path.join(tmp, 'open'), null);
    await installBundleGuarded({ project: open, root: REAL_ROOT, home });
    const exclude = fs.readFileSync(path.join(open, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n')).toContain('.claude/lantern-extensions.json');
    fs.mkdirSync(path.join(open, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(open, '.claude', 'lantern-extensions.json'), '{}');
    expect(git(open, 'status', '--porcelain', '--', '.claude/lantern-extensions.json')).toBe('');
  });

  it('adds nothing for the extensions file when .gitignore already covers it', async () => {
    await install();
    const excludeFile = path.join(project, '.git', 'info', 'exclude');
    const exclude = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
    expect(exclude.split('\n')).not.toContain('.claude/lantern-extensions.json');
  });

  it('does nothing for the Codex provider', async () => {
    const result = await install(REAL_ROOT, 'codex');
    expect(result.permissions).toBeUndefined();
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  describe('following the current home and skill linker', () => {
    const nodeRule = (forHome: string) => `Bash(node ${path.join(forHome, '.claude', 'skills')}/*)`;
    const linkerRule = (linker: string) => `Bash(${linker} --list)`;
    const installFor = (forHome: string) => installBundleGuarded({ project, root: REAL_ROOT, home: forHome });

    it('adds the rules of a new home and keeps the ones written for the old home', async () => {
      const homeA = makeHome(path.join(tmp, 'home-a'));
      const homeB = makeHome(path.join(tmp, 'home-b'));
      await installFor(homeA);
      expect(missingPermissions([settingsFile()], neededFor(project, homeB))).not.toEqual([]);
      expect((await installFor(homeB)).permissions).toEqual({ status: 'written' });
      const { allow } = readSettings().permissions;
      expect(allow).toContain(nodeRule(homeA));
      expect(allow).toContain(nodeRule(homeB));
      expect(missingPermissions([settingsFile()], neededFor(project, homeB))).toEqual([]);
      expect(missingPermissions([settingsFile()], neededFor(project, homeA))).toEqual([]);
    });

    it('reads the skill linker from the home it was given, and adds the rules of a changed one', async () => {
      const linkerX = makeLinker(path.join(tmp, 'linker-x'));
      const linkerY = makeLinker(path.join(tmp, 'linker-y'));
      makeHome(home, linkerX);
      await install();
      expect(readSettings().permissions.allow).toContain(linkerRule(linkerX));
      makeHome(home, linkerY);
      expect((await install()).permissions).toEqual({ status: 'written' });
      const { allow, deny } = readSettings().permissions;
      expect(allow).toContain(linkerRule(linkerY));
      expect(allow).toContain(`Bash(${linkerY} . --skill:*)`);
      expect(allow).toContain(linkerRule(linkerX));
      expect(deny).toContain(`Bash(${linkerY} * --unlink*)`);
      expect(missingPermissions([settingsFile()], neededFor(project))).toEqual([]);
    });

    it('leaves the file byte-identical and its mtime alone when the home and linker add nothing', async () => {
      makeHome(home, makeLinker(path.join(tmp, 'linker-x')));
      await install();
      await installFor(makeHome(path.join(tmp, 'home-b')));
      const bytes = fs.readFileSync(settingsFile(), 'utf8');
      const mtime = fs.statSync(settingsFile()).mtimeMs;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect((await install()).permissions).toEqual({ status: 'current' });
      expect((await installFor(path.join(tmp, 'home-b'))).permissions).toEqual({ status: 'current' });
      expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(bytes);
      expect(fs.statSync(settingsFile()).mtimeMs).toBe(mtime);
    });

    it('keeps a rule the user wrote for another home in place and edits nothing of theirs', async () => {
      const other = makeHome(path.join(tmp, 'other-home'));
      const own = [nodeRule(other), 'Bash(ls:*)', 'Bash(node /somewhere/else/*)'];
      fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
      fs.writeFileSync(settingsFile(), JSON.stringify({ permissions: { allow: own, deny: ['Bash(rm -rf:*)'] } }));
      await install();
      const { allow, deny } = readSettings().permissions;
      expect(allow.slice(0, own.length)).toEqual(own);
      expect(allow.filter((rule: string) => rule === nodeRule(other))).toHaveLength(1);
      expect(allow).toContain(nodeRule(home));
      expect(deny[0]).toBe('Bash(rm -rf:*)');
    });

    it('syncs the rules on their own for a directory, and refuses the home folder and a missing one', async () => {
      expect(await syncDelegatePermissions({ project, root: REAL_ROOT, home })).toEqual({ status: 'written' });
      expect(await syncDelegatePermissions({ project, root: REAL_ROOT, home })).toEqual({ status: 'current' });
      expect(await syncDelegatePermissions({ project: home, root: REAL_ROOT, home })).toEqual({ status: 'home' });
      expect(fs.existsSync(path.join(home, '.claude', 'settings.local.json'))).toBe(false);
      expect(await syncDelegatePermissions({ project: path.join(tmp, 'missing'), root: REAL_ROOT, home })).toEqual({ status: 'not-a-directory' });
    });
  });

  it('skips quietly when the bundle carries no permissions list', async () => {
    const root = path.join(tmp, 'bundle');
    makeBundle(root);
    const result = await install(root);
    expect(result.permissions).toEqual({ status: 'missing-source' });
    expect(fs.existsSync(settingsFile())).toBe(false);
  });
});
