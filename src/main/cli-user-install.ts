import path from 'node:path';
import type { CliStatus } from './cli';

type UserPlatform = 'linux' | 'win32';

interface CliPort {
  exists(file: string): boolean;
  readlink(file: string): string | null;
  readText(file: string): string | null;
  mkdirp(dir: string): void;
  writeText(file: string, text: string): void;
  symlink(target: string, link: string): void;
  remove(file: string): void;
  readUserPath(): Promise<string | null>;
  writeUserPath(value: string): Promise<void>;
}

interface CliContext {
  platform: NodeJS.Platform;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  script: string;
  port: CliPort;
}

type UserContext = CliContext & { platform: UserPlatform };

const SHIM_MARKER = 'rem lantern-cli-shim';
const LINUX_PATH_HINT = '~/.local/bin is not on your PATH. Add this line to your shell profile, then open a new terminal:\nexport PATH="$HOME/.local/bin:$PATH"';

const isUserContext = (ctx: CliContext): ctx is UserContext => ctx.platform === 'linux' || ctx.platform === 'win32';

function location(ctx: UserContext) {
  if (ctx.platform === 'linux') {
    const dir = path.posix.join(ctx.home, '.local', 'bin');
    return { dir, link: path.posix.join(dir, 'lantern') };
  }
  const dir = path.win32.join(ctx.env.LOCALAPPDATA || path.win32.join(ctx.home, 'AppData', 'Local'), 'Lantern', 'bin');
  return { dir, link: path.win32.join(dir, 'lantern.cmd') };
}

function shimText(script: string) {
  return ['@echo off', SHIM_MARKER, `call "${script}" %*`, 'exit /b %errorlevel%', ''].join('\r\n');
}

const trimSeparator = (entry: string, separator: string) => (entry.length > 1 && entry.endsWith(separator) ? entry.slice(0, -1) : entry);

function onLinuxPath(ctx: CliContext, dir: string) {
  return (ctx.env.PATH ?? '').split(':').some((entry) => entry !== '' && trimSeparator(entry, '/') === dir);
}

function onWindowsPath(userPath: string | null, dir: string) {
  const wanted = trimSeparator(dir, '\\').toLowerCase();
  return (userPath ?? '').split(';').some((entry) => trimSeparator(entry.trim(), '\\').toLowerCase() === wanted);
}

function linuxState(ctx: CliContext, link: string): Pick<CliStatus, 'state' | 'target'> {
  const raw = ctx.port.readlink(link);
  const target = raw === null ? null : path.posix.resolve(path.posix.dirname(link), raw);
  if (target === ctx.script) return { state: ctx.port.exists(ctx.script) ? 'installed' : 'missing', target };
  return { state: raw !== null || ctx.port.exists(link) ? 'other' : 'missing', target };
}

function windowsState(ctx: CliContext, link: string): Pick<CliStatus, 'state' | 'target'> {
  const text = ctx.port.readText(link);
  if (text === null) return { state: ctx.port.exists(link) ? 'other' : 'missing', target: null };
  if (!text.includes(SHIM_MARKER)) return { state: 'other', target: null };
  const target = /call "([^"]+)"/.exec(text)?.[1] ?? null;
  return { state: target === ctx.script && ctx.port.exists(ctx.script) ? 'installed' : 'missing', target };
}

function describe(ctx: UserContext, userPath: string | null): CliStatus {
  const { dir, link } = location(ctx);
  const found = ctx.platform === 'linux' ? linuxState(ctx, link) : windowsState(ctx, link);
  let note: string | null = null;
  if (found.state === 'installed' && ctx.platform === 'linux' && !onLinuxPath(ctx, dir)) note = LINUX_PATH_HINT;
  if (found.state === 'installed' && ctx.platform === 'win32' && !onWindowsPath(userPath, dir)) note = `${dir} is not on your user PATH. Reinstall to add it.`;
  return { ...found, link, script: ctx.script, platform: ctx.platform, note };
}

const readPath = (ctx: UserContext) => (ctx.platform === 'win32' ? ctx.port.readUserPath() : Promise.resolve(null));

async function userCliStatus(ctx: CliContext): Promise<CliStatus | null> {
  return isUserContext(ctx) ? describe(ctx, await readPath(ctx).catch(() => null)) : null;
}

async function installUserCli(ctx: CliContext): Promise<CliStatus | null> {
  if (!isUserContext(ctx)) return null;
  const { dir, link } = location(ctx);
  const userPath = await readPath(ctx);
  const current = describe(ctx, userPath);
  if (current.state === 'other') return current;

  ctx.port.mkdirp(dir);
  if (ctx.platform === 'linux') {
    ctx.port.remove(link);
    ctx.port.symlink(ctx.script, link);
    return describe(ctx, null);
  }

  ctx.port.writeText(link, shimText(ctx.script));
  if (onWindowsPath(userPath, dir)) return describe(ctx, userPath);
  const updated = userPath ? `${userPath.replace(/;+$/, '')};${dir}` : dir;
  await ctx.port.writeUserPath(updated);
  return { ...describe(ctx, updated), note: `Added ${dir} to your user PATH. Open a new terminal to use lantern.` };
}

export type { CliContext, CliPort };
export { installUserCli, userCliStatus };
