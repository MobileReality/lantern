import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module, no declarations
import { describeRtk, describeRtkHook, detectRtk, RTK_EDITIONS, RTK_REASONS } from '../skills/lantern-delegate/scripts/rtk-detect.mjs';
// @ts-expect-error plain ES module, no declarations
import { findRtkHooks } from '../skills/lantern-delegate/scripts/rtk-hook.mjs';
// @ts-expect-error plain ES module, no declarations
import { knownLocations, resolveRtk, runShell } from '../skills/lantern-delegate/scripts/rtk-resolve.mjs';
import { fakeRtk, HOOK_SETTINGS, treeHash, writeSettings } from './support/rtk-fixtures';

let tmp: string;
let home: string;
let bin: string;
let log: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-detect-'));
  home = path.join(tmp, 'home');
  bin = path.join(tmp, 'bin');
  log = path.join(tmp, 'calls.log');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function runnableUnder(root: string) {
  return (file: string) => {
    if (!file.startsWith(root)) return false;
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };
}

function context(pathDirs: string[], overrides: Record<string, unknown> = {}) {
  return {
    platform: process.platform,
    env: { PATH: [...pathDirs, '/usr/bin', '/bin'].join(path.delimiter), HOME: home, FAKE_RTK_LOG: log },
    home,
    fixedDirs: [],
    isRunnable: runnableUnder(tmp),
    runShell: async () => null,
    ...overrides,
  };
}

const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);

describe('detectRtk', () => {
  it('returns path, version and edition for an rtk on PATH', async () => {
    const file = fakeRtk(bin);
    const status = await detectRtk({ ctx: context([bin]) });
    expect(status).toEqual({ found: true, path: file, version: '1.0.1', edition: RTK_EDITIONS.full, hookFound: false, hookFiles: [], reason: null });
  });

  it('infers the Apache edition when the full-only subcommand is rejected', async () => {
    fakeRtk(bin, { pipeline: false });
    expect((await detectRtk({ ctx: context([bin]) })).edition).toBe(RTK_EDITIONS.oss);
  });

  it('leaves the edition unknown when the subcommand fails for another reason', async () => {
    fakeRtk(bin, { pipeline: 'broken' });
    const status = await detectRtk({ ctx: context([bin]) });
    expect(status.found).toBe(true);
    expect(status.edition).toBe(RTK_EDITIONS.unknown);
  });

  it('reports not RTK for an rtk without gain, and never asks it about editions', async () => {
    const file = fakeRtk(bin, { gain: false });
    const status = await detectRtk({ ctx: context([bin]) });
    expect(status).toMatchObject({ found: false, path: file, version: null, edition: null, reason: RTK_REASONS.notRtk });
    expect(calls().map((c) => c.split('|')[0])).toEqual(['--version', 'gain']);
  });

  it('runs nothing but --version while the name is not plausible', async () => {
    fakeRtk(bin, { version: 'rust-type-kit 0.3.0' });
    const status = await detectRtk({ ctx: context([bin]) });
    expect(status).toMatchObject({ found: false, reason: RTK_REASONS.notRtk });
    expect(calls().map((c) => c.split('|')[0])).toEqual(['--version']);
  });

  it('treats a failing --version as not RTK', async () => {
    fakeRtk(bin, { versionExit: 3 });
    expect((await detectRtk({ ctx: context([bin]) })).reason).toBe(RTK_REASONS.notRtk);
  });

  it('reports not installed, with no path, when there is no rtk anywhere', async () => {
    const status = await detectRtk({ ctx: context([bin]) });
    expect(status).toEqual({ found: false, path: null, version: null, edition: null, hookFound: false, hookFiles: [], reason: RTK_REASONS.notInstalled });
    expect(calls()).toEqual([]);
  });

  it('finds an rtk that only the login shell knows about', async () => {
    const hidden = path.join(tmp, 'hidden');
    const file = fakeRtk(hidden);
    const asked: string[][] = [];
    const runShell = async (cmd: string, args: string[]) => {
      asked.push([cmd, ...args]);
      return `noise from rc files\n${file}\n`;
    };
    const status = await detectRtk({ ctx: context([bin], { runShell }) });
    expect(status.path).toBe(file);
    expect(asked[0].slice(1)).toEqual(['-ilc', 'command -v rtk']);
  });

  it('does not ask the login shell when loginShell is off', async () => {
    let asked = false;
    const runShell = async () => {
      asked = true;
      return null;
    };
    await detectRtk({ ctx: context([bin], { runShell }), loginShell: false });
    expect(asked).toBe(false);
  });

  it('reports a probe that timed out as failed, not as RTK', async () => {
    const file = fakeRtk(bin);
    const probe = async (_file: string, args: string[]) =>
      args[0] === '--version' ? { code: 0, stdout: 'rtk 1.0.1\n', stderr: '', timedOut: false } : { code: null, stdout: '', stderr: '', timedOut: true };
    const status = await detectRtk({ ctx: context([bin]), probe });
    expect(status).toMatchObject({ found: false, path: file, reason: RTK_REASONS.probeFailed });
  });

  it('lists the injected fixed folders after the home ones, and none when the list is empty', () => {
    expect(knownLocations(context([bin], { fixedDirs: ['/somewhere/bin'] })).at(-1)).toBe(path.join('/somewhere/bin', 'rtk'));
    expect(knownLocations(context([bin]))).toHaveLength(2);
  });

  it('lists ~/.local/bin first, and skips a file on PATH that is not executable', () => {
    const known = knownLocations(context([bin]));
    expect(known[0]).toBe(path.join(home, '.local', 'bin', 'rtk'));
    const plain = path.join(bin, 'rtk');
    fs.writeFileSync(plain, '#!/bin/sh\n', { mode: 0o644 });
    fs.chmodSync(plain, 0o644);
    return expect(resolveRtk(context([bin]), { loginShell: false })).resolves.toBeNull();
  });

  it('does not depend on global state: two calls with different contexts answer differently', async () => {
    const other = path.join(tmp, 'other');
    fakeRtk(other, { pipeline: false });
    const [here, there, none] = await Promise.all([detectRtk({ ctx: context([bin]) }), detectRtk({ ctx: context([other]) }), detectRtk({ ctx: context([]) })]);
    expect([here.found, there.found, none.found]).toEqual([false, true, false]);
    expect(there.edition).toBe(RTK_EDITIONS.oss);
  });
});

describe('runShell', () => {
  it('closes stdin, drops stderr and returns stdout', async () => {
    const script = path.join(tmp, 'probe.sh');
    fs.writeFileSync(script, '#!/bin/sh\ncat\necho out\necho err 1>&2\n', { mode: 0o755 });
    await expect(runShell(script, [], {})).resolves.toBe('out\n');
  });

  it('answers null for a failing or missing command', async () => {
    await expect(runShell(path.join(tmp, 'missing'), [], {})).resolves.toBeNull();
    const script = path.join(tmp, 'fail.sh');
    fs.writeFileSync(script, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await expect(runShell(script, [], {})).resolves.toBeNull();
  });
});

describe('detectRtk never writes', () => {
  it('leaves every file under a temp HOME unchanged and points the probe at a temp database', async () => {
    fakeRtk(bin);
    writeSettings(home, 'settings.json', { theme: 'dark' });
    fs.writeFileSync(path.join(home, '.zshrc'), 'export A=1\n');
    const project = path.join(tmp, 'project');
    writeSettings(project, 'settings.json', { model: 'x' });
    const before = treeHash(home);
    const projectBefore = treeHash(project);

    const status = await detectRtk({ ctx: context([bin]), projectDirs: [project] });

    expect(status.found).toBe(true);
    expect(treeHash(home)).toBe(before);
    expect(treeHash(project)).toBe(projectBefore);
    for (const untouched of ['.local/share/rtk', '.config/rtk', 'Library/Application Support/rtk', '.codex']) {
      expect(fs.existsSync(path.join(home, untouched)), untouched).toBe(false);
    }
    const dbPaths = calls().map((c) => c.split('|db=')[1]);
    expect(dbPaths).toHaveLength(3);
    expect(new Set(dbPaths).size).toBe(1);
    const [db] = dbPaths;
    expect(db).not.toBe('unset');
    expect(db.startsWith(path.join(os.tmpdir(), 'lantern-rtk-'))).toBe(true);
    expect(db.startsWith(home)).toBe(false);
    expect(fs.existsSync(path.dirname(db))).toBe(false);
  });

  it('leaves a temp HOME unchanged when the fake would write its default database if it were given none', async () => {
    fakeRtk(bin);
    const before = treeHash(home);
    await detectRtk({ ctx: context([bin]) });
    expect(fs.existsSync(path.join(home, '.local'))).toBe(false);
    expect(treeHash(home)).toBe(before);
  });
});

describe('hook detection', () => {
  it('finds an rtk hook claude entry in the user settings', () => {
    writeSettings(home, 'settings.json', HOOK_SETTINGS);
    expect(findRtkHooks([], home)).toEqual([path.join(home, '.claude', 'settings.json')]);
  });

  it('finds it in a project settings.json and settings.local.json', () => {
    const project = path.join(tmp, 'project');
    writeSettings(project, 'settings.json', HOOK_SETTINGS);
    writeSettings(project, 'settings.local.json', HOOK_SETTINGS);
    expect(findRtkHooks([project], home)).toEqual([path.join(project, '.claude', 'settings.json'), path.join(project, '.claude', 'settings.local.json')]);
  });

  it('reports no hook when disableAllHooks is true in the user settings', () => {
    writeSettings(home, 'settings.json', { ...HOOK_SETTINGS, disableAllHooks: true });
    expect(findRtkHooks([], home)).toEqual([]);
  });

  it('reports no hook when a project settings file sets disableAllHooks over a hook in the user settings', () => {
    const project = path.join(tmp, 'project');
    writeSettings(home, 'settings.json', HOOK_SETTINGS);
    writeSettings(project, 'settings.local.json', { disableAllHooks: true });
    expect(findRtkHooks([project], home)).toEqual([]);
  });

  it('still reports the hook when disableAllHooks is false', () => {
    writeSettings(home, 'settings.json', { ...HOOK_SETTINGS, disableAllHooks: false });
    expect(findRtkHooks([], home)).toEqual([path.join(home, '.claude', 'settings.json')]);
  });

  it('recognises an absolute path to rtk', () => {
    writeSettings(home, 'settings.json', { hooks: { PreToolUse: [{ hooks: [{ command: '/opt/homebrew/bin/rtk hook claude' }] }] } });
    expect(findRtkHooks([], home)).toHaveLength(1);
  });

  it('ignores other hooks, other rtk commands, malformed files and missing files', () => {
    writeSettings(home, 'settings.json', { hooks: { PreToolUse: [{ hooks: [{ command: 'rtk hook codex' }, { command: 'echo rtk hooked claude' }, { command: 'node notify.js' }] }] } });
    const project = path.join(tmp, 'project');
    writeSettings(project, 'settings.json', '{ not json');
    expect(findRtkHooks([project, path.join(tmp, 'missing')], home)).toEqual([]);
  });

  it('reports the hook in the status even when rtk is not installed', async () => {
    writeSettings(home, 'settings.json', HOOK_SETTINGS);
    const status = await detectRtk({ ctx: context([bin]) });
    expect(status).toMatchObject({ found: false, hookFound: true, hookFiles: [path.join(home, '.claude', 'settings.json')], reason: RTK_REASONS.notInstalled });
  });

  it('does not change the settings it reads', async () => {
    fakeRtk(bin);
    writeSettings(home, 'settings.json', HOOK_SETTINGS);
    const before = treeHash(home);
    await detectRtk({ ctx: context([bin]) });
    expect(treeHash(home)).toBe(before);
  });
});

describe('describeRtk', () => {
  it('prints path, version and edition when found', () => {
    expect(describeRtk({ found: true, path: '/x/rtk', version: '1.0.1', edition: 'oss', hookFound: false, hookFiles: [], reason: null })).toEqual({ level: 'ok', check: 'rtk', detail: '/x/rtk 1.0.1 oss' });
  });

  it('prints the optional note when absent', () => {
    expect(describeRtk({ found: false, path: null, version: null, edition: null, hookFound: false, hookFiles: [], reason: 'not-installed' })).toEqual({ level: 'note', check: 'rtk', detail: 'not installed (optional)' });
  });

  it('says a different rtk is not RTK', () => {
    expect(describeRtk({ found: false, path: '/x/rtk', version: null, edition: null, hookFound: false, hookFiles: [], reason: 'not-rtk' }).detail).toMatch(/is not RTK/);
  });

  it('warns about a hook only when one is set, and says Lantern changes nothing', () => {
    expect(describeRtkHook({ found: false, hookFound: false, hookFiles: [] })).toBeNull();
    const warning = describeRtkHook({ found: true, hookFound: true, hookFiles: ['/h/.claude/settings.json'] });
    expect(warning).toMatchObject({ level: 'warn', check: 'rtk-hook' });
    expect(warning.detail).toContain('/h/.claude/settings.json');
    expect(warning.detail).toContain('Lantern changes nothing');
  });
});
