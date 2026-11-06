import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAlive, readSessionFiles } from '../src/main/session-files';
import { parseSessions } from '../src/main/scanner';

let root = '';
let dirs = { sessions: '', jobs: '' };
const live = new Set([100, 200, 300]);
const alive = (pid: unknown) => live.has(pid as number);

function session(pid: number, fields: Record<string, unknown>) {
  fs.writeFileSync(path.join(dirs.sessions, `${pid}.json`), JSON.stringify({ pid, kind: 'interactive', cwd: `/p${pid}`, startedAt: pid, sessionId: `s${pid}`, updatedAt: 5000, ...fields }));
}

function job(id: string, fields: Record<string, unknown>) {
  fs.mkdirSync(path.join(dirs.jobs, id));
  fs.writeFileSync(path.join(dirs.jobs, id, 'state.json'), JSON.stringify(fields));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-session-files-'));
  dirs = { sessions: path.join(root, 'sessions'), jobs: path.join(root, 'jobs') };
  fs.mkdirSync(dirs.sessions);
  fs.mkdirSync(dirs.jobs);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('readSessionFiles', () => {
  it('turns live session files into the rows claude agents prints, a background shell kept as its own status', () => {
    session(100, { status: 'busy', statusUpdatedAt: 1000 });
    session(200, { status: 'shell' });
    session(300, { status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: 3000 });
    fs.writeFileSync(path.join(dirs.sessions, '100.abc.key'), 'not json');
    const rows = parseSessions(JSON.stringify(readSessionFiles(dirs, alive, 0)));
    expect(rows?.map((row) => [row.id, row.state, row.waitingFor, row.changedAt]).sort()).toEqual([
      ['interactive:/p100:100', 'running', '', 1000],
      ['interactive:/p200:200', 'shell', '', 0],
      ['interactive:/p300:300', 'permission', 'permission prompt', 3000],
    ]);
  });

  it('skips sessions whose process is gone', () => {
    session(100, { status: 'idle' });
    session(999, { status: 'busy' });
    expect(readSessionFiles(dirs, alive, 0)).toHaveLength(1);
  });

  it('reads background jobs by folder name, ignoring loose files', () => {
    job('744d719a', { state: 'blocked', cwd: '/bg', sessionId: 'b1', createdAt: '2026-07-16T11:56:28.776Z', updatedAt: '2026-08-02T08:48:19.718Z' });
    fs.writeFileSync(path.join(dirs.jobs, 'pins.json'), '{}');
    const [row] = parseSessions(JSON.stringify(readSessionFiles(dirs, alive, 0))) ?? [];
    expect(row).toMatchObject({ id: '744d719a', kind: 'background', state: 'idle', startedAt: Date.parse('2026-07-16T11:56:28.776Z'), changedAt: Date.parse('2026-08-02T08:48:19.718Z') });
  });

  it('gives up, so the CLI is used, on a missing folder, a live unreadable file or a status it does not know', () => {
    expect(readSessionFiles({ sessions: path.join(root, 'missing'), jobs: dirs.jobs }, alive, 0)).toBeNull();
    session(100, { status: 'thinking' });
    expect(readSessionFiles(dirs, alive, 0)).toBeNull();
    fs.writeFileSync(path.join(dirs.sessions, '100.json'), '{"pid": 100, "sta');
    expect(readSessionFiles(dirs, alive, 0)).toBeNull();
  });

  it('ignores a garbled file of a dead session, other session kinds, and files from before the last boot', () => {
    fs.writeFileSync(path.join(dirs.sessions, '999.json'), '{"pid": 999, "sta');
    session(100, { status: 'idle', kind: 'daemon' });
    session(200, { status: 'idle', updatedAt: 10 });
    session(300, { status: 'busy', updatedAt: 9000 });
    const rows = readSessionFiles(dirs, alive, 1000) as Array<{ pid: number }>;
    expect(rows.map((row) => row.pid)).toEqual([300]);
  });
});

describe('isAlive', () => {
  it('never probes pids that reach other processes and sees this process as alive', () => {
    expect([0, 1, -1, 1.5, '42', undefined].map(isAlive)).toEqual([false, false, false, false, false, false]);
    expect(isAlive(process.pid)).toBe(true);
  });
});
