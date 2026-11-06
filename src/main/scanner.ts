import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { resolveBin } from './agent';
import { planLaunch } from './claude-bin';
import { readSessionFiles } from './session-files';

const POLL_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

// `shell`: the turn ended but a background shell (dev server, watcher) is still alive.
type SessionState = 'running' | 'shell' | 'permission' | 'idle' | 'done' | 'failed' | 'stopped' | 'unknown';

const BACKGROUND_STATES = new Map<string, SessionState>([['working', 'running'], ['done', 'done'], ['failed', 'failed'], ['stopped', 'stopped']]);
const PROCESS_STATUSES = new Map<string, SessionState>([['busy', 'running'], ['shell', 'shell'], ['idle', 'done']]);

const SCRATCH_CWD_PREFIXES = ['areas-reader-'];

function isScratchCwd(cwd: string) {
  const name = cwd.split(/[\\/]+/).filter(Boolean).pop() ?? '';
  return SCRATCH_CWD_PREFIXES.some((prefix) => name.startsWith(prefix));
}

interface SessionSnapshot {
  id: string;
  provider: 'claude';
  sessionId: string;
  cwd: string;
  kind: 'interactive' | 'background';
  state: SessionState;
  startedAt: number;
  waitingFor: string;
  changedAt: number;
}

function waitingState(waitingFor: unknown): 'permission' | 'idle' {
  const reason = typeof waitingFor === 'string' ? waitingFor.trim().toLowerCase() : '';
  return reason === 'permission prompt' || reason === 'sandbox request' ? 'permission' : 'idle';
}

function rowState(row: Record<string, unknown>): SessionState {
  const value = row.kind === 'background' ? row.state : row.status;
  if (typeof value !== 'string') return 'unknown';
  if (value === 'blocked' && row.kind === 'background') return waitingState(row.waitingFor);
  if (value === 'waiting' && row.kind === 'interactive') return waitingState(row.waitingFor);
  return (row.kind === 'background' ? BACKGROUND_STATES : PROCESS_STATUSES).get(value) ?? 'unknown';
}

function parseSession(value: unknown): SessionSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.cwd !== 'string' || !row.cwd || (row.kind !== 'interactive' && row.kind !== 'background')) return null;
  if (isScratchCwd(row.cwd)) return null;
  if (typeof row.startedAt !== 'number' || !Number.isFinite(row.startedAt)) return null;
  if (row.id !== undefined && typeof row.id !== 'string') return null;
  if (row.sessionId !== undefined && typeof row.sessionId !== 'string') return null;
  if (row.state !== undefined && typeof row.state !== 'string') return null;
  if (row.status !== undefined && typeof row.status !== 'string') return null;
  if (row.waitingFor !== undefined && typeof row.waitingFor !== 'string') return null;
  if (row.kind === 'background' && (typeof row.id !== 'string' || !row.id)) return null;

  const id = row.kind === 'background' ? (row.id as string) : `interactive:${row.cwd}:${row.startedAt}`;
  return {
    id,
    provider: 'claude',
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : '',
    cwd: row.cwd,
    kind: row.kind,
    state: rowState(row),
    startedAt: row.startedAt,
    waitingFor: typeof row.waitingFor === 'string' ? row.waitingFor : '',
    changedAt: typeof row.statusUpdatedAt === 'number' && Number.isFinite(row.statusUpdatedAt) ? row.statusUpdatedAt : 0,
  };
}

function parseRows(value: unknown): SessionSnapshot[] | null {
  if (!Array.isArray(value)) return null;
  const unique = new Map<string, SessionSnapshot>();
  for (const row of value) {
    const session = parseSession(row);
    if (session && !unique.has(session.id)) unique.set(session.id, session);
  }
  return [...unique.values()];
}

function parseSessions(text: string): SessionSnapshot[] | null {
  try {
    return parseRows(JSON.parse(text));
  } catch {
    return null;
  }
}

function readText(file: string) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

let fromFiles = false;

function scannedFromFiles() {
  return fromFiles;
}

function scan(options: { timeoutMs?: number; files?: () => unknown[] | null } = {}): Promise<SessionSnapshot[] | null> {
  const rows = (options.files ?? readSessionFiles)();
  fromFiles = rows !== null;
  if (rows) return Promise.resolve(parseRows(rows));
  const bin = resolveBin('claude');
  if (!bin) return Promise.resolve(null);
  const launch = planLaunch({ platform: process.platform, env: process.env, home: os.homedir(), exists: fs.existsSync }, bin, ['agents', '--json', '--all'], readText);
  if ('error' in launch) return Promise.resolve(null);
  const timeout = options.timeoutMs ?? POLL_TIMEOUT_MS;
  return new Promise((resolve) => {
    execFile(launch.command, launch.args, { encoding: 'utf8', timeout, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : parseSessions(stdout));
    });
  });
}

export { scan, scannedFromFiles, parseSessions, POLL_TIMEOUT_MS, MAX_OUTPUT_BYTES };
export type { SessionSnapshot, SessionState };
