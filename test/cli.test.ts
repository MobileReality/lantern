import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareArg, install, projectArg, scriptPath, status, uninstall } from '../src/main/cli';

describe('projectArg', () => {
  let tmp: string;
  let project: string;
  const argv = (value: string) => ['/Applications/Lantern.app/Contents/MacOS/Lantern', `--project=${value}`];

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-arg-')));
    project = path.join(tmp, 'my project');
    fs.mkdirSync(project);
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reads the project from a packaged app argv', () => {
    expect(projectArg(argv(project), '/')).toBe(project);
  });

  it('reads the project from a dev electron argv', () => {
    expect(projectArg(['electron', 'out', `--project=${project}`], '/')).toBe(project);
  });

  it('returns null without the flag', () => {
    expect(projectArg(['/Applications/Lantern.app/Contents/MacOS/Lantern', '--inspect'], tmp)).toBeNull();
  });

  it('returns null for an empty value', () => {
    expect(projectArg(['electron', '--project='], tmp)).toBeNull();
  });

  it('resolves a relative project against the launch directory', () => {
    expect(projectArg(['electron', '--project=.'], project)).toBe(project);
    expect(projectArg(['electron', '--project=../my project'], project)).toBe(project);
  });

  it('drops a trailing slash so one project maps to one window', () => {
    expect(projectArg(argv(`${project}/`), '/')).toBe(project);
  });

  it('rejects a folder that does not exist', () => {
    expect(projectArg(argv(path.join(tmp, 'missing')), '/')).toBeNull();
  });

  it('rejects a file', () => {
    const file = path.join(tmp, 'notes.txt');
    fs.writeFileSync(file, '');
    expect(projectArg(argv(file), '/')).toBeNull();
  });

  it('rejects a link to nowhere', () => {
    const dangling = path.join(tmp, 'dangling');
    fs.symlinkSync(path.join(tmp, 'gone'), dangling);
    expect(projectArg(argv(dangling), '/')).toBeNull();
  });

  it('resolves a symlink to the real folder so both spellings share one window', () => {
    const alias = path.join(tmp, 'alias');
    fs.symlinkSync(project, alias);
    expect(projectArg(argv(alias), '/')).toBe(project);
  });
});

describe('scriptPath', () => {
  it('uses the resources folder in the packaged app, outside app.asar', () => {
    expect(scriptPath(true, '/A/Lantern.app/Contents/Resources', '/A/Lantern.app/Contents/Resources/app.asar')).toBe('/A/Lantern.app/Contents/Resources/cli/lantern');
  });

  it('uses the compiled out folder in development', () => {
    expect(scriptPath(false, '/electron/Resources', '/repo/out')).toBe('/repo/out/cli/lantern');
  });
});

describe('lantern command install', () => {
  let tmp: string;
  let script: string;
  let link: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-cli-')));
    script = path.join(tmp, 'app', 'cli', 'lantern');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, '#!/bin/sh\n');
    link = path.join(tmp, 'bin', 'lantern');
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reports a missing link', () => {
    expect(status(script, link)).toEqual({ state: 'missing', link, script, target: null });
  });

  it('links the script, creating the bin folder', async () => {
    expect(await install(script, link)).toEqual({ state: 'installed', link, script, target: script });
    expect(fs.readlinkSync(link)).toBe(script);
  });

  it('reinstalls over its own link', async () => {
    await install(script, link);
    expect((await install(script, link)).state).toBe('installed');
  });

  it('reports a link to a script that no longer exists as missing', async () => {
    await install(script, link);
    fs.rmSync(script);
    expect(status(script, link).state).toBe('missing');
  });

  it('reports a link to another command and leaves it alone on install', async () => {
    const elsewhere = path.join(tmp, 'Other.app', 'lantern');
    fs.mkdirSync(path.dirname(link));
    fs.symlinkSync(elsewhere, link);
    expect(status(script, link)).toMatchObject({ state: 'other', target: elsewhere });
    expect(await install(script, link)).toMatchObject({ state: 'other', target: elsewhere });
    expect(fs.readlinkSync(link)).toBe(elsewhere);
  });

  it('reports a plain file in the way as another command and keeps its content', async () => {
    fs.mkdirSync(path.dirname(link));
    fs.writeFileSync(link, 'mine');
    expect(status(script, link)).toMatchObject({ state: 'other', target: null });
    expect(await install(script, link)).toMatchObject({ state: 'other', target: null });
    expect(fs.readFileSync(link, 'utf8')).toBe('mine');
  });

  it('removes its own link on uninstall', async () => {
    await install(script, link);
    expect(await uninstall(script, link)).toEqual({ state: 'missing', link, script, target: null });
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(script)).toBe(true);
  });

  it('removes its own link even when the script is gone', async () => {
    await install(script, link);
    fs.rmSync(script);
    expect((await uninstall(script, link)).state).toBe('missing');
    expect(() => fs.lstatSync(link)).toThrow();
  });

  it('leaves a link to another command alone on uninstall', async () => {
    const elsewhere = path.join(tmp, 'Other.app', 'lantern');
    fs.mkdirSync(path.dirname(link));
    fs.symlinkSync(elsewhere, link);
    expect(await uninstall(script, link)).toMatchObject({ state: 'other', target: elsewhere });
    expect(fs.readlinkSync(link)).toBe(elsewhere);
  });

  it('leaves a plain file in the way alone on uninstall', async () => {
    fs.mkdirSync(path.dirname(link));
    fs.writeFileSync(link, 'mine');
    expect(await uninstall(script, link)).toMatchObject({ state: 'other', target: null });
    expect(fs.readFileSync(link, 'utf8')).toBe('mine');
  });

  it('uninstalls cleanly when nothing is installed', async () => {
    expect(await uninstall(script, link)).toEqual({ state: 'missing', link, script, target: null });
  });
});

describe('compareArg', () => {
  const argv = (value: string) => ['/Applications/Lantern.app/Contents/MacOS/Lantern', '--project=/p', `--compare=${value}`];

  it('reads base..head and base...head as one review', () => {
    expect(compareArg(argv('origin/main..feat/x'))).toBe('local:cmp:origin/main|feat/x');
    expect(compareArg(argv('origin/main...feat/x'))).toBe('local:cmp:origin/main|feat/x');
    expect(compareArg(argv('main..a1b2c3d'))).toBe('local:cmp:main|a1b2c3d');
    expect(compareArg(argv('v1.2..HEAD'))).toBe('local:cmp:v1.2|HEAD');
  });

  it('reads a missing head, @ and worktree as the working tree', () => {
    expect(compareArg(argv('origin/main'))).toBe('local:cmp:origin/main|@');
    expect(compareArg(argv('main..'))).toBe('local:cmp:main|@');
    expect(compareArg(argv('main..@'))).toBe('local:cmp:main|@');
    expect(compareArg(argv('main..worktree'))).toBe('local:cmp:main|@');
  });

  it('returns null without the flag or for a value that is not a comparison', () => {
    expect(compareArg(['/x', '--project=/p'])).toBeNull();
    expect(compareArg(argv(''))).toBeNull();
    expect(compareArg(argv('-x..main'))).toBeNull();
    expect(compareArg(argv('@..main'))).toBeNull();
    expect(compareArg(argv('a|b'))).toBeNull();
  });
});
