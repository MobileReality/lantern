import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shellQuote } from '../shared/shell-quote';
import { parseCompareSpec } from '../shared/local-review';

type CliState = 'installed' | 'missing' | 'other';

interface CliStatus {
  state: CliState;
  link: string;
  script: string;
  target: string | null;
  platform?: NodeJS.Platform;
  note?: string | null;
}

const PROJECT_FLAG = '--project=';
const COMPARE_FLAG = '--compare=';
const BIN_LINK = '/usr/local/bin/lantern';
const USER_CANCELLED = '(-128)';
const execFileAsync = promisify(execFile);

function existingDirectory(dir: string) {
  try {
    const real = fs.realpathSync.native(dir);
    return fs.statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

function projectArg(argv: readonly string[], cwd: string) {
  const dir = argv.find((arg) => arg.startsWith(PROJECT_FLAG))?.slice(PROJECT_FLAG.length);
  return dir ? existingDirectory(path.resolve(cwd, dir)) : null;
}

function compareArg(argv: readonly string[]) {
  return parseCompareSpec(argv.find((arg) => arg.startsWith(COMPARE_FLAG))?.slice(COMPARE_FLAG.length));
}

function scriptPath(packaged: boolean, resourcesPath: string, mainDirectory: string, platform: NodeJS.Platform = 'darwin') {
  return path.join(packaged ? resourcesPath : mainDirectory, 'cli', platform === 'win32' ? 'lantern.cmd' : 'lantern');
}

function linkTarget(link: string) {
  try {
    return path.resolve(path.dirname(link), fs.readlinkSync(link));
  } catch {
    return null;
  }
}

function exists(link: string) {
  try {
    fs.lstatSync(link);
    return true;
  } catch {
    return false;
  }
}

function status(script: string, link = BIN_LINK): CliStatus {
  const target = linkTarget(link);
  const state = target === script ? (fs.existsSync(script) ? 'installed' : 'missing') : exists(link) ? 'other' : 'missing';
  return { state, link, script, target };
}

const appleScriptString = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`;

async function runAsAdmin(command: string, cancelled: string) {
  try {
    await execFileAsync('osascript', ['-e', `do shell script ${appleScriptString(command)} with administrator privileges`]);
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? '').trim();
    throw new Error(stderr.includes(USER_CANCELLED) ? cancelled : stderr || (err as Error).message);
  }
}

const linkAsAdmin = (link: string, script: string) =>
  runAsAdmin(`mkdir -p ${shellQuote(path.dirname(link))} && ln -sf ${shellQuote(script)} ${shellQuote(link)}`, 'Installation cancelled');

const unlinkAsAdmin = (link: string) => runAsAdmin(`rm -f ${shellQuote(link)}`, 'Uninstall cancelled');

async function install(script: string, link = BIN_LINK) {
  const current = status(script, link);
  if (current.state === 'other') return current;
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.rmSync(link, { force: true });
    fs.symlinkSync(script, link);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EACCES' && code !== 'EPERM') throw err;
    await linkAsAdmin(link, script);
  }
  return status(script, link);
}

async function uninstall(script: string, link = BIN_LINK) {
  if (linkTarget(link) !== script) return status(script, link);
  try {
    fs.rmSync(link, { force: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EACCES' && code !== 'EPERM') throw err;
    await unlinkAsAdmin(link);
  }
  return status(script, link);
}

export type { CliStatus };
export { compareArg, projectArg, scriptPath, status, install, uninstall };
