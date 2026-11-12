import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CliPort } from './cli-user-install';

const execFileAsync = promisify(execFile);
const USER_PATH_VALUE = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im;
// Setting a variable that does not exist to null changes nothing but broadcasts WM_SETTINGCHANGE, which
// makes Explorer hand the new Path to terminals opened afterwards.
const BROADCAST_SCRIPT = "[Environment]::SetEnvironmentVariable('LANTERN_PATH_REFRESH', $null, 'User')";

async function readUserPath() {
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Environment', '/v', 'Path']);
    return USER_PATH_VALUE.exec(stdout)?.[1].trimEnd() ?? null;
  } catch {
    return null;
  }
}

async function writeUserPath(value: string) {
  await execFileAsync('reg', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f']);
  await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', BROADCAST_SCRIPT]).catch(() => undefined);
}

function readOrNull<T>(read: () => T) {
  try {
    return read();
  } catch {
    return null;
  }
}

const cliPort: CliPort = {
  exists: (file) => readOrNull(() => fs.lstatSync(file)) !== null,
  readlink: (file) => readOrNull(() => fs.readlinkSync(file)),
  readText: (file) => readOrNull(() => fs.readFileSync(file, 'utf8')),
  mkdirp: (dir) => void fs.mkdirSync(dir, { recursive: true }),
  writeText: (file, text) => fs.writeFileSync(file, text),
  symlink: (target, link) => fs.symlinkSync(target, link),
  remove: (file) => fs.rmSync(file, { force: true }),
  readUserPath,
  writeUserPath,
};

export { cliPort };
