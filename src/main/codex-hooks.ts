import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODEX_EVENTS } from './codex-event';
import { PORT } from '../shared/config';

interface CodexHookPaths {
  codexHome: string;
  configFile: string;
  scriptsDir: string;
  tokenFile: string;
  bundledDir: string;
}

interface HookStatus {
  configured: boolean;
  configFile: string;
}

function assertNoSymlinkComponents(target: string) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Unsafe path: ${current}`);
      if (current !== resolved && !stat.isDirectory()) throw new Error(`Unsafe directory: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function paths(userData: string, bundledDir: string, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): CodexHookPaths {
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  return {
    codexHome,
    configFile: path.join(codexHome, 'hooks.json'),
    scriptsDir: path.join(userData, 'codex-hooks'),
    tokenFile: path.join(userData, 'codex-hooks.token'),
    bundledDir,
  };
}

function assertDirectory(dir: string, create = true) {
  assertNoSymlinkComponents(dir);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error(`Unsafe directory: ${dir}`);
  if (!stat && create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return !!stat;
}

function assertRegularOrMissing(file: string) {
  assertNoSymlinkComponents(file);
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe file: ${file}`);
    return stat;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function writeAtomic(file: string, content: string | Buffer, mode: number) {
  assertRegularOrMissing(file);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(temp, content, { flag: 'wx', mode });
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, file);
  } finally {
    try {
      fs.rmSync(temp, { force: true });
    } catch {}
  }
}

function ensureToken(target: CodexHookPaths) {
  assertDirectory(path.dirname(target.tokenFile));
  const stat = assertRegularOrMissing(target.tokenFile);
  if (stat) {
    const existing = fs.readFileSync(target.tokenFile, 'utf8').trim();
    if (/^[a-f0-9]{48}$/.test(existing)) {
      fs.chmodSync(target.tokenFile, 0o600);
      return existing;
    }
  }
  const token = crypto.randomBytes(24).toString('hex');
  writeAtomic(target.tokenFile, `${token}\n`, 0o600);
  return token;
}

function shQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function powershellQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function commands(target: CodexHookPaths) {
  const windowsScript = `& ${powershellQuote(path.join(target.scriptsDir, 'codex.ps1'))} -Port ${PORT} -TokenFile ${powershellQuote(target.tokenFile)}`;
  const encoded = Buffer.from(windowsScript, 'utf16le').toString('base64');
  return {
    command: `bash ${shQuote(path.join(target.scriptsDir, 'codex.sh'))} ${PORT} ${shQuote(target.tokenFile)}`,
    commandWindows: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
  };
}

function validateConfig(value: unknown): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex hooks config must be a JSON object');
  const hooks = (value as Record<string, unknown>).hooks;
  if (hooks === undefined) return;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw new Error('Codex hooks must be an object');
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) throw new Error('Codex hook event must be an array');
    for (const group of groups) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error('Codex hook group must be an object');
      if (!Array.isArray((group as Record<string, unknown>).hooks)) throw new Error('Codex hook handlers must be an array');
      for (const handler of (group as { hooks: unknown[] }).hooks) {
        if (!handler || typeof handler !== 'object' || Array.isArray(handler)) throw new Error('Codex hook handler must be an object');
      }
    }
  }
}

function readConfig(target: CodexHookPaths) {
  if (!assertDirectory(target.codexHome, false)) return {} as Record<string, any>;
  const stat = assertRegularOrMissing(target.configFile);
  if (!stat) return {} as Record<string, any>;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target.configFile, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${target.configFile}: ${(error as Error).message}`);
  }
  validateConfig(parsed);
  return parsed;
}

function isOwned(handler: unknown, target: CodexHookPaths) {
  const command = commands(target).command;
  return !!handler && typeof handler === 'object' && (handler as Record<string, unknown>).type === 'command' && (handler as Record<string, unknown>).command === command;
}

function status(target: CodexHookPaths): HookStatus {
  const config = readConfig(target);
  const configured = CODEX_EVENTS.every((event) =>
    (config.hooks?.[event] || []).some((group: any) => group.hooks.some((handler: unknown) => isOwned(handler, target))),
  );
  return { configured, configFile: target.configFile };
}

function syncScripts(target: CodexHookPaths) {
  assertDirectory(path.dirname(target.scriptsDir));
  assertDirectory(target.scriptsDir);
  for (const name of ['codex.sh', 'codex.ps1']) {
    const source = path.join(target.bundledDir, name);
    const destination = path.join(target.scriptsDir, name);
    const sourceStat = fs.statSync(source);
    if (!sourceStat.isFile()) throw new Error(`Missing bundled hook script: ${name}`);
    assertRegularOrMissing(destination);
    const content = fs.readFileSync(source);
    const current = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
    if (!current || !current.equals(content)) writeAtomic(destination, content, 0o700);
  }
}

// One backup, overwritten on each change: the config as it was just before Lantern's last edit.
function backupConfig(target: CodexHookPaths, mode: number) {
  if (!fs.existsSync(target.configFile)) return null;
  const backup = `${target.configFile}.lantern-bak`;
  assertRegularOrMissing(backup);
  fs.copyFileSync(target.configFile, backup);
  fs.chmodSync(backup, mode);
  return backup;
}

function handler(event: string, target: CodexHookPaths) {
  const transport = commands(target);
  return {
    type: 'command',
    command: transport.command,
    commandWindows: transport.commandWindows,
    timeout: event === 'SessionEnd' ? 3 : 2,
    ...(!['SessionStart', 'SessionEnd'].includes(event) ? { async: true } : {}),
  };
}

function install(target: CodexHookPaths) {
  const config = readConfig(target);
  ensureToken(target);
  config.hooks ||= {};
  let changed = false;
  for (const event of CODEX_EVENTS) {
    config.hooks[event] ||= [];
    const groups = config.hooks[event];
    if (groups.some((group: any) => group.hooks.some((entry: unknown) => isOwned(entry, target)))) continue;
    groups.push({ hooks: [handler(event, target)] });
    changed = true;
  }
  syncScripts(target);
  if (!changed) return { changed: false, backup: null, ...status(target) };
  assertDirectory(target.codexHome);
  const existing = assertRegularOrMissing(target.configFile);
  const mode = existing ? existing.mode & 0o777 : 0o600;
  const backup = backupConfig(target, mode);
  writeAtomic(target.configFile, `${JSON.stringify(config, null, 2)}\n`, mode);
  return { changed: true, backup, configured: true, configFile: target.configFile };
}

function uninstall(target: CodexHookPaths) {
  const config = readConfig(target);
  if (!config.hooks) return { changed: false, backup: null, configured: false, configFile: target.configFile };
  let changed = false;
  for (const [event, groups] of Object.entries(config.hooks as Record<string, any[]>)) {
    config.hooks[event] = groups.flatMap((group) => {
      const kept = group.hooks.filter((entry: unknown) => !isOwned(entry, target));
      if (kept.length === group.hooks.length) return [group];
      changed = true;
      return kept.length ? [{ ...group, hooks: kept }] : [];
    });
    if (!config.hooks[event].length) delete config.hooks[event];
  }
  if (!changed) return { changed: false, backup: null, ...status(target) };
  const existing = assertRegularOrMissing(target.configFile)!;
  const mode = existing.mode & 0o777;
  const backup = backupConfig(target, mode);
  writeAtomic(target.configFile, `${JSON.stringify(config, null, 2)}\n`, mode);
  return { changed: true, backup, configured: false, configFile: target.configFile };
}

export { paths, ensureToken, shQuote, powershellQuote, commands, validateConfig, readConfig, isOwned, status, install, uninstall };
export type { CodexHookPaths, HookStatus };
