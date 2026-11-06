import { execFile, type ChildProcess } from 'node:child_process';
import { descendantsOf, parsePsTable, type ProcRow } from './proctree';

const PS_ARGS = ['-A', '-o', 'pid=,ppid=,stat=,command='];
const PS_MAX_BUFFER = 32 * 1024 * 1024;
const POLL_MS = 100;
const FORCE_WAIT_MS = 2000;
const IS_WINDOWS = process.platform === 'win32';
const INIT_PID = 1;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function psSnapshot(): Promise<ProcRow[]> {
  if (IS_WINDOWS) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('ps', PS_ARGS, { maxBuffer: PS_MAX_BUFFER }, (err, out) => resolve(err ? [] : parsePsTable(out)));
  });
}

// Windows has no lsof; returning null there keeps the old reuse-whatever-answers path.
export function portListener(port: number): Promise<number | null> {
  if (IS_WINDOWS) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], (err, out) => {
      const pid = Number(String(out || '').split('\n')[0]);
      resolve(!err && pid > 0 ? pid : null);
    });
  });
}

export async function waitPortFree(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while ((await portListener(port)) !== null) {
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
  return true;
}

// A zombie still shows in ps until its parent reaps it, but it's already dead.
const isLive = (r: ProcRow) => !r.stat.startsWith('Z');

export type Signaller = (pid: number, signal: NodeJS.Signals) => void;

export interface KillDeps {
  signal: Signaller;
  snapshot: () => Promise<ProcRow[]>;
}

const REAL_KILL: KillDeps = { signal: (pid, signal) => process.kill(pid, signal), snapshot: psSnapshot };

// kill(0), kill(1) and kill(-1) reach a whole process group or every process the user owns.
export const isSignalablePid = (pid: number) => Number.isSafeInteger(pid) && pid > INIT_PID;

async function survivors(pids: number[], snapshot: KillDeps['snapshot']) {
  const rows = await snapshot();
  const wanted = new Set(pids);
  const live = rows.filter((r) => wanted.has(r.pid) && isLive(r)).map((r) => r.pid);
  return { rows, live };
}

async function waitGone(pids: number[], timeoutMs: number, snapshot: KillDeps['snapshot']) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await survivors(pids, snapshot);
    if (!s.live.length || Date.now() >= deadline) return s;
    await sleep(POLL_MS);
  }
}

function signalAll(pids: number[], signal: NodeJS.Signals, send: Signaller) {
  for (const pid of pids) {
    if (!isSignalablePid(pid)) continue;
    try {
      send(pid, signal);
    } catch {}
  }
}

function taskkillTree(pid: number) {
  return new Promise<void>((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

// The tree is snapshotted before signalling: once the root dies its children are
// reparented to launchd and can no longer be found by walking down from it.
export async function killTree(rootPid: number, graceMs: number, deps: KillDeps = REAL_KILL) {
  if (!isSignalablePid(rootPid)) return;
  if (IS_WINDOWS) return taskkillTree(rootPid);
  const tree = [rootPid, ...descendantsOf(await deps.snapshot(), rootPid)];
  signalAll(tree, 'SIGTERM', deps.signal);
  const { rows, live } = await waitGone(tree, graceMs, deps.snapshot);
  if (!live.length) return;
  const stubborn = [...new Set(live.flatMap((pid) => [pid, ...descendantsOf(rows, pid)]))];
  signalAll(stubborn, 'SIGKILL', deps.signal);
  await waitGone(stubborn, FORCE_WAIT_MS, deps.snapshot);
}

// Signals exactly the pids it is given (no tree walk of its own), so the caller decides the scope.
export async function terminatePids(pids: number[], graceMs: number, deps: KillDeps = REAL_KILL) {
  const targets = [...new Set(pids)].filter(isSignalablePid);
  if (!targets.length) return targets;
  signalAll(targets, 'SIGTERM', deps.signal);
  const { live } = await waitGone(targets, graceMs, deps.snapshot);
  if (live.length) {
    signalAll(live, 'SIGKILL', deps.signal);
    await waitGone(live, FORCE_WAIT_MS, deps.snapshot);
  }
  return targets;
}

export function killChildTree(child: ChildProcess, graceMs: number) {
  if (child.pid) return killTree(child.pid, graceMs);
  try {
    child.kill();
  } catch {}
  return Promise.resolve();
}
