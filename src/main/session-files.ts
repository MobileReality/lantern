import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface SessionDirs {
  sessions: string;
  jobs: string;
}

function claudeDirs(): SessionDirs {
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return { sessions: path.join(config, 'sessions'), jobs: path.join(config, 'jobs') };
}

const STATUSES = new Map([
  ['busy', 'busy'],
  ['shell', 'shell'],
  ['idle', 'idle'],
  ['waiting', 'waiting'],
]);

function isAlive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 1) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readObject(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function time(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function interactiveRows(dir: string, alive: (pid: unknown) => boolean, bootedAt: number): unknown[] | null {
  const rows: unknown[] = [];
  for (const name of fs.readdirSync(dir)) {
    const match = /^(\d+)\.json$/.exec(name);
    if (!match || !alive(Number(match[1]))) continue;
    const file = readObject(path.join(dir, name));
    if (!file) return null;
    if ((time(file.updatedAt) ?? 0) < bootedAt) continue;
    if (file.kind !== 'interactive') continue;
    const status = STATUSES.get(String(file.status));
    if (!status) return null;
    rows.push({
      kind: 'interactive',
      pid: file.pid,
      cwd: file.cwd,
      startedAt: file.startedAt,
      sessionId: file.sessionId,
      status,
      waitingFor: typeof file.waitingFor === 'string' ? file.waitingFor : undefined,
      statusUpdatedAt: time(file.statusUpdatedAt),
    });
  }
  return rows;
}

function backgroundRows(dir: string): unknown[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const rows: unknown[] = [];
  for (const name of names) {
    const job = readObject(path.join(dir, name, 'state.json'));
    if (!job) continue;
    rows.push({
      kind: 'background',
      id: name,
      cwd: job.cwd,
      startedAt: time(job.createdAt),
      sessionId: job.sessionId,
      state: job.state,
      statusUpdatedAt: time(job.updatedAt),
    });
  }
  return rows;
}

function readSessionFiles(dirs: SessionDirs = claudeDirs(), alive: (pid: unknown) => boolean = isAlive, bootedAt = Date.now() - os.uptime() * 1000): unknown[] | null {
  try {
    const interactive = interactiveRows(dirs.sessions, alive, bootedAt);
    return interactive && [...interactive, ...backgroundRows(dirs.jobs)];
  } catch {
    return null;
  }
}

export { readSessionFiles, isAlive };
export type { SessionDirs };
