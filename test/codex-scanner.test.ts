import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanCodex } from '../src/main/codex-scanner';

describe('scanCodex', () => {
  let root: string;
  const now = new Date(2026, 9, 2, 12).getTime();

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-codex-scan-'));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function session(name: string, payload: Record<string, unknown>, ageMs: number, tail?: object) {
    const date = new Date(now);
    const dir = path.join(root, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.jsonl`);
    const lines = [JSON.stringify({ type: 'session_meta', payload }), ...(tail ? [JSON.stringify(tail)] : [])];
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    const time = new Date(now - ageMs);
    fs.utimesSync(file, time, time);
  }

  it('reads only main-session metadata and uses recent mtime as a bounded activity fallback', () => {
    session('active', { id: 'active-id', cwd: '/repo/a', source: 'vscode' }, 5_000, { type: 'event_msg', payload: { type: 'item_completed', message: 'ignored' } });
    session('idle', { session_id: 'idle-id1', cwd: '/repo/b', source: 'cli' }, 60_000);
    session('worker', { id: 'worker-id', cwd: '/repo/c', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }, 2_000);

    expect(scanCodex(root, now)).toEqual([
      { id: 'active-id', provider: 'codex', cwd: '/repo/a', project: 'a', state: 'running', updatedAt: now - 5_000 },
      { id: 'idle-id1', provider: 'codex', cwd: '/repo/b', project: 'b', state: 'idle', updatedAt: now - 60_000 },
    ]);
  });

  it('skips old, malformed and incomplete metadata', () => {
    session('old', { id: 'old-id', cwd: '/repo/old', source: 'vscode' }, 11 * 60_000);
    session('missing', { id: 'missing-id', source: 'vscode' }, 1_000);
    session('unknown', { id: 'unknown-id', cwd: '/repo/unknown', source: 'future-client' }, 1_000);
    expect(scanCodex(root, now)).toEqual([]);
  });
});
