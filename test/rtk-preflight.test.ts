import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLE_SKILLS } from '../scripts/lantern-bundle.mjs';
import { settingsSnippet } from '../skills/lantern-delegate/scripts/permissions.mjs';
import { makeRepo } from './support/bundle-fixtures';
import { fakeRtk, HOOK_SETTINGS, treeHash, writeSettings } from './support/rtk-fixtures';

const PREFLIGHT = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts', 'preflight.mjs');
const INSTALLER = path.join(__dirname, '..', 'scripts', 'install-skills.mjs');
const SKILL_NAMES = [...BUNDLE_SKILLS.map((s) => s.name), 'my-extra', 'second-extra'];
const NO_RTK_LINE = 'note rtk: not installed (optional)';
const RTK_LINE = /^(ok {3}|note |WARN )rtk(-hook)?:/m;

let tmp: string;
let home: string;
let bin: string;
let repo: string;
let log: string;
let shell: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-preflight-'));
  home = path.join(tmp, 'home');
  bin = path.join(tmp, 'bin');
  log = path.join(tmp, 'calls.log');
  shell = path.join(tmp, 'login-shell');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.writeFileSync(shell, `#!/bin/sh\necho ran >> '${path.join(tmp, 'shell-ran')}'\nexit 1\n`, { mode: 0o755 });
  repo = makeRepo(path.join(tmp, 'repo'));
  for (const name of SKILL_NAMES) {
    fs.mkdirSync(path.join(repo, '.claude', 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
  }
  fs.mkdirSync(path.join(tmp, 'linker', 'core'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'linker', 'skill-linker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const skillRoots = [path.join(fs.realpathSync(repo), '.claude', 'skills'), path.join(home, '.claude', 'skills')];
  writeSettings(repo, 'settings.json', settingsSnippet({ skillRoots, skillLinker: path.join(tmp, 'linker', 'skill-linker') }));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function envWith(extra: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, SHELL: shell, SKILL_LINKER: path.join(tmp, 'linker', 'skill-linker'), FAKE_RTK_LOG: log, LANTERN_RTK_FIXED_DIRS: '' };
  for (const name of ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN', 'GITHUB_TOKEN', 'GIT_COMMIT_NAME', 'GIT_COMMIT_EMAIL', 'GIT_CONFIG_GLOBAL', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'LANTERN_RTK_DETECT']) delete env[name];
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter((dir) => dir && !fs.existsSync(path.join(dir, 'skill-linker')) && !fs.existsSync(path.join(dir, 'rtk')));
  env.PATH = [bin, ...dirs].join(path.delimiter);
  return { ...env, ...extra };
}

function preflight(extra: NodeJS.ProcessEnv = {}) {
  const res = spawnSync(process.execPath, [PREFLIGHT, '--target', 'main', '--no-api'], { cwd: repo, env: envWith(extra), encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

function install(extra: NodeJS.ProcessEnv = {}) {
  const project = makeRepo(path.join(tmp, `project-${Math.random().toString(36).slice(2)}`));
  const res = spawnSync(process.execPath, [INSTALLER, project], { env: envWith(extra), encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}`.trimEnd().split('\n') };
}

const lineOf = (out: string, prefix: string) => out.split('\n').find((l) => l.startsWith(prefix));
const withoutLine = (out: string, line: string) => out.split('\n').filter((l) => l !== line).join('\n');

describe('preflight without RTK', () => {
  it('prints today\'s output plus the one note line, and the same exit code', () => {
    const baseline = preflight({ LANTERN_RTK_DETECT: 'off' });
    const withDetection = preflight();
    expect(baseline.code).toBe(0);
    expect(baseline.out).not.toMatch(RTK_LINE);
    expect(withDetection.code).toBe(baseline.code);
    expect(withDetection.out.split('\n').filter((l) => l === NO_RTK_LINE)).toHaveLength(1);
    expect(withoutLine(withDetection.out, NO_RTK_LINE)).toBe(baseline.out);
  });

  it('puts the note right before the limits note and never fails the gate', () => {
    const lines = preflight().out.split('\n');
    expect(lines[lines.indexOf(NO_RTK_LINE) + 1]).toMatch(/^note limits:/);
    expect(preflight().out).toMatch(/preflight green/);
  });

  it('never starts a login shell, in preflight or in the installer, so no startup file runs', () => {
    preflight();
    install();
    expect(fs.existsSync(path.join(tmp, 'shell-ran'))).toBe(false);
  });

  it('prints a note, not a failure, for an rtk that has no gain', () => {
    fakeRtk(bin, { gain: false });
    const res = preflight();
    expect(lineOf(res.out, 'note rtk:')).toContain('is not RTK');
    expect(res.out).not.toMatch(/FAIL/);
    expect(res.code).toBe(0);
  });
});

describe('preflight with a fake RTK', () => {
  it('prints ok with path, version and edition', () => {
    const file = fakeRtk(bin);
    const res = preflight();
    expect(lineOf(res.out, 'ok   rtk:')).toBe(`ok   rtk: ${file} 1.0.1 full`);
    expect(lineOf(res.out, 'WARN rtk-hook')).toBeUndefined();
    expect(res.code).toBe(0);
  });

  it('warns about a global hook and still exits 0', () => {
    fakeRtk(bin);
    writeSettings(home, 'settings.json', HOOK_SETTINGS);
    const res = preflight();
    expect(lineOf(res.out, 'WARN rtk-hook:')).toContain(path.join(home, '.claude', 'settings.json'));
    expect(res.out).toMatch(/preflight green/);
    expect(res.code).toBe(0);
  });

  it('warns about a hook in the project settings.local.json, also without rtk installed', () => {
    writeSettings(repo, 'settings.local.json', HOOK_SETTINGS);
    const res = preflight();
    expect(lineOf(res.out, 'WARN rtk-hook:')).toContain(path.join(repo, '.claude', 'settings.local.json'));
    expect(lineOf(res.out, 'note rtk:')).toBe(NO_RTK_LINE);
    expect(res.code).toBe(0);
  });

  it('leaves every file under HOME unchanged and keeps the probe off the default database', () => {
    fakeRtk(bin);
    writeSettings(home, 'settings.json', HOOK_SETTINGS);
    fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = T\n');
    const before = treeHash(home);

    const res = preflight();

    expect(lineOf(res.out, 'ok   rtk:')).toBeDefined();
    expect(treeHash(home)).toBe(before);
    for (const untouched of ['.local/share/rtk', '.config/rtk', 'Library/Application Support/rtk', '.codex']) {
      expect(fs.existsSync(path.join(home, untouched)), untouched).toBe(false);
    }
    const databases = fs.readFileSync(log, 'utf8').trim().split('\n').map((c) => c.split('|db=')[1]);
    expect(databases.length).toBeGreaterThan(0);
    for (const db of databases) {
      expect(db.startsWith(path.join(os.tmpdir(), 'lantern-rtk-'))).toBe(true);
      expect(fs.existsSync(path.dirname(db))).toBe(false);
    }
  });
});

describe('install-skills RTK line', () => {
  it('ends with the same status line as preflight', () => {
    const file = fakeRtk(bin);
    const { out } = install();
    expect(out.at(-1)).toBe(`ok   rtk: ${file} 1.0.1 full`);
    expect(out.filter((l) => l.includes('rtk:'))).toHaveLength(1);
  });

  it('says it is not installed, and writes nothing to HOME', () => {
    const { code, out } = install();
    expect(code).toBe(0);
    expect(out.at(-1)).toBe(NO_RTK_LINE);
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('mentions a set hook on the same line', () => {
    fakeRtk(bin);
    writeSettings(home, 'settings.json', HOOK_SETTINGS);
    const before = treeHash(home);
    const { out } = install();
    expect(out.at(-1)).toContain('WARN rtk-hook set in');
    expect(treeHash(home)).toBe(before);
  });

  it('prints no RTK line when detection is switched off', () => {
    fakeRtk(bin);
    expect(install({ LANTERN_RTK_DETECT: 'off' }).out.join('\n')).not.toMatch(RTK_LINE);
  });
});
