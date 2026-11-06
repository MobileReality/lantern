// Platform, env, home and file probes are parameters so win32, darwin and linux are all testable from one machine.

import { execFileSync } from 'node:child_process';
import path from 'node:path';

interface BinContext {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  exists: (file: string) => boolean;
}

type ShellRun = (file: string, args: string[]) => string | null;

interface Launch {
  command: string;
  args: string[];
}

const ENV_OVERRIDE = 'LANTERN_CLAUDE_BIN';
const WIN_RUNNABLE = ['.exe', '.com', '.cmd', '.bat'];
const WIN_NATIVE = ['.exe', '.com'];
const WIN_SHIM = ['.cmd', '.bat'];
const SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const DEFAULT_PATHEXT = ['.com', '.exe', '.bat', '.cmd'];
const LOOKUP_TIMEOUT_MS = 3000;
const LOOKUP_MISS_TTL_MS = 30000;

function pathFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function envValue(ctx: BinContext, name: string) {
  if (ctx.platform !== 'win32') return ctx.env[name] || '';
  const key = Object.keys(ctx.env).find((k) => k.toLowerCase() === name.toLowerCase());
  return (key && ctx.env[key]) || '';
}

function unquote(raw: string) {
  return raw.trim().replace(/^"(.*)"$/, '$1').trim();
}

function extensionOf(ctx: BinContext, file: string) {
  return pathFor(ctx.platform).extname(file).toLowerCase();
}

function overrideCandidates(ctx: BinContext, configured: string) {
  return [envValue(ctx, ENV_OVERRIDE), configured].map(unquote).filter(Boolean);
}

function knownLocations(ctx: BinContext): string[] {
  const p = pathFor(ctx.platform);
  if (ctx.platform === 'win32') {
    const appdata = envValue(ctx, 'APPDATA');
    const local = envValue(ctx, 'LOCALAPPDATA');
    const profile = envValue(ctx, 'USERPROFILE') || ctx.home;
    return [
      appdata && p.join(appdata, 'npm', 'claude.cmd'),
      local && p.join(local, 'Programs', 'claude', 'claude.exe'),
      profile && p.join(profile, '.local', 'bin', 'claude.exe'),
      appdata && p.join(appdata, 'npm', 'claude.exe'),
    ].filter(Boolean) as string[];
  }
  const home = ctx.home;
  return [
    p.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    p.join(home, '.npm-global', 'bin', 'claude'),
    p.join(home, '.claude', 'local', 'claude'),
    p.join(home, '.volta', 'bin', 'claude'),
    p.join(home, '.bun', 'bin', 'claude'),
    p.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'claude'),
    p.join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin', 'claude'),
    '/usr/bin/claude',
    '/snap/bin/claude',
  ];
}

function pathExtensions(ctx: BinContext) {
  const listed = envValue(ctx, 'PATHEXT')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => WIN_RUNNABLE.includes(e));
  return listed.length ? listed : DEFAULT_PATHEXT;
}

function pathDirs(ctx: BinContext) {
  const p = pathFor(ctx.platform);
  const delimiter = ctx.platform === 'win32' ? ';' : ':';
  return envValue(ctx, 'PATH')
    .split(delimiter)
    .map(unquote)
    .filter((dir) => dir && p.isAbsolute(dir));
}

function executableNames(ctx: BinContext, name: string) {
  return ctx.platform === 'win32' ? pathExtensions(ctx).map((ext) => `${name}${ext}`) : [name];
}

function pathScanCandidates(ctx: BinContext, name = 'claude') {
  const p = pathFor(ctx.platform);
  const names = executableNames(ctx, name);
  return pathDirs(ctx).flatMap((dir) => names.map((n) => p.join(dir, n)));
}

function unique(list: string[]) {
  return [...new Set(list)];
}

function binCandidatesFor(ctx: BinContext, configured = ''): string[] {
  return unique([...overrideCandidates(ctx, configured), ...knownLocations(ctx), ...pathScanCandidates(ctx)]);
}

function safeExists(ctx: BinContext, file: string) {
  try {
    return ctx.exists(file);
  } catch {
    return false;
  }
}

function lookupRunnable(ctx: BinContext, file: string) {
  if (!pathFor(ctx.platform).isAbsolute(file)) return false;
  if (ctx.platform === 'win32' && !WIN_RUNNABLE.includes(extensionOf(ctx, file))) return false;
  return safeExists(ctx, file);
}

function lookupLines(out: string | null) {
  return (out ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function shellLookup(ctx: BinContext, run: ShellRun): string | null {
  if (ctx.platform === 'win32') {
    return lookupLines(run('where', ['claude'])).find((l) => lookupRunnable(ctx, l)) ?? null;
  }
  const shell = envValue(ctx, 'SHELL') || (ctx.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return lookupLines(run(shell, ['-ilc', 'command -v claude']))
    .reverse()
    .find((l) => lookupRunnable(ctx, l)) ?? null;
}

function runWithTimeout(file: string, args: string[]): string | null {
  try {
    return execFileSync(file, args, { encoding: 'utf8', timeout: LOOKUP_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch {
    return null;
  }
}

let lookupCache: { value: string | null; at: number } | null = null;

function resetShellLookupCache() {
  lookupCache = null;
}

function cachedShellLookup(ctx: BinContext, run: ShellRun = runWithTimeout, now: () => number = Date.now): string | null {
  if (lookupCache) {
    if (lookupCache.value !== null && safeExists(ctx, lookupCache.value)) return lookupCache.value;
    if (lookupCache.value === null && now() - lookupCache.at < LOOKUP_MISS_TTL_MS) return null;
  }
  const value = shellLookup(ctx, run);
  lookupCache = { value, at: now() };
  return value;
}

function resolveBinFor(ctx: BinContext, configured = '', run: ShellRun = runWithTimeout, now: () => number = Date.now): string | null {
  const direct = binCandidatesFor(ctx, configured).find((c) => safeExists(ctx, c));
  return direct ?? cachedShellLookup(ctx, run, now);
}

function describeNotFound(ctx: BinContext, configured = ''): string {
  const set = overrideCandidates(ctx, configured);
  const where = ctx.platform === 'win32' ? 'where claude' : 'which claude';
  const lookup = ctx.platform === 'win32' ? '"where claude"' : 'your login shell';
  const parts = [
    set.length ? `Claude CLI not found at ${set.join(' or ')} (the override), nor anywhere else.` : 'Claude CLI not found.',
    `Looked in: ${knownLocations(ctx).join(', ')}; the ${pathDirs(ctx).length} folders on PATH; and ${lookup}.`,
    `Run "${where}" in a terminal where claude works, then set ${ENV_OVERRIDE} to that full path (or the claudeBin setting in ccm-settings.json) and try again.`,
  ];
  return parts.join(' ');
}

function parseShimTarget(text: string, shimDir: string): string | null {
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    const m = /"%(?:~dp0|dp0%)\\?([^"%]+)"\s+%\*/i.exec(line);
    if (m) return path.win32.resolve(shimDir, m[1]);
  }
  return null;
}

function nodeForShim(ctx: BinContext, shimDir: string): string | null {
  const beside = path.win32.join(shimDir, 'node.exe');
  if (safeExists(ctx, beside)) return beside;
  return pathScanCandidates(ctx, 'node').find((c) => WIN_NATIVE.includes(extensionOf(ctx, c)) && safeExists(ctx, c)) ?? null;
}

// A .cmd/.bat cannot be spawned directly by current Node (EINVAL) and routing it through
// cmd.exe would re-parse the -p prompt as a command line, so a shim is replaced by the
// binary or node script it launches and that is spawned without any shell.
function planLaunch(ctx: BinContext, bin: string, args: string[], readText: (file: string) => string | null): Launch | { error: string } {
  if (ctx.platform !== 'win32' || !WIN_SHIM.includes(extensionOf(ctx, bin))) return { command: bin, args };
  const shimDir = path.win32.dirname(bin);
  const text = readText(bin);
  const target = text === null ? null : parseShimTarget(text, shimDir);
  if (!target) return { error: `Found ${bin} but could not tell which program it launches. Set ${ENV_OVERRIDE} to the full path of claude.exe (run "where claude" in a terminal).` };
  if (!safeExists(ctx, target)) return { error: `${bin} launches ${target}, which does not exist. Reinstall Claude Code or set ${ENV_OVERRIDE} to the full path of claude.exe.` };
  const ext = extensionOf(ctx, target);
  if (WIN_NATIVE.includes(ext)) return { command: target, args };
  if (SCRIPT_EXTENSIONS.includes(ext)) {
    const node = nodeForShim(ctx, shimDir);
    if (node) return { command: node, args: [target, ...args] };
    return { error: `${bin} runs ${target} with node, but node.exe was not found next to it or on PATH. Install Node.js or set ${ENV_OVERRIDE} to the full path of claude.exe.` };
  }
  return { error: `${bin} launches ${target}, which Lantern cannot start without a shell. Set ${ENV_OVERRIDE} to the full path of claude.exe.` };
}

export {
  ENV_OVERRIDE,
  binCandidatesFor,
  cachedShellLookup,
  describeNotFound,
  knownLocations,
  parseShimTarget,
  pathScanCandidates,
  planLaunch,
  resetShellLookupCache,
  resolveBinFor,
  shellLookup,
};
export type { BinContext, Launch, ShellRun };
