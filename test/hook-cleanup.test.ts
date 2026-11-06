import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const userData = vi.hoisted(() => '/tmp/lantern-hook-test-user-data');
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

import { runCleanups } from '../src/main/hook-cleanup';
import { uninstallFrom as uninstallEventHooks } from '../src/main/hooks';
import { uninstallFrom as uninstallNotifierHooks } from '../src/main/notifier';

let temp = '';

afterEach(() => {
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  temp = '';
});

function settingsText(text: string) {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-hooks-'));
  const file = path.join(temp, 'settings.json');
  fs.writeFileSync(file, text);
  return file;
}

function settingsFile(value: unknown) {
  return settingsText(`${JSON.stringify(value, null, 2)}\n`);
}

describe('legacy hook cleanup', () => {
  it('removes only the old event entry from a mixed group and backs up the original', () => {
    const own = 'curl -X POST http://127.0.0.1:31337/event';
    const other = { type: 'command', command: 'echo keep-me' };
    const file = settingsFile({
      hooks: {
        Stop: [{ matcher: '*', hooks: [{ type: 'command', command: own }, other] }],
        NewSchema: { version: 2, entries: ['keep'] },
        EmptyEvent: [],
      },
    });
    const original = fs.readFileSync(file, 'utf8');

    const result = uninstallEventHooks(file);

    expect(result.changed).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).hooks).toEqual({
      Stop: [{ matcher: '*', hooks: [other] }],
      NewSchema: { version: 2, entries: ['keep'] },
      EmptyEvent: [],
    });
    expect(fs.readFileSync(result.backup!, 'utf8')).toBe(original);
  });

  it('removes only exact Lantern notifier entries and preserves nearby user commands', () => {
    const own = `MRCH_TOKEN_FILE='/old/notifier.token' MRCH_PORT=31337 bash '/old/notify-hooks/notify.sh'`;
    const similar = { type: 'command', command: `bash '/other/notify-hooks/notify.sh'` };
    const other = { type: 'command', command: 'powershell -File notify.ps1 -TokenFile personal-notifier.token' };
    const file = settingsFile({ hooks: { Notification: [{ matcher: '*', hooks: [{ type: 'command', command: own }, similar, other] }] } });
    const installedDir = path.join(temp, 'notify-hooks');
    const original = fs.readFileSync(file, 'utf8');

    const result = uninstallNotifierHooks(file, installedDir);

    expect(result.changed).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Notification).toEqual([{ matcher: '*', hooks: [similar, other] }]);
    expect(fs.readFileSync(result.backup!, 'utf8')).toBe(original);
  });

  it('removes a notifier entry that points into the current hooks directory', () => {
    const file = settingsFile({ hooks: {} });
    const installedDir = path.join(temp, 'notify-hooks');
    const own = `bash '${path.join(installedDir, 'notify.sh')}'`;
    fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: own }] }] } }));

    expect(uninstallNotifierHooks(file, installedDir).changed).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({});
  });

  it('leaves settings.json byte for byte alone and writes no backup when nothing is ours', () => {
    const file = settingsFile({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo mine' }] }] }, theme: 'dark' });
    const original = fs.readFileSync(file, 'utf8');

    expect(uninstallEventHooks(file)).toEqual({ changed: false, backup: null });
    expect(uninstallNotifierHooks(file, path.join(temp, 'notify-hooks'))).toEqual({ changed: false, backup: null });

    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.readdirSync(temp)).toEqual(['settings.json']);
  });

  it('reports no change for a missing settings.json without creating it', () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-hooks-'));
    const file = path.join(temp, 'settings.json');

    expect(uninstallEventHooks(file)).toEqual({ changed: false, backup: null });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('throws on a broken settings.json and leaves it untouched', () => {
    const file = settingsText('{ "hooks": { "Stop": [');

    expect(() => uninstallEventHooks(file)).toThrow(/Could not parse/);
    expect(() => uninstallNotifierHooks(file, path.join(temp, 'notify-hooks'))).toThrow(/Could not parse/);

    expect(fs.readFileSync(file, 'utf8')).toBe('{ "hooks": { "Stop": [');
    expect(fs.readdirSync(temp)).toEqual(['settings.json']);
  });

  it('writes through a temporary file so no partial settings.json is ever visible and none is left behind', () => {
    const own = 'curl -X POST http://127.0.0.1:31337/event';
    const file = settingsFile({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: own }] }] }, theme: 'dark' });
    fs.chmodSync(file, 0o600);
    const writeFileSync = vi.spyOn(fs, 'writeFileSync');

    uninstallEventHooks(file);

    expect(writeFileSync.mock.calls.some(([target]) => target === file)).toBe(false);
    writeFileSync.mockRestore();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ theme: 'dark' });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(temp).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('runCleanups', () => {
  it('runs the next cleanup after one throws and reports the failure', () => {
    const calls: string[] = [];
    const reports: string[] = [];

    runCleanups(
      [
        ['event hooks', () => { calls.push('event'); throw new Error('boom'); }],
        ['notifier hooks', () => { calls.push('notifier'); }],
      ],
      (message) => reports.push(message),
    );

    expect(calls).toEqual(['event', 'notifier']);
    expect(reports).toEqual(['legacy event hooks cleanup failed: boom']);
  });
});
