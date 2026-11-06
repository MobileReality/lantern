import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stripControlCharacters } from '../../shared/control-characters';

const run = promisify(execFile);
const COMMAND_TIMEOUT_MS = 3000;

async function out(cmd: string, args: string[]): Promise<string | null> {
  try {
    return (await run(cmd, args, { timeout: COMMAND_TIMEOUT_MS })).stdout.trim();
  } catch {
    return null;
  }
}

function osascript(script: string) {
  return out('osascript', ['-e', script]);
}

function appleScriptString(text: string) {
  return `"${text.replace(/[\\"]/g, '\\$&')}"`;
}

async function pidsOnTty(tty: string): Promise<number[]> {
  const list = await out('ps', ['-t', tty.replace(/^\/dev\//, ''), '-o', 'pid=']);
  return (list ?? '').split(/\s+/).map(Number).filter(Boolean);
}

// OSC 2 goes straight to the terminal that owns the tty, past tmux.
function writeTitle(tty: string, title: string) {
  try {
    fs.writeFileSync(tty, `\x1b]2;${stripControlCharacters(title)}\x07`);
    return true;
  } catch {
    return false;
  }
}

export { appleScriptString, osascript, out, pidsOnTty, writeTitle };
