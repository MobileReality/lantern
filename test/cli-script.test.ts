import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SOURCE = path.join(__dirname, '..', 'src', 'cli', 'lantern');
const BUNDLE_ID = 'com.mobilereality.lantern';

let tmp: string;
let stubs: string;
let calls: string;

function install(layout: string[]) {
  const script = path.join(tmp, ...layout, 'lantern');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(SOURCE, script);
  fs.chmodSync(script, 0o755);
  return script;
}

function run(script: string, args: string[], cwd = tmp) {
  const result = spawnSync('/bin/sh', [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` } });
  const recorded = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, open: recorded };
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-script-')));
  stubs = path.join(tmp, 'stubs');
  calls = path.join(tmp, 'open-calls.txt');
  fs.mkdirSync(stubs);
  const open = path.join(stubs, 'open');
  fs.writeFileSync(open, `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg" >> '${calls}'; done\n`);
  fs.chmodSync(open, 0o755);
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(process.platform === 'win32')('the lantern command', () => {
  it('opens the app bundle it lives in, in a new instance, with the folder as --project=', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const folder = path.join(tmp, 'code');
    fs.mkdirSync(folder);
    const result = run(script, [folder]);
    expect(result.status).toBe(0);
    expect(result.open).toEqual(['-n', '-a', path.join(tmp, 'Lantern.app'), '--args', `--project=${folder}`]);
  });

  it('keeps a folder with spaces and quotes in one argument', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const folder = path.join(tmp, "my 'big' project");
    fs.mkdirSync(folder);
    const result = run(script, [folder]);
    expect(result.status).toBe(0);
    expect(result.open.at(-1)).toBe(`--project=${folder}`);
    expect(result.open).toHaveLength(5);
  });

  it('resolves a relative folder and a dot against the directory it was run in', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const folder = path.join(tmp, 'code');
    fs.mkdirSync(path.join(folder, 'app'), { recursive: true });
    expect(run(script, ['.'], folder).open.at(-1)).toBe(`--project=${folder}`);
    expect(run(script, ['app'], folder).open.at(-1)).toBe(`--project=${path.join(folder, 'app')}`);
  });

  it('passes the real path of a symlinked folder so both spellings open one window', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const folder = path.join(tmp, 'code');
    fs.mkdirSync(folder);
    const alias = path.join(tmp, 'alias');
    fs.symlinkSync(folder, alias);
    expect(run(script, [alias]).open.at(-1)).toBe(`--project=${folder}`);
  });

  it('finds its app through a symlink in the PATH, such as /usr/local/bin/lantern', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const link = path.join(tmp, 'bin', 'lantern');
    fs.mkdirSync(path.dirname(link));
    fs.symlinkSync(script, link);
    const folder = path.join(tmp, 'code');
    fs.mkdirSync(folder);
    expect(run(link, [folder]).open).toEqual(['-n', '-a', path.join(tmp, 'Lantern.app'), '--args', `--project=${folder}`]);
  });

  it('opens just the app when no folder is given', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    expect(run(script, []).open).toEqual(['-n', '-a', path.join(tmp, 'Lantern.app')]);
  });

  it('falls back to the bundle id when it does not live inside an .app', () => {
    const script = install(['out', 'cli']);
    const folder = path.join(tmp, 'code');
    fs.mkdirSync(folder);
    expect(run(script, [folder]).open).toEqual(['-n', '-b', BUNDLE_ID, '--args', `--project=${folder}`]);
  });

  it('reads a folder named like an option through "-"', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const folder = path.join(tmp, 'code');
    fs.mkdirSync(path.join(folder, '-'), { recursive: true });
    expect(run(script, ['-'], folder).open.at(-1)).toBe(`--project=${path.join(folder, '-')}`);
  });

  it('refuses a folder that does not exist without opening anything', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const result = run(script, [path.join(tmp, 'missing')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lantern: no such directory');
    expect(result.open).toEqual([]);
  });

  it('refuses a file and more than one folder, and prints usage for --help', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const file = path.join(tmp, 'notes.txt');
    fs.writeFileSync(file, '');
    expect(run(script, [file]).status).toBe(1);
    const two = run(script, [tmp, tmp]);
    expect(two.status).toBe(2);
    expect(two.stderr).toContain('Usage: lantern [folder]');
    const help = run(script, ['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: lantern [folder]');
    expect([...two.open, ...help.open]).toEqual([]);
  });

  it('passes --compare with the current folder when no folder is given', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const folder = path.join(tmp, 'code');
    fs.mkdirSync(folder);
    const short = run(script, ['--compare', 'origin/main..feat/x'], folder);
    expect(short.status).toBe(0);
    expect(short.open.slice(-2)).toEqual([`--project=${folder}`, '--compare=origin/main..feat/x']);
  });

  it('takes --compare=spec after a folder', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const folder = path.join(tmp, 'code');
    fs.mkdirSync(folder);
    const result = run(script, [folder, '--compare=main']);
    expect(result.status).toBe(0);
    expect(result.open.slice(-2)).toEqual([`--project=${folder}`, '--compare=main']);
  });

  it('refuses a comparison with shell characters or a missing value, and an unknown option', () => {
    const script = install(['Lantern.app', 'Contents', 'Resources', 'cli']);
    const bad = run(script, ['--compare', 'main;rm -rf ~']);
    const missing = run(script, ['--compare']);
    const unknown = run(script, ['--nope']);
    expect([bad.status, missing.status, unknown.status]).toEqual([2, 2, 2]);
    expect([...bad.open, ...missing.open, ...unknown.open]).toEqual([]);
  });
});
