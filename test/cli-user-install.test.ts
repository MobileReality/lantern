import { describe, expect, it } from 'vitest';
import { scriptPath } from '../src/main/cli';
import { installUserCli, userCliStatus } from '../src/main/cli-user-install';
import type { CliContext, CliPort } from '../src/main/cli-user-install';

const LINUX_SCRIPT = '/opt/Lantern-linux-x64/resources/cli/lantern';
const WIN_SCRIPT = 'C:\\Users\\ann\\AppData\\Local\\Programs\\Lantern\\resources\\cli\\lantern.cmd';

function fakePort(initial: { files?: Record<string, string>; links?: Record<string, string>; userPath?: string | null } = {}) {
  const files = new Map(Object.entries(initial.files ?? {}));
  const links = new Map(Object.entries(initial.links ?? {}));
  const state = { userPath: initial.userPath ?? null, pathWrites: [] as string[], dirs: [] as string[] };
  const port: CliPort = {
    exists: (file) => files.has(file) || links.has(file),
    readlink: (file) => links.get(file) ?? null,
    readText: (file) => files.get(file) ?? null,
    mkdirp: (dir) => void state.dirs.push(dir),
    writeText: (file, text) => void files.set(file, text),
    symlink: (target, link) => void links.set(link, target),
    remove: (file) => void (files.delete(file), links.delete(file)),
    readUserPath: async () => state.userPath,
    writeUserPath: async (value) => {
      state.pathWrites.push(value);
      state.userPath = value;
    },
  };
  return { port, files, links, state };
}

const linux = (port: CliPort, PATH: string): CliContext => ({ platform: 'linux', home: '/home/ann', env: { PATH }, script: LINUX_SCRIPT, port });
const windows = (port: CliPort, env: Record<string, string> = { LOCALAPPDATA: 'C:\\Users\\ann\\AppData\\Local' }): CliContext => ({ platform: 'win32', home: 'C:\\Users\\ann', env, script: WIN_SCRIPT, port });

describe('Linux install', () => {
  const bin = '/home/ann/.local/bin';
  const launcher = `${bin}/lantern`;

  it('links the packaged script into ~/.local/bin, creating the folder, without a PATH hint when it is on PATH', async () => {
    const { port, links, state } = fakePort({ files: { [LINUX_SCRIPT]: '#!/bin/sh' } });
    const result = await installUserCli(linux(port, `/usr/bin:${bin}`));
    expect(links.get(launcher)).toBe(LINUX_SCRIPT);
    expect(state.dirs).toEqual([bin]);
    expect(result).toEqual({ state: 'installed', link: launcher, script: LINUX_SCRIPT, target: LINUX_SCRIPT, platform: 'linux', note: null });
  });

  it('tells the user what to add to PATH when ~/.local/bin is missing from it', async () => {
    const { port } = fakePort({ files: { [LINUX_SCRIPT]: '#!/bin/sh' } });
    const result = await installUserCli(linux(port, '/usr/bin:/bin'));
    expect(result?.state).toBe('installed');
    expect(result?.note).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect((await userCliStatus(linux(port, '/usr/bin')))?.note).toContain('~/.local/bin is not on your PATH');
  });

  it('leaves a launcher it did not install alone', async () => {
    const { port, links } = fakePort({ files: { [LINUX_SCRIPT]: '#!/bin/sh' }, links: { [launcher]: '/elsewhere/lantern' } });
    const result = await installUserCli(linux(port, bin));
    expect(result).toMatchObject({ state: 'other', target: '/elsewhere/lantern' });
    expect(links.get(launcher)).toBe('/elsewhere/lantern');
  });

  it('reports missing and installs over a stale link of its own after the app moved', async () => {
    const { port, links } = fakePort({ files: { [LINUX_SCRIPT]: '#!/bin/sh' } });
    expect((await userCliStatus(linux(port, bin)))?.state).toBe('missing');
    links.set(launcher, LINUX_SCRIPT);
    expect((await userCliStatus(linux(port, bin)))?.state).toBe('installed');
  });
});

describe('Windows install', () => {
  const dir = 'C:\\Users\\ann\\AppData\\Local\\Lantern\\bin';
  const shim = `${dir}\\lantern.cmd`;

  it('writes the lantern.cmd shim that calls the packaged script and adds the folder to the user PATH', async () => {
    const { port, files, state } = fakePort({ files: { [WIN_SCRIPT]: '@echo off' }, userPath: 'C:\\Tools;%USERPROFILE%\\bin;' });
    const result = await installUserCli(windows(port));
    expect(files.get(shim)).toContain(`call "${WIN_SCRIPT}" %*`);
    expect(state.dirs).toEqual([dir]);
    expect(state.pathWrites).toEqual([`C:\\Tools;%USERPROFILE%\\bin;${dir}`]);
    expect(result).toMatchObject({ state: 'installed', link: shim, platform: 'win32' });
    expect(result?.note).toContain('Open a new terminal');
  });

  it('does not touch the PATH when the folder is already on it, ignoring case and a trailing slash', async () => {
    const { port, files, state } = fakePort({ files: { [WIN_SCRIPT]: '@echo off' }, userPath: `C:\\Tools;${dir.toLowerCase()}\\` });
    const result = await installUserCli(windows(port));
    expect(files.has(shim)).toBe(true);
    expect(state.pathWrites).toEqual([]);
    expect(result).toMatchObject({ state: 'installed', note: null });
  });

  it('starts a PATH when the user has none, and falls back to the home folder without LOCALAPPDATA', async () => {
    const { port, state } = fakePort({ files: { [WIN_SCRIPT]: '@echo off' } });
    await installUserCli(windows(port, {}));
    expect(state.pathWrites).toEqual([dir]);
  });

  it('refuses to overwrite a lantern.cmd it did not write and rewrites its own after a move', async () => {
    const foreign = fakePort({ files: { [WIN_SCRIPT]: '@echo off', [shim]: '@echo hi' }, userPath: '' });
    expect(await installUserCli(windows(foreign.port))).toMatchObject({ state: 'other' });
    expect(foreign.files.get(shim)).toBe('@echo hi');
    expect(foreign.state.pathWrites).toEqual([]);

    const stale = fakePort({ files: { [WIN_SCRIPT]: '@echo off', [shim]: '@echo off\r\nrem lantern-cli-shim\r\ncall "D:\\Old\\lantern.cmd" %*\r\n' }, userPath: dir });
    expect((await userCliStatus(windows(stale.port)))?.state).toBe('missing');
    expect((await installUserCli(windows(stale.port)))?.state).toBe('installed');
  });
});

describe('macOS and the command script path', () => {
  it('leaves macOS to the existing installer', async () => {
    const { port } = fakePort();
    expect(await installUserCli({ ...linux(port, ''), platform: 'darwin' })).toBeNull();
    expect(await userCliStatus({ ...linux(port, ''), platform: 'darwin' })).toBeNull();
  });

  it('points at lantern.cmd on Windows and lantern elsewhere', () => {
    expect(scriptPath(true, 'C:\\App\\resources', 'x', 'win32')).toMatch(/cli[\\/]lantern\.cmd$/);
    expect(scriptPath(true, '/app/resources', 'x', 'linux')).toBe('/app/resources/cli/lantern');
    expect(scriptPath(true, '/A.app/Contents/Resources', 'x')).toBe('/A.app/Contents/Resources/cli/lantern');
  });
});
