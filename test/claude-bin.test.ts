import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { binCandidates, resolveBin } from '../src/main/agent';
import {
  binCandidatesFor,
  cachedShellLookup,
  describeNotFound,
  parseShimTarget,
  planLaunch,
  resetShellLookupCache,
  resolveBinFor,
  shellLookup,
} from '../src/main/claude-bin';
import type { BinContext } from '../src/main/claude-bin';

const WIN_HOME = 'C:\\Users\\bartl';
const WIN_ENV = {
  USERPROFILE: WIN_HOME,
  APPDATA: `${WIN_HOME}\\AppData\\Roaming`,
  LOCALAPPDATA: `${WIN_HOME}\\AppData\\Local`,
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS',
  Path: 'C:\\Windows\\system32;C:\\Tools',
};

function ctx(platform: NodeJS.Platform, home: string, env: Record<string, string>, present: string[] = []): BinContext {
  const files = new Set(present);
  return { platform, env, home, exists: (f) => files.has(f) };
}

const noShell = () => null;

beforeEach(resetShellLookupCache);

describe('win32 resolution', () => {
  it('finds the native installer claude.exe in <home>\\.local\\bin', () => {
    const exe = `${WIN_HOME}\\.local\\bin\\claude.exe`;
    expect(resolveBinFor(ctx('win32', WIN_HOME, WIN_ENV, [exe]), '', noShell)).toBe(exe);
  });

  it('finds a claude.exe that is only on PATH', () => {
    const exe = 'C:\\Tools\\claude.exe';
    expect(resolveBinFor(ctx('win32', WIN_HOME, WIN_ENV, [exe]), '', noShell)).toBe(exe);
  });

  it('honours PATHEXT order and ignores extensions that cannot be launched', () => {
    const c = ctx('win32', WIN_HOME, { ...WIN_ENV, PATHEXT: '.VBS;.CMD;.EXE' });
    const list = binCandidatesFor(c).filter((p) => p.startsWith('C:\\Tools\\'));
    expect(list).toEqual(['C:\\Tools\\claude.cmd', 'C:\\Tools\\claude.exe']);
  });

  it('keeps the npm shim ahead of the other locations, as before', () => {
    const cmd = `${WIN_ENV.APPDATA}\\npm\\claude.cmd`;
    const exe = `${WIN_HOME}\\.local\\bin\\claude.exe`;
    expect(resolveBinFor(ctx('win32', WIN_HOME, WIN_ENV, [exe, cmd]), '', noShell)).toBe(cmd);
  });

  it('checks the local Programs and npm exe locations', () => {
    const list = binCandidatesFor(ctx('win32', WIN_HOME, WIN_ENV));
    expect(list).toContain(`${WIN_ENV.LOCALAPPDATA}\\Programs\\claude\\claude.exe`);
    expect(list).toContain(`${WIN_ENV.APPDATA}\\npm\\claude.exe`);
  });

  it('reads the env keys case-insensitively and skips relative PATH entries', () => {
    const c = ctx('win32', WIN_HOME, { PATH: '.;"C:\\Quoted Dir"', pathext: '.exe' });
    expect(binCandidatesFor(c)).toContain('C:\\Quoted Dir\\claude.exe');
    expect(binCandidatesFor(c).some((p) => p.startsWith('.'))).toBe(false);
  });

  it('falls back to where claude, and only accepts a launchable file that exists', () => {
    const exe = 'D:\\Apps\\claude\\claude.exe';
    const c = ctx('win32', WIN_HOME, WIN_ENV, [exe]);
    const run = (file: string, args: string[]) => {
      expect([file, args]).toEqual(['where', ['claude']]);
      return `D:\\Apps\\claude\\claude\r\n${exe}\r\n`;
    };
    expect(shellLookup(c, run)).toBe(exe);
  });

  it('reports nothing found with every place it looked and how to fix it', () => {
    const c = ctx('win32', WIN_HOME, { ...WIN_ENV, LANTERN_CLAUDE_BIN: 'C:\\nope\\claude.exe' });
    expect(resolveBinFor(c, '', noShell)).toBeNull();
    const message = describeNotFound(c, 'C:\\also\\no.exe');
    expect(message).toContain('C:\\nope\\claude.exe');
    expect(message).toContain('C:\\also\\no.exe');
    expect(message).toContain(`${WIN_HOME}\\.local\\bin\\claude.exe`);
    expect(message).toContain('2 folders on PATH');
    expect(message).toContain('where claude');
    expect(message).toContain('LANTERN_CLAUDE_BIN');
    expect(message).toContain('claudeBin');
  });
});

describe('overrides', () => {
  it('puts LANTERN_CLAUDE_BIN, then the setting, before every other candidate', () => {
    const c = ctx('linux', '/home/u', { LANTERN_CLAUDE_BIN: '/opt/a/claude', PATH: '/usr/bin' });
    expect(binCandidatesFor(c, '/opt/b/claude').slice(0, 2)).toEqual(['/opt/a/claude', '/opt/b/claude']);
  });

  it('wins over an install that already resolves, and falls through when it is missing', () => {
    const known = '/home/u/.local/bin/claude';
    const set = ctx('linux', '/home/u', { LANTERN_CLAUDE_BIN: '/opt/a/claude' }, [known, '/opt/a/claude']);
    expect(resolveBinFor(set, '', noShell)).toBe('/opt/a/claude');
    const missing = ctx('linux', '/home/u', { LANTERN_CLAUDE_BIN: '/opt/a/claude' }, [known]);
    expect(resolveBinFor(missing, '', noShell)).toBe(known);
  });

  it('uses the persisted setting when the env is unset', () => {
    expect(resolveBinFor(ctx('darwin', '/Users/u', {}, ['/x/claude']), '/x/claude', noShell)).toBe('/x/claude');
  });
});

describe('darwin and linux resolution', () => {
  it('keeps the original three locations first, in order', () => {
    const list = binCandidatesFor(ctx('darwin', '/Users/u', {}));
    expect(list.slice(0, 3)).toEqual(['/Users/u/.local/bin/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude']);
  });

  it('covers npm-global, volta and fnm locations', () => {
    const list = binCandidatesFor(ctx('linux', '/home/u', {}));
    expect(list).toContain('/home/u/.npm-global/bin/claude');
    expect(list).toContain('/home/u/.volta/bin/claude');
    expect(list).toContain('/home/u/.local/share/fnm/aliases/default/bin/claude');
  });

  it('scans every PATH entry, including an nvm node bin', () => {
    const nvm = '/home/u/.nvm/versions/node/v22.1.0/bin/claude';
    const c = ctx('linux', '/home/u', { PATH: '/usr/sbin::relative/bin:/home/u/.nvm/versions/node/v22.1.0/bin' }, [nvm]);
    expect(resolveBinFor(c, '', noShell)).toBe(nvm);
    expect(binCandidatesFor(c).some((p) => p.startsWith('relative'))).toBe(false);
  });

  it('asks the login shell last, using SHELL, and ignores aliases and noise', () => {
    const real = '/home/u/.fnm/bin/claude';
    const c = ctx('linux', '/home/u', { SHELL: '/usr/bin/fish' }, [real]);
    const calls: Array<[string, string[]]> = [];
    const run = (file: string, args: string[]) => {
      calls.push([file, args]);
      return `Welcome\nalias claude='x'\n${real}\n`;
    };
    expect(resolveBinFor(c, '', run)).toBe(real);
    expect(calls).toEqual([['/usr/bin/fish', ['-ilc', 'command -v claude']]]);
  });

  it('defaults the shell per platform and returns null when it finds nothing', () => {
    const calls: string[] = [];
    const run = (file: string) => (calls.push(file), null);
    expect(shellLookup(ctx('darwin', '/Users/u', {}), run)).toBeNull();
    expect(shellLookup(ctx('linux', '/home/u', {}), run)).toBeNull();
    expect(calls).toEqual(['/bin/zsh', '/bin/bash']);
  });

  it('says nothing found in terms of which claude', () => {
    const message = describeNotFound(ctx('linux', '/home/u', { PATH: '/usr/bin:/bin' }));
    expect(message).toContain('which claude');
    expect(message).toContain('2 folders on PATH');
    expect(message).toContain('your login shell');
  });
});

describe('shell lookup cache', () => {
  it('runs the lookup once while the answer still exists', () => {
    const real = '/x/claude';
    const c = ctx('linux', '/home/u', {}, [real]);
    let runs = 0;
    const run = () => (runs++, `${real}\n`);
    expect(cachedShellLookup(c, run, () => 0)).toBe(real);
    expect(cachedShellLookup(c, run, () => 1e9)).toBe(real);
    expect(runs).toBe(1);
  });

  it('looks again when the cached file is gone', () => {
    const files = new Set(['/x/claude']);
    const c: BinContext = { platform: 'linux', env: {}, home: '/h', exists: (f) => files.has(f) };
    cachedShellLookup(c, () => '/x/claude\n', () => 0);
    files.delete('/x/claude');
    files.add('/y/claude');
    expect(cachedShellLookup(c, () => '/y/claude\n', () => 1)).toBe('/y/claude');
  });

  it('remembers a miss only for a short while', () => {
    const c = ctx('linux', '/home/u', {});
    let runs = 0;
    const run = () => (runs++, null);
    cachedShellLookup(c, run, () => 0);
    cachedShellLookup(c, run, () => 10_000);
    expect(runs).toBe(1);
    cachedShellLookup(c, run, () => 60_000);
    expect(runs).toBe(2);
  });
});

describe('spawning on win32 never goes through a shell', () => {
  const PROMPT = 'hello & calc.exe | echo "%PATH%" ^ && del *.*\r\nnext line';
  const ARGS = ['-p', PROMPT, '--output-format', 'stream-json'];
  const shimDir = `${WIN_ENV.APPDATA}\\npm`;
  const shim = `${shimDir}\\claude.cmd`;
  const nativeShim = [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
    '',
  ].join('\r\n');
  const nodeShim = [
    '@ECHO off',
    'SETLOCAL',
    'CALL :find_dp0',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  ].join('\r\n');
  const nativeTarget = `${shimDir}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
  const scriptTarget = `${shimDir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;

  it('replaces an npm shim with the claude.exe it launches and passes the prompt as one argument', () => {
    const launch = planLaunch(ctx('win32', WIN_HOME, WIN_ENV, [shim, nativeTarget]), shim, ARGS, () => nativeShim);
    expect(launch).toEqual({ command: nativeTarget, args: ARGS });
    if ('error' in launch) throw new Error('unreachable');
    expect(launch.args[1]).toBe(PROMPT);
  });

  it('runs a node-script shim with node.exe from beside the shim, then from PATH', () => {
    const beside = `${shimDir}\\node.exe`;
    expect(planLaunch(ctx('win32', WIN_HOME, WIN_ENV, [shim, scriptTarget, beside]), shim, ARGS, () => nodeShim)).toEqual({ command: beside, args: [scriptTarget, ...ARGS] });
    const onPath = 'C:\\Tools\\node.exe';
    expect(planLaunch(ctx('win32', WIN_HOME, WIN_ENV, [shim, scriptTarget, onPath]), shim, ARGS, () => nodeShim)).toEqual({ command: onPath, args: [scriptTarget, ...ARGS] });
  });

  it('fails with a message, and never falls back to cmd.exe, when a shim cannot be resolved', () => {
    const cases: Array<[string[], string | null]> = [
      [[shim], null],
      [[shim], '@ECHO off\r\nrem nothing useful'],
      [[shim], nativeShim],
      [[shim, scriptTarget], nodeShim],
    ];
    for (const [present, text] of cases) {
      const launch = planLaunch(ctx('win32', WIN_HOME, WIN_ENV, present), shim, ARGS, () => text);
      expect('error' in launch).toBe(true);
      expect(JSON.stringify(launch)).not.toMatch(/cmd\.exe|\/c|COMSPEC/i);
      if ('error' in launch) expect(launch.error).toContain('LANTERN_CLAUDE_BIN');
    }
  });

  it('never invents a command line: the program is a file and the prompt stays an argv element', () => {
    for (const text of [nativeShim, nodeShim]) {
      const launch = planLaunch(ctx('win32', WIN_HOME, WIN_ENV, [shim, nativeTarget, scriptTarget, `${shimDir}\\node.exe`]), shim, ARGS, () => text);
      if ('error' in launch) throw new Error(launch.error);
      expect(launch.command).toMatch(/\.exe$/);
      expect(launch.command).not.toContain(PROMPT);
      expect(launch.args).toContain(PROMPT);
      expect(launch.args.filter((a) => a.includes('&')).length).toBe(1);
    }
  });

  it('spawns a native exe and every POSIX binary as is', () => {
    const exe = `${WIN_HOME}\\.local\\bin\\claude.exe`;
    expect(planLaunch(ctx('win32', WIN_HOME, WIN_ENV), exe, ARGS, () => null)).toEqual({ command: exe, args: ARGS });
    expect(planLaunch(ctx('linux', '/h', {}), '/h/.local/bin/claude', ARGS, () => null)).toEqual({ command: '/h/.local/bin/claude', args: ARGS });
  });

  it('parses the shim forms npm and cmd-shim write', () => {
    expect(parseShimTarget(nativeShim, shimDir)).toBe(nativeTarget);
    expect(parseShimTarget(nodeShim, shimDir)).toBe(scriptTarget);
    expect(parseShimTarget('"%~dp0\\..\\tool\\claude.exe" %*', 'C:\\a\\b')).toBe('C:\\a\\tool\\claude.exe');
    expect(parseShimTarget('"%dp0%\\%EVIL%\\x.exe" %*', shimDir)).toBeNull();
  });

  it('keeps shell: true and cmd.exe out of agent.ts and claude-bin.ts', () => {
    for (const file of ['agent.ts', 'claude-bin.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', file), 'utf8');
      expect(source).not.toMatch(/shell:\s*true/);
      expect(source).not.toMatch(/['"]cmd(\.exe)?['"]/i);
    }
  });
});

describe('resolveBin on this machine', () => {
  const saved = process.env.LANTERN_CLAUDE_BIN;
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-bin-'));
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.LANTERN_CLAUDE_BIN;
    else process.env.LANTERN_CLAUDE_BIN = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the LANTERN_CLAUDE_BIN override ahead of any installed claude', () => {
    const fake = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    fs.writeFileSync(fake, '');
    process.env.LANTERN_CLAUDE_BIN = fake;
    expect(resolveBin()).toBe(fake);
    expect(binCandidates()[0]).toBe(fake);
  });
});
