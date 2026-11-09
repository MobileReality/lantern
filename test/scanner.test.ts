import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_OUTPUT_BYTES, parseSessions, scan, scannedFromFiles } from '../src/main/scanner';

const originalOverride = process.env.LANTERN_CLAUDE_BIN;
let temp = '';

afterEach(() => {
  if (originalOverride === undefined) delete process.env.LANTERN_CLAUDE_BIN;
  else process.env.LANTERN_CLAUDE_BIN = originalOverride;
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  temp = '';
});

describe('parseSessions', () => {
  it('maps interactive process status and preserves waiting details', () => {
    const rows = parseSessions(JSON.stringify([
      { cwd: '/repo', kind: 'interactive', startedAt: 10, sessionId: 's1', status: 'busy' },
      { cwd: '/other', kind: 'interactive', startedAt: 20, status: 'waiting', waitingFor: 'permission prompt' },
      { cwd: '/idle', kind: 'interactive', startedAt: 30, sessionId: 's3', status: 'idle' },
    ]));
    expect(rows?.map((row) => [row.id, row.state, row.waitingFor])).toEqual([
      ['interactive:/repo:10', 'running', ''],
      ['interactive:/other:20', 'permission', 'permission prompt'],
      ['interactive:/idle:30', 'done', ''],
    ]);
  });

  it('drops Lantern scratch sessions but keeps look-alike project paths', () => {
    const rows = parseSessions(JSON.stringify([
      { cwd: '/tmp/areas-reader-abc123', kind: 'interactive', startedAt: 1, status: 'busy' },
      { cwd: '/Users/x/areas-reader-app/src', kind: 'interactive', startedAt: 2, status: 'busy' },
      { cwd: '/Users/x/repo', kind: 'interactive', startedAt: 3, status: 'busy' },
    ]));
    expect(rows?.map((row) => row.cwd)).toEqual(['/Users/x/areas-reader-app/src', '/Users/x/repo']);
  });

  it('treats background state as authoritative over process status', () => {
    const rows = parseSessions(JSON.stringify([
      { id: 'a', cwd: '/a', kind: 'background', startedAt: 1, state: 'working', status: 'idle' },
      { id: 'b', cwd: '/b', kind: 'background', startedAt: 2, state: 'blocked', status: 'busy', waitingFor: 'input needed' },
      { id: 'c', cwd: '/c', kind: 'background', startedAt: 3, state: 'failed', status: 'idle' },
      { id: 'd', cwd: '/d', kind: 'background', startedAt: 4, status: 'idle' },
    ]));
    expect(rows?.map((row) => row.state)).toEqual(['running', 'idle', 'failed', 'unknown']);
  });

  it('distinguishes approval blockers from input and worker waits', () => {
    const rows = parseSessions(JSON.stringify([
      { id: 'a', cwd: '/a', kind: 'background', startedAt: 1, state: 'blocked', waitingFor: 'permission prompt' },
      { id: 'b', cwd: '/b', kind: 'background', startedAt: 2, state: 'blocked', waitingFor: 'sandbox request' },
      { id: 'c', cwd: '/c', kind: 'background', startedAt: 3, state: 'blocked', waitingFor: 'worker request' },
      { id: 'd', cwd: '/d', kind: 'background', startedAt: 4, state: 'blocked', waitingFor: 'dialog open' },
      { cwd: '/e', kind: 'interactive', startedAt: 5, status: 'waiting', waitingFor: 'input needed' },
    ]));
    expect(rows?.map((row) => row.state)).toEqual(['permission', 'permission', 'idle', 'idle', 'idle']);
  });

  it('maps an unknown state or status to unknown for that row only', () => {
    const rows = parseSessions(JSON.stringify([
      { id: 'a', cwd: '/a', kind: 'background', startedAt: 1, state: 'working' },
      { id: 'b', cwd: '/b', kind: 'background', startedAt: 2, state: 'paused' },
      { cwd: '/c', kind: 'interactive', startedAt: 3, status: 'sleeping' },
      { id: 'd', cwd: '/d', kind: 'background', startedAt: 4, state: 'constructor' },
      { id: 'e', cwd: '/e', kind: 'background', startedAt: 5, state: 'done' },
    ]));
    expect(rows?.map((row) => [row.id, row.state])).toEqual([
      ['a', 'running'],
      ['b', 'unknown'],
      ['interactive:/c:3', 'unknown'],
      ['d', 'unknown'],
      ['e', 'done'],
    ]);
  });

  it('tags every session with the claude provider', () => {
    const rows = parseSessions(JSON.stringify([
      { id: 'a', cwd: '/a', kind: 'background', startedAt: 1, state: 'working' },
      { cwd: '/b', kind: 'interactive', startedAt: 2, status: 'idle' },
    ]));
    expect(rows?.map((row) => row.provider)).toEqual(['claude', 'claude']);
  });

  it('rejects non-array output and drops only malformed rows and duplicate identities', () => {
    expect(parseSessions('{}')).toBeNull();
    expect(parseSessions('not json')).toBeNull();
    const rows = parseSessions(JSON.stringify([
      { id: '', cwd: '/empty', kind: 'background', startedAt: 1 },
      { id: 'typed', cwd: '/typed', kind: 'background', startedAt: 2, state: 7 },
      { id: 'nocwd', kind: 'background', startedAt: 3 },
      null,
      { id: 'a', cwd: '/a', kind: 'background', startedAt: 4, state: 'working' },
      { id: 'a', cwd: '/b', kind: 'background', startedAt: 5, state: 'done' },
      { id: 'b', cwd: '/b', kind: 'background', startedAt: 6, state: 'done' },
    ]));
    expect(rows?.map((row) => [row.id, row.cwd])).toEqual([['a', '/a'], ['b', '/b']]);
  });
});

describe('scan', () => {
  function fixture(output: string, exitCode = 0, delayMs = 0) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-agents-'));
    const file = path.join(temp, 'claude');
    fs.writeFileSync(file, `#!/usr/bin/env node\nif(process.argv.slice(2).join(' ')!=='agents --json --all')process.exit(9);setTimeout(()=>{process.stdout.write(${JSON.stringify(output)});process.exit(${exitCode});},${delayMs});\n`);
    fs.chmodSync(file, 0o755);
    process.env.LANTERN_CLAUDE_BIN = file;
  }

  it('runs the configured CLI fixture with real subprocess I/O', async () => {
    fixture('[{"id":"bg","cwd":"/repo","kind":"background","startedAt":1,"state":"done"}]');
    await expect(scan({ files: () => null })).resolves.toMatchObject([{ id: 'bg', state: 'done' }]);
  });

  it('returns unavailable for malformed output or a failed CLI process', async () => {
    fixture('not json');
    await expect(scan({ files: () => null })).resolves.toBeNull();
    fs.rmSync(temp, { recursive: true, force: true });
    temp = '';
    fixture('[]', 2);
    await expect(scan({ files: () => null })).resolves.toBeNull();
  });

  it('returns unavailable when the CLI exceeds the output limit', async () => {
    fixture('x'.repeat(MAX_OUTPUT_BYTES + 1));
    await expect(scan({ files: () => null })).resolves.toBeNull();
  });

  it('returns unavailable when the CLI outlives the timeout', async () => {
    fixture('[]', 0, 5000);
    const started = Date.now();
    await expect(scan({ files: () => null, timeoutMs: 200 })).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('keeps a good row when another row has an unknown status', async () => {
    fixture(JSON.stringify([
      { id: 'a', cwd: '/a', kind: 'background', startedAt: 1, state: 'working' },
      { id: 'b', cwd: '/b', kind: 'background', startedAt: 2, state: 'something-new' },
    ]));
    await expect(scan({ files: () => null })).resolves.toMatchObject([{ id: 'a', state: 'running' }, { id: 'b', state: 'unknown' }]);
  });

  it('reads the session files instead of starting the CLI when they are readable', async () => {
    fixture('[]', 2);
    const files = () => [{ kind: 'interactive', cwd: '/repo', startedAt: 5, sessionId: 's', status: 'idle', statusUpdatedAt: 42 }];
    await expect(scan({ files })).resolves.toMatchObject([{ id: 'interactive:/repo:5', state: 'done', changedAt: 42 }]);
    expect(scannedFromFiles()).toBe(true);
  });

  it('falls back to the CLI when the session files are not usable', async () => {
    fixture('[{"id":"bg","cwd":"/repo","kind":"background","startedAt":1,"state":"done"}]');
    await expect(scan({ files: () => null })).resolves.toMatchObject([{ id: 'bg', state: 'done', changedAt: 0 }]);
    expect(scannedFromFiles()).toBe(false);
  });
});
