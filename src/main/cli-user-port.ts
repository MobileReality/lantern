import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CliPort } from './cli-user-install';

const execFileAsync = promisify(execFile);
const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command'];
const HIDDEN = { windowsHide: true } as const;
const UTF8_OUTPUT = "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8;";
// DoNotExpandEnvironmentNames keeps %VAR% entries as the user wrote them; ExpandString keeps the value expandable.
const READ_SCRIPT = `${UTF8_OUTPUT} $v = (Get-Item 'HKCU:\\Environment').GetValue('Path', $null, 'DoNotExpandEnvironmentNames'); if ($v) { [Console]::Out.Write($v) }`;
const WRITE_SCRIPT = "$ErrorActionPreference = 'Stop'; Set-ItemProperty -Path 'HKCU:\\Environment' -Name Path -Value $env:LANTERN_NEW_PATH -Type ExpandString";
// Setting a variable that does not exist to null changes nothing but broadcasts WM_SETTINGCHANGE, which
// makes Explorer hand the new Path to terminals opened afterwards.
const BROADCAST_SCRIPT = "[Environment]::SetEnvironmentVariable('LANTERN_PATH_REFRESH', $null, 'User')";

async function readUserPath() {
  const { stdout } = await execFileAsync('powershell', [...POWERSHELL_ARGS, READ_SCRIPT], { encoding: 'utf8', ...HIDDEN });
  return stdout === '' ? null : stdout;
}

async function writeUserPath(value: string) {
  await execFileAsync('powershell', [...POWERSHELL_ARGS, WRITE_SCRIPT], { env: { ...process.env, LANTERN_NEW_PATH: value }, ...HIDDEN });
  await execFileAsync('powershell', [...POWERSHELL_ARGS, BROADCAST_SCRIPT], HIDDEN).catch(() => undefined);
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
