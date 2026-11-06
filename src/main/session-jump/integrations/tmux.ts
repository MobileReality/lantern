import fs from 'node:fs';
import { out } from '../shell';

// Fixed locations only: the session's own PATH can lead into a project's node_modules/.bin.
const TMUX_BINARIES = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];

interface TmuxTarget {
  socket: string;
  pane: string;
  bin: string;
}

// `ps eww` appends the environment to the command line; tmux values never contain spaces.
function tmuxTarget(psLine: string, exists: (file: string) => boolean = fs.existsSync): TmuxTarget | null {
  const env = (name: string) => psLine.match(new RegExp(`(?:^|\\s)${name}=(\\S*)`))?.[1] ?? '';
  const socket = env('TMUX').split(',')[0];
  const pane = env('TMUX_PANE');
  if (!socket || !/^%\d+$/.test(pane)) return null;
  const bin = TMUX_BINARIES.find(exists);
  return bin ? { socket, pane, bin } : null;
}

function tmuxIn(t: TmuxTarget) {
  return (...args: string[]) => out(t.bin, ['-S', t.socket, ...args]);
}

async function clientTty(t: TmuxTarget): Promise<string | null> {
  const tmux = tmuxIn(t);
  const session = await tmux('display-message', '-p', '-t', t.pane, '#{session_id}');
  if (!session) return null;
  const clients = (await tmux('list-clients', '-F', '#{client_tty}\t#{session_id}\t#{client_activity}')) ?? '';
  const rows = clients.split('\n').map((line) => line.split('\t')).filter((p) => p.length === 3);
  const showing = rows.find((p) => p[1] === session);
  return showing ? showing[0] : (rows.sort((a, b) => Number(b[2]) - Number(a[2]))[0]?.[0] ?? null);
}

// A client on another session is moved onto the pane, as a jump from Boopr did. Best effort:
// the terminal is still worth focusing when tmux refuses.
async function showPane(t: TmuxTarget, client: string) {
  const tmux = tmuxIn(t);
  await tmux('select-window', '-t', t.pane);
  await tmux('select-pane', '-t', t.pane);
  await tmux('switch-client', '-c', client, '-t', t.pane);
}

export { clientTty, showPane, tmuxTarget };
export type { TmuxTarget };
