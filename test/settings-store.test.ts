import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTING_DEFAULTS } from '../src/shared/settings-registry';

const userData = vi.hoisted(() => {
  const o = require('node:os');
  const p = require('node:path');
  const f = require('node:fs');
  return f.mkdtempSync(p.join(o.tmpdir(), 'ccm-user-settings-'));
});
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const KEY = 'graph.foldFilesWhenZoomedOut';
const FILE = path.join(userData, 'settings.json');
const BINDINGS = 'keymap.bindings';
const REVIEW = { key: 'mod+shift+l', command: 'lantern.open' };
const CORRUPT = '{ "graph.foldFilesWhenZoomedOut": false,, }';

let store: typeof import('../src/main/settings-store');

const write = (text: string) => fs.writeFileSync(FILE, text);
const read = () => fs.readFileSync(FILE, 'utf8');

beforeEach(async () => {
  fs.rmSync(FILE, { force: true });
  vi.resetModules();
  store = await import('../src/main/settings-store');
});

afterEach(() => {
  store.unwatch();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const entry of fs.readdirSync(userData)) fs.rmSync(path.join(userData, entry), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));

describe('settings store: load and update', () => {
  it('uses the defaults when the file is missing and creates nothing on load', () => {
    expect(store.load()).toEqual({ values: SETTING_DEFAULTS, modified: [], problems: [], writable: true });
    expect(store.get(KEY)).toBe(true);
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it('persists an update that a fresh import sees', async () => {
    store.load();
    const result = store.update(KEY, false);
    expect(result).toMatchObject({ ok: true, snapshot: { values: { [KEY]: false }, modified: [KEY] } });
    expect(JSON.parse(read())).toEqual({ [KEY]: false });

    vi.resetModules();
    const reloaded = await import('../src/main/settings-store');
    expect(reloaded.load().values[KEY]).toBe(false);
  });

  it('removes the key when set to the default and keeps unknown keys and comments', () => {
    write(`{\n  // mine\n  "other.thing": 1,\n  "${KEY}": false\n}\n`);
    store.load();
    expect(store.update(KEY, true)).toMatchObject({ ok: true, snapshot: { modified: [] } });
    const text = read();
    expect(text).toContain('// mine');
    expect(text).toContain('"other.thing": 1');
    expect(text).not.toContain(KEY);
  });

  it('refuses an unknown key or an invalid value', () => {
    store.load();
    expect(store.update('graph.nope', true)).toMatchObject({ ok: false });
    expect(store.update(KEY, 'yes')).toMatchObject({ ok: false });
    expect(store.update(42, true)).toMatchObject({ ok: false });
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it('falls back to defaults on a corrupt file and refuses writes without touching it', () => {
    write(CORRUPT);
    const loaded = store.load();
    expect(loaded.values).toEqual(SETTING_DEFAULTS);
    expect(loaded.writable).toBe(false);
    expect(loaded.problems.length).toBeGreaterThan(0);
    expect(store.update(KEY, false)).toMatchObject({ ok: false });
    expect(read()).toBe(CORRUPT);
  });

  it('re-reads the file before writing and refuses when it broke after load', () => {
    store.load();
    write(CORRUPT);
    expect(store.update(KEY, false)).toMatchObject({ ok: false });
    expect(read()).toBe(CORRUPT);
    expect(store.snapshot().writable).toBe(false);
  });

  it('does not rewrite a file with a byte order mark on a no-op update', () => {
    const text = `\uFEFF{ "other.thing": 1 }`;
    write(text);
    store.load();
    expect(store.update(KEY, true)).toMatchObject({ ok: true });
    expect(read()).toBe(text);
  });

  it('resets the only key with a trailing comma to a file that still parses', () => {
    write(`{\n  "${KEY}": false,\n}\n`);
    store.load();
    expect(store.update(KEY, true)).toMatchObject({ ok: true, snapshot: { modified: [], writable: true } });
    expect(read()).toBe('{}\n');
    expect(store.reload()).toEqual([]);
    expect(store.snapshot().writable).toBe(true);
  });

  it('creates an empty object file only when missing', () => {
    store.ensureFile();
    expect(read()).toBe('{}\n');
    write(`{ "${KEY}": false }`);
    store.ensureFile();
    expect(read()).toBe(`{ "${KEY}": false }`);
  });
});

describe('settings store: key bindings', () => {
  it('persists bindings and removes them again when reset to the empty default', () => {
    store.load();
    expect(store.update(BINDINGS, [REVIEW])).toMatchObject({ ok: true, snapshot: { modified: [BINDINGS] } });
    expect(JSON.parse(read())).toEqual({ [BINDINGS]: [REVIEW] });
    expect(store.get(BINDINGS)).toEqual([REVIEW]);
    expect(store.update(BINDINGS, [])).toMatchObject({ ok: true, snapshot: { modified: [] } });
    expect(read()).not.toContain(BINDINGS);
  });

  it('refuses to write an unknown command or a malformed entry', () => {
    store.load();
    expect(store.update(BINDINGS, [{ key: 'mod+r', command: 'nope' }])).toMatchObject({ ok: false });
    expect(store.update(BINDINGS, [{ key: 'mod+r' }])).toMatchObject({ ok: false });
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it.each([
    ['an unknown command id', { key: 'mod+r', command: 'review.nope' }],
    ['a malformed entry', { key: 'mod+r+t', command: 'lantern.open' }],
  ])('reports %s in settings.json and keeps the default bindings', (_name, bad) => {
    write(JSON.stringify({ [BINDINGS]: [REVIEW, bad] }));
    const loaded = store.load();
    expect(loaded.values[BINDINGS]).toEqual([]);
    expect(loaded.modified).toEqual([]);
    expect(loaded.writable).toBe(true);
    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]).toContain(`"${BINDINGS}"`);
  });

  it('restores the bindings once the bad entry is fixed and stays quiet on a same-content reload', () => {
    write(JSON.stringify({ [BINDINGS]: [{ key: 'mod+r', command: 'nope' }] }));
    store.load();
    write(JSON.stringify({ [BINDINGS]: [REVIEW] }));
    expect(store.reload()).toEqual([BINDINGS]);
    expect(store.snapshot()).toMatchObject({ values: { [BINDINGS]: [REVIEW] }, problems: [] });
    const listener = vi.fn();
    store.onDidChange(listener);
    write(JSON.stringify({ [BINDINGS]: [REVIEW], other: 1 }));
    expect(store.reload()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('settings store: atomic write', () => {
  const leftovers = (dir: string) => fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));

  it('writes through a symlinked settings.json and keeps the link', () => {
    const realDir = path.join(userData, 'dotfiles');
    const target = path.join(realDir, 'settings.json');
    fs.mkdirSync(realDir);
    fs.writeFileSync(target, '{}\n');
    fs.symlinkSync(target, FILE);
    store.load();
    expect(store.update(KEY, false)).toMatchObject({ ok: true });
    expect(fs.lstatSync(FILE).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ [KEY]: false });
    expect(leftovers(realDir)).toEqual([]);
    expect(leftovers(userData)).toEqual([]);
  });

  it('writes the target of a dangling symlink', () => {
    const target = path.join(userData, 'elsewhere.json');
    fs.symlinkSync(target, FILE);
    store.load();
    expect(store.update(KEY, false)).toMatchObject({ ok: true });
    expect(fs.lstatSync(FILE).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ [KEY]: false });
  });

  it.skipIf(process.platform === 'win32')('keeps the mode of the existing file', () => {
    write('{}\n');
    fs.chmodSync(FILE, 0o600);
    store.load();
    expect(store.update(KEY, false)).toMatchObject({ ok: true });
    expect(fs.statSync(FILE).mode & 0o777).toBe(0o600);
  });

  it('syncs the data to disk before the rename and leaves no temp file', () => {
    const calls: string[] = [];
    const fsync = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => void calls.push('fsync'));
    const rename = vi.spyOn(fs, 'renameSync');
    rename.mockImplementation((from, to) => {
      calls.push('rename');
      fs.cpSync(String(from), String(to));
      fs.rmSync(String(from));
    });
    store.load();
    expect(store.update(KEY, false)).toMatchObject({ ok: true });
    expect(calls).toEqual(['fsync', 'rename']);
    expect(fsync).toHaveBeenCalledOnce();
    expect(leftovers(userData)).toEqual([]);
  });

  it('uses a different temp file for every write', () => {
    const temps: string[] = [];
    const open = vi.spyOn(fs, 'openSync');
    store.load();
    store.update(KEY, false);
    store.update(KEY, true);
    for (const call of open.mock.calls) temps.push(String(call[0]));
    expect(new Set(temps).size).toBe(temps.length);
    expect(temps.length).toBeGreaterThanOrEqual(2);
  });

  it('removes its temp file when the rename fails', () => {
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    store.load();
    expect(store.update(KEY, false)).toEqual({ ok: false, error: 'disk full' });
    expect(leftovers(userData)).toEqual([]);
  });
});

describe('settings store: watcher errors', () => {
  function fakeWatchers() {
    const created: EventEmitter[] = [];
    const watch = vi.spyOn(fs, 'watch').mockImplementation((() => {
      const fake = Object.assign(new EventEmitter(), { close: vi.fn() });
      created.push(fake);
      return fake;
    }) as unknown as typeof fs.watch);
    return { created, watch };
  }

  it('logs the error and re-attaches after a delay', () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { created } = fakeWatchers();
    store.load();
    store.watch();
    expect(created).toHaveLength(1);
    created[0].emit('error', new Error('EMFILE'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('watching settings.json failed'), expect.any(Error));
    expect(created).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(created).toHaveLength(2);
  });

  it('reloads after re-attaching to catch edits made while it was not watching', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { created } = fakeWatchers();
    store.load();
    const listener = vi.fn();
    store.onDidChange(listener);
    store.watch();
    write(`{ "${KEY}": false }`);
    created[0].emit('error', new Error('EMFILE'));
    vi.advanceTimersByTime(1000 + 50);
    expect(listener).toHaveBeenCalledWith(expect.anything(), [KEY]);
  });

  it('gives up after a bounded number of retries', () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { created } = fakeWatchers();
    store.load();
    store.watch();
    for (let i = 0; i < 20; i += 1) {
      created[created.length - 1].emit('error', new Error('EMFILE'));
      vi.advanceTimersByTime(1000);
    }
    expect(created.length).toBe(6);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('giving up'));
  });

  it('stops retrying once unwatched', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { created } = fakeWatchers();
    store.load();
    store.watch();
    created[0].emit('error', new Error('EMFILE'));
    store.unwatch();
    vi.advanceTimersByTime(5000);
    expect(created).toHaveLength(1);
  });
});

describe('settings store: change events', () => {
  it('emits once for a real change and not for a same-value write', () => {
    store.load();
    const listener = vi.fn();
    store.onDidChange(listener);
    store.update(KEY, false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ [KEY]: false }) }), [KEY]);
    store.update(KEY, false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emits the changed key when reload picks up an external edit', () => {
    store.load();
    const listener = vi.fn();
    store.onDidChange(listener);
    write(`{ "${KEY}": false }`);
    expect(store.reload()).toEqual([KEY]);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ writable: true }), [KEY]);
  });

  it('emits with no changed keys when the file breaks and again when it is fixed', () => {
    store.load();
    const listener = vi.fn();
    store.onDidChange(listener);
    write(CORRUPT);
    store.reload();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ writable: false }), []);
    write('{}');
    store.reload();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ writable: true, problems: [] }), []);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good values when the file breaks after a load and emits the real difference once fixed', () => {
    write(`{ "${KEY}": false }`);
    store.load();
    const listener = vi.fn();
    store.onDidChange(listener);
    write(CORRUPT);
    expect(store.reload()).toEqual([]);
    expect(store.snapshot()).toMatchObject({ values: { [KEY]: false }, modified: [KEY], writable: false });
    expect(store.get(KEY)).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ writable: false }), []);
    write(`{ "${KEY}": false }`);
    expect(store.reload()).toEqual([]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ writable: true, problems: [] }), []);
    write('{}');
    expect(store.reload()).toEqual([KEY]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('isolates a throwing listener from the others and from the update result', () => {
    store.load();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    store.onDidChange(() => {
      throw new Error('boom');
    });
    store.onDidChange(second);
    expect(store.update(KEY, false)).toMatchObject({ ok: true });
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('stops emitting after the listener unsubscribes', () => {
    store.load();
    const listener = vi.fn();
    store.onDidChange(listener)();
    store.update(KEY, false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('reloads on an external edit while watching', async () => {
    store.load();
    const listener = vi.fn();
    store.onDidChange(listener);
    store.watch();
    // FSEvents can miss a write made right after the watch starts, so each retry writes again.
    await vi.waitFor(
      () => {
        write(`{ "${KEY}": false }`);
        expect(listener).toHaveBeenCalledWith(expect.anything(), [KEY]);
      },
      { timeout: 5000, interval: 200 },
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('settings store: project settings', () => {
  const projectDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-settings-'));
    fs.mkdirSync(path.join(dir, '.lantern'));
    return dir;
  };

  it('reads a valid value from .lantern/settings.json, comments allowed', () => {
    const dir = projectDir();
    fs.writeFileSync(path.join(dir, '.lantern', 'settings.json'), '{\n  // the team writes in polish\n  "language.map": "polish"\n}');
    expect(store.projectSetting(dir, 'language.map')).toBe('polish');
    expect(store.projectSetting(dir, 'language.explainers')).toBeUndefined();
  });

  it('ignores a value of the wrong type, a missing file and a broken one', () => {
    const dir = projectDir();
    expect(store.projectSetting(dir, 'language.map')).toBeUndefined();
    fs.writeFileSync(path.join(dir, '.lantern', 'settings.json'), '{ "language.map": "klingon", "graph.foldFilesWhenZoomedOut": "yes" }');
    expect(store.projectSetting(dir, 'language.map')).toBeUndefined();
    expect(store.projectSetting(dir, 'graph.foldFilesWhenZoomedOut')).toBeUndefined();
    fs.writeFileSync(path.join(dir, '.lantern', 'settings.json'), '{ not json');
    expect(store.projectSetting(dir, 'language.map')).toBeUndefined();
  });
});
