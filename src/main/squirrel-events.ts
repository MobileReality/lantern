import path from 'node:path';
import type { CliStatus } from './cli';

const EVENTS = ['install', 'updated', 'uninstall', 'obsolete', 'firstrun'] as const;
type SquirrelEvent = (typeof EVENTS)[number];

interface SquirrelPorts {
  platform: NodeJS.Platform;
  argv: readonly string[];
  execPath: string;
  spawn(file: string, args: string[]): Promise<void>;
  exit(): void;
  cli: {
    status(): Promise<CliStatus | null>;
    install(): Promise<unknown>;
    uninstall(): Promise<unknown>;
  };
}

const FLAG_PREFIX = '--squirrel-';
const SHORTCUT_LOCATIONS = '--shortcut-locations=Desktop,StartMenu';

function squirrelEventOf(argv: readonly string[]): SquirrelEvent | null {
  const flag = argv.slice(1).find((arg) => arg.startsWith(FLAG_PREFIX));
  const name = flag?.slice(FLAG_PREFIX.length);
  return EVENTS.find((event) => event === name) ?? null;
}

const updateExe = (execPath: string) => path.win32.resolve(path.win32.dirname(execPath), '..', 'Update.exe');

const shortcutArgs = (flag: string, execPath: string) => [`${flag}=${path.win32.basename(execPath)}`, SHORTCUT_LOCATIONS];

// A shim of ours that points at an older version's script reads as 'missing' with a target.
const commandWasInstalled = (status: CliStatus | null) => status !== null && status.state !== 'other' && status.target !== null;

async function attempt(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    console.error('Squirrel event step failed:', error);
  }
}

async function refreshCommand(ports: SquirrelPorts) {
  if (commandWasInstalled(await ports.cli.status())) await ports.cli.install();
}

async function install(ports: SquirrelPorts) {
  await attempt(() => ports.spawn(updateExe(ports.execPath), shortcutArgs('--createShortcut', ports.execPath)));
  await attempt(() => refreshCommand(ports));
}

async function uninstall(ports: SquirrelPorts) {
  await attempt(() => ports.spawn(updateExe(ports.execPath), shortcutArgs('--removeShortcut', ports.execPath)));
  await attempt(() => ports.cli.uninstall());
}

// Squirrel expects the first run to start the app, so it is the one event that does not exit.
function squirrelLaunchEvent(platform: NodeJS.Platform, argv: readonly string[]) {
  const event = platform === 'win32' ? squirrelEventOf(argv) : null;
  return event === 'firstrun' ? null : event;
}

async function handleSquirrelEvent(ports: SquirrelPorts): Promise<boolean> {
  const event = squirrelLaunchEvent(ports.platform, ports.argv);
  if (event === null) return false;
  if (event === 'install' || event === 'updated') await install(ports);
  if (event === 'uninstall') await uninstall(ports);
  ports.exit();
  return true;
}

export type { SquirrelEvent, SquirrelPorts };
export { handleSquirrelEvent, squirrelEventOf, squirrelLaunchEvent };
