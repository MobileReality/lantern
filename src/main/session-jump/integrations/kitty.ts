import path from 'node:path';
import { out, pidsOnTty } from '../shell';

interface KittyWindow {
  id: number;
  pid?: number;
  foreground_processes?: { pid: number }[];
}

// `kitten @ ls` reports no tty, so a window is matched by the processes it runs on that tty.
function kittyWindowFor(ls: unknown, onTty: number[]): number | null {
  if (!Array.isArray(ls)) return null;
  for (const osWindow of ls) {
    for (const tab of osWindow?.tabs ?? []) {
      for (const w of (tab?.windows ?? []) as KittyWindow[]) {
        const pids = [w.pid, ...(w.foreground_processes ?? []).map((p) => p.pid)];
        if (pids.some((pid) => pid !== undefined && onTty.includes(pid))) return w.id;
      }
    }
  }
  return null;
}

// Needs `allow_remote_control` and `listen_on` in kitty.conf; the socket is read from the
// KITTY_LISTEN_ON of a process on the tty, which survives tmux.
async function focus(tty: string, app: string): Promise<boolean> {
  const onTty = await pidsOnTty(tty);
  const env = await out('ps', ['eww', '-t', tty.replace(/^\/dev\//, ''), '-o', 'command=']);
  const socket = env?.match(/(?:^|\s)KITTY_LISTEN_ON=(\S+)/)?.[1];
  if (!socket) return false;
  const kitten = path.join(app, 'Contents', 'MacOS', 'kitten');
  const ls = await out(kitten, ['@', '--to', socket, 'ls']);
  let id: number | null = null;
  try {
    id = ls ? kittyWindowFor(JSON.parse(ls), onTty) : null;
  } catch {}
  if (id === null || (await out(kitten, ['@', '--to', socket, 'focus-window', '--match', `id:${id}`])) === null) return false;
  return (await out('open', ['-a', app])) !== null;
}

export { focus, kittyWindowFor };
