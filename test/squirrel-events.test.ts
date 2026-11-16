import { describe, expect, it } from 'vitest';
import { handleSquirrelEvent, squirrelEventOf } from '../src/main/squirrel-events';
import type { SquirrelPorts } from '../src/main/squirrel-events';
import type { CliStatus } from '../src/main/cli';

const EXEC = 'C:\\Users\\ann\\AppData\\Local\\Lantern\\app-1.2.0\\Lantern.exe';
const UPDATE = 'C:\\Users\\ann\\AppData\\Local\\Lantern\\Update.exe';

const status = (state: CliStatus['state'], target: string | null): CliStatus => ({ state, link: 'C:\\bin\\lantern.cmd', script: 'S', target, platform: 'win32', note: null });

function world(args: { argv?: string[]; platform?: NodeJS.Platform; cli?: CliStatus | null; failSpawn?: boolean; failCli?: boolean } = {}) {
  const calls: string[] = [];
  const spawned: { file: string; args: string[] }[] = [];
  const ports: SquirrelPorts = {
    platform: args.platform ?? 'win32',
    argv: args.argv ?? [EXEC, '--squirrel-install', '1.2.0'],
    execPath: EXEC,
    spawn: async (file, spawnArgs) => {
      spawned.push({ file, args: spawnArgs });
      calls.push('spawn');
      if (args.failSpawn) throw new Error('Update.exe failed');
    },
    exit: () => void calls.push('exit'),
    cli: {
      status: async () => args.cli ?? null,
      install: async () => {
        calls.push('cli-install');
        if (args.failCli) throw new Error('registry');
        return null;
      },
      uninstall: async () => {
        calls.push('cli-uninstall');
        return null;
      },
    },
  };
  return { ports, calls, spawned };
}

describe('squirrelEventOf', () => {
  it('reads the event from the launch arguments', () => {
    expect(squirrelEventOf([EXEC, '--squirrel-updated', '1.2.0'])).toBe('updated');
    expect(squirrelEventOf([EXEC, '--squirrel-firstrun'])).toBe('firstrun');
    expect(squirrelEventOf([EXEC, '--squirrel-bogus'])).toBeNull();
    expect(squirrelEventOf([EXEC, '/some/project'])).toBeNull();
  });
});

describe('install and update', () => {
  it.each(['--squirrel-install', '--squirrel-updated'])('%s creates both shortcuts, refreshes an installed shim and exits', async (flag) => {
    const { ports, calls, spawned } = world({ argv: [EXEC, flag, '1.2.0'], cli: status('missing', 'C:\\old\\app-1.1.0\\lantern.cmd') });
    expect(await handleSquirrelEvent(ports)).toBe(true);
    expect(spawned).toEqual([{ file: UPDATE, args: ['--createShortcut=Lantern.exe', '--shortcut-locations=Desktop,StartMenu'] }]);
    expect(calls).toEqual(['spawn', 'cli-install', 'exit']);
  });

  it('does not install the command when it was never installed', async () => {
    const { ports, calls } = world({ cli: status('missing', null) });
    await handleSquirrelEvent(ports);
    expect(calls).toEqual(['spawn', 'exit']);
  });

  it('leaves a command it does not own alone', async () => {
    const { ports, calls } = world({ cli: status('other', null) });
    await handleSquirrelEvent(ports);
    expect(calls).toEqual(['spawn', 'exit']);
  });

  it('still exits when the shortcuts or the shim fail', async () => {
    const shortcuts = world({ failSpawn: true, cli: status('installed', 'S') });
    await handleSquirrelEvent(shortcuts.ports);
    expect(shortcuts.calls).toEqual(['spawn', 'cli-install', 'exit']);

    const shim = world({ failCli: true, cli: status('installed', 'S') });
    await handleSquirrelEvent(shim.ports);
    expect(shim.calls).toEqual(['spawn', 'cli-install', 'exit']);
  });
});

describe('uninstall', () => {
  it('removes the shortcuts, then the shim and its PATH entry, then exits', async () => {
    const { ports, calls, spawned } = world({ argv: [EXEC, '--squirrel-uninstall', '1.2.0'] });
    expect(await handleSquirrelEvent(ports)).toBe(true);
    expect(spawned).toEqual([{ file: UPDATE, args: ['--removeShortcut=Lantern.exe', '--shortcut-locations=Desktop,StartMenu'] }]);
    expect(calls).toEqual(['spawn', 'cli-uninstall', 'exit']);
  });

  it('still removes the shim and exits when the shortcuts cannot be removed', async () => {
    const { ports, calls } = world({ argv: [EXEC, '--squirrel-uninstall'], failSpawn: true });
    await handleSquirrelEvent(ports);
    expect(calls).toEqual(['spawn', 'cli-uninstall', 'exit']);
  });
});

describe('obsolete and first run', () => {
  it('exits on obsolete without doing anything else', async () => {
    const { ports, calls } = world({ argv: [EXEC, '--squirrel-obsolete', '1.1.0'] });
    expect(await handleSquirrelEvent(ports)).toBe(true);
    expect(calls).toEqual(['exit']);
  });

  it('lets the first run carry on to a normal start', async () => {
    const { ports, calls } = world({ argv: [EXEC, '--squirrel-firstrun'] });
    expect(await handleSquirrelEvent(ports)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('everything else', () => {
  it('does nothing off Windows', async () => {
    const { ports, calls } = world({ platform: 'darwin' });
    expect(await handleSquirrelEvent(ports)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does nothing without a squirrel argument', async () => {
    const { ports, calls } = world({ argv: [EXEC, 'C:\\work\\project'] });
    expect(await handleSquirrelEvent(ports)).toBe(false);
    expect(calls).toEqual([]);
  });
});
