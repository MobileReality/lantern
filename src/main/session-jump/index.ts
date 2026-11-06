import path from 'node:path';
import { parsePsTable, type ProcRow } from '../proctree';
import { readSessionFiles } from '../session-files';
import { out, pidsOnTty } from './shell';
import { clientTty, showPane, tmuxTarget, type TmuxTarget } from './integrations/tmux';
import * as appleTerminal from './integrations/apple-terminal';
import * as ghostty from './integrations/ghostty';
import * as iterm2 from './integrations/iterm2';
import * as kitty from './integrations/kitty';

const OUTERMOST_APP = /^(\/.+?\.app)\//;
const MAX_ANCESTORS = 32;
// iTerm2 runs its shells under a daemonized server outside the bundle, so the walk never reaches iTerm.app.
const ITERM_SERVER = /\/iTermServer-[^/]*$/;
// ponytail: assumes the default install location, resolve by bundle id if iTerm lives elsewhere.
const ITERM_APP = '/Applications/iTerm.app';
// Lantern's embedded editor: its terminals live in a browser view, so there is no app to focus.
const SERVE_WEB = /\/cli\/serve-web\/[0-9a-f]{40}\//;

const TERMINALS: Record<string, (tty: string, app: string) => Promise<boolean>> = {
  'Ghostty.app': ghostty.focus,
  'iTerm.app': iterm2.focus,
  'Terminal.app': appleTerminal.focus,
  'kitty.app': kitty.focus,
};

function sessionPid(sessionId: string): number | null {
  const row = (readSessionFiles() ?? []).find(
    (r): r is { pid: number } => !!r && typeof r === 'object' && (r as any).kind === 'interactive' && (r as any).sessionId === sessionId,
  );
  return row && Number.isInteger(row.pid) && row.pid > 1 ? row.pid : null;
}

// The outermost bundle, so a terminal inside VS Code resolves to VS Code, not its Code Helper.
function appForTty(rows: ProcRow[], ttyPids: number[]): string | null {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  for (const start of ttyPids) {
    for (let row = byPid.get(start), hops = 0; row && hops < MAX_ANCESTORS; row = byPid.get(row.ppid), hops++) {
      if (SERVE_WEB.test(row.command)) break;
      const app = ITERM_SERVER.test(row.command) ? ITERM_APP : row.command.match(OUTERMOST_APP)?.[1];
      if (app) return app;
      if (row.ppid <= 1) break;
    }
  }
  return null;
}

interface Terminal {
  tty: string;
  app: string;
  tmux: TmuxTarget | null;
}

// Read-only, so a card can ask before it offers the jump.
async function findTerminal(sessionId: string): Promise<Terminal | null> {
  const pid = sessionPid(sessionId);
  if (!pid) return null;
  const [psLine, ownTty] = await Promise.all([out('ps', ['eww', '-o', 'command=', '-p', String(pid)]), out('ps', ['-o', 'tty=', '-p', String(pid)])]);
  const tmux = psLine ? tmuxTarget(psLine) : null;
  const own = ownTty && ownTty !== '??' ? `/dev/${ownTty}` : null;
  const tty = tmux ? await clientTty(tmux) : own;
  if (!tty) return null;
  const [table, onTty] = await Promise.all([out('ps', ['-axo', 'pid=,ppid=,stat=,comm=']), pidsOnTty(tty)]);
  const app = appForTty(parsePsTable(table ?? ''), onTty);
  return app ? { tty, app, tmux } : null;
}

async function canJumpToSession(sessionId: string) {
  return (await findTerminal(sessionId)) !== null;
}

async function jumpToSession(sessionId: string): Promise<boolean> {
  const terminal = await findTerminal(sessionId);
  if (!terminal) return false;
  if (terminal.tmux) await showPane(terminal.tmux, terminal.tty);
  const exact = TERMINALS[path.basename(terminal.app)];
  if (exact && (await exact(terminal.tty, terminal.app))) return true;
  return (await out('open', ['-a', terminal.app])) !== null;
}

export { appForTty, canJumpToSession, jumpToSession };
