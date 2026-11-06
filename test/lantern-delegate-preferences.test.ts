import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module, no declarations
import { DELIVERY, PREFERENCE_VALUES, PreferenceError, preferencesPath, readPreferences, run, setPreference, storedPreference } from '../skills/lantern-delegate/scripts/preferences.mjs';

const SCRIPT = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts', 'preferences.mjs');

let project: string;

beforeEach(() => {
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-prefs-')));
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

const fileOf = () => path.join(project, '.claude', 'lantern-preferences.json');
const stored = () => JSON.parse(fs.readFileSync(fileOf(), 'utf8'));

function cli(args: string[], cwd = project) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { code: res.status, out: res.stdout.trim(), err: res.stderr.trim() };
}

describe('delivery values', () => {
  it('are pr, push and local, and the stored file sits in the project .claude folder', () => {
    expect(Object.values(DELIVERY)).toEqual(['pr', 'push', 'local']);
    expect(PREFERENCE_VALUES.delivery).toEqual(['pr', 'push', 'local']);
    expect(preferencesPath(project)).toBe(fileOf());
  });
});

describe('preferences module', () => {
  it('reads nothing as unset, without creating anything', () => {
    expect(storedPreference(project, 'delivery')).toBeNull();
    expect(readPreferences(project)).toEqual({});
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });

  it.each(['pr', 'push', 'local'])('creates the folder and the file when it stores %s, and reads it back', (value) => {
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
    expect(setPreference(project, 'delivery', value)).toBe(fileOf());
    expect(stored()).toEqual({ delivery: value });
    expect(storedPreference(project, 'delivery')).toBe(value);
  });

  it('updates the value in place', () => {
    setPreference(project, 'delivery', 'pr');
    setPreference(project, 'delivery', 'local');
    expect(stored()).toEqual({ delivery: 'local' });
  });

  it('keeps every other key, nested ones included, and an existing .claude folder', () => {
    fs.mkdirSync(path.join(project, '.claude'));
    fs.writeFileSync(path.join(project, '.claude', 'settings.local.json'), '{}');
    fs.writeFileSync(fileOf(), JSON.stringify({ other: { keep: [1, 2] }, delivery: 'pr', theme: 'dark' }));
    setPreference(project, 'delivery', 'push');
    expect(stored()).toEqual({ other: { keep: [1, 2] }, delivery: 'push', theme: 'dark' });
    expect(fs.readFileSync(path.join(project, '.claude', 'settings.local.json'), 'utf8')).toBe('{}');
  });

  it.each(['', 'PR', 'always', 'pull-request', 'push '])('refuses the value %j and writes nothing', (value) => {
    expect(() => setPreference(project, 'delivery', value)).toThrow(PreferenceError);
    expect(fs.existsSync(fileOf())).toBe(false);
  });

  it('refuses an invalid value without touching a file that holds a good one', () => {
    setPreference(project, 'delivery', 'push');
    const before = fs.readFileSync(fileOf(), 'utf8');
    expect(() => setPreference(project, 'delivery', 'nope')).toThrow(/is not a delivery; use one of: pr, push, local/);
    expect(fs.readFileSync(fileOf(), 'utf8')).toBe(before);
  });

  it('refuses a key it does not know', () => {
    expect(() => setPreference(project, 'theme', 'dark')).toThrow(/is not a preference; the only one is delivery/);
    expect(() => storedPreference(project, 'theme')).toThrow(PreferenceError);
  });

  it('refuses to overwrite a file that is not valid JSON or not an object, and leaves it as it was', () => {
    fs.mkdirSync(path.join(project, '.claude'));
    for (const text of ['{ not json', '[1,2]', 'null', '"pr"']) {
      fs.writeFileSync(fileOf(), text);
      expect(() => setPreference(project, 'delivery', 'pr')).toThrow(PreferenceError);
      expect(fs.readFileSync(fileOf(), 'utf8')).toBe(text);
    }
  });

  it('reports a stored value that is not a delivery instead of using it', () => {
    fs.mkdirSync(path.join(project, '.claude'));
    fs.writeFileSync(fileOf(), JSON.stringify({ delivery: 'sometimes' }));
    expect(() => storedPreference(project, 'delivery')).toThrow(/holds delivery "sometimes"/);
  });
});

describe('preferences.mjs on the command line', () => {
  it('says unset until something is stored, then prints the stored value', () => {
    expect(cli(['get', 'delivery'])).toEqual({ code: 0, out: 'unset', err: '' });
    expect(cli(['set', 'delivery', 'push']).code).toBe(0);
    expect(cli(['get', 'delivery'])).toEqual({ code: 0, out: 'push', err: '' });
    expect(stored()).toEqual({ delivery: 'push' });
  });

  it('takes the project from --project, wherever it is run from', () => {
    const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-else-')));
    try {
      expect(cli(['set', 'delivery', 'local', '--project', project], elsewhere).code).toBe(0);
      expect(cli(['get', 'delivery', '--project', project], elsewhere).out).toBe('local');
      expect(fs.existsSync(path.join(elsewhere, '.claude'))).toBe(false);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('exits 1 with the reason for a bad value and 2 with the usage for a bad command', () => {
    const bad = cli(['set', 'delivery', 'sometimes']);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('is not a delivery');
    expect(fs.existsSync(fileOf())).toBe(false);
    for (const args of [[], ['get'], ['set', 'delivery'], ['delete', 'delivery'], ['constructor', 'x'], ['get', 'delivery', 'extra']]) {
      const usage = cli(args);
      expect(usage.code, args.join(' ')).toBe(2);
      expect(usage.err).toContain('usage: node preferences.mjs get delivery');
    }
  });

  it('exits 1 and names the file when the stored one is damaged', () => {
    fs.mkdirSync(path.join(project, '.claude'));
    fs.writeFileSync(fileOf(), '{ broken');
    const result = cli(['get', 'delivery']);
    expect(result.code).toBe(1);
    expect(result.err).toContain(fileOf());
  });

  it('writes through run() to the streams it is given', () => {
    const out: string[] = [];
    const err: string[] = [];
    expect(run(['set', 'delivery', 'pr', '--project', project], { out: (text: string) => out.push(text), err: (text: string) => err.push(text) })).toBe(0);
    expect(out[0]).toContain('delivery is now pr');
    expect(err).toEqual([]);
  });
});
