import { describe, expect, it } from 'vitest';
import {
  LARGE_PROCESS_BYTES,
  MEMORY_HISTORY_LENGTH,
  MEMORY_TOP_COUNT,
  OLD_PROCESS_SECONDS,
  isOldAndLarge,
} from '../src/shared/memory';
import { collectMemory, type MemorySample, type SampledProcess } from '../src/main/memory-collect';
import { MemoryHistory, projectNames, summarize } from '../src/main/memory-summary';
import { PROJECT_MOBILE, PROJECT_WEBAPP, ROOT_PID, fakeRunner } from './helpers/memory-fixtures';

const MB = 1024 ** 2;

const proc = (pid: number, bytes: number, extra: Partial<SampledProcess> = {}): SampledProcess => ({
  pid,
  ppid: ROOT_PID,
  category: 'other',
  kind: 'node',
  name: 'Node process',
  label: 'node',
  projectPath: null,
  ageSeconds: 60,
  bytes,
  ...extra,
});
const sampleOf = (processes: SampledProcess[]): MemorySample => ({ takenAt: 0, sampleMs: 700, processes, installedBytes: 16 * 1024 ** 3, freePercent: 40 });

describe('the old-and-large rule', () => {
  it('flags a process only when it is both older than 24 hours and larger than 1 GB', () => {
    expect(isOldAndLarge(LARGE_PROCESS_BYTES + 1, OLD_PROCESS_SECONDS + 1)).toBe(true);
    expect(isOldAndLarge(LARGE_PROCESS_BYTES + 1, OLD_PROCESS_SECONDS - 60)).toBe(false);
    expect(isOldAndLarge(LARGE_PROCESS_BYTES - 1, OLD_PROCESS_SECONDS * 4)).toBe(false);
  });

  it('treats exactly 24 hours and exactly 1 GB as not yet old or large', () => {
    expect(isOldAndLarge(LARGE_PROCESS_BYTES, OLD_PROCESS_SECONDS + 1)).toBe(false);
    expect(isOldAndLarge(LARGE_PROCESS_BYTES + 1, OLD_PROCESS_SECONDS)).toBe(false);
  });

  it('uses the thresholds the ticket names', () => {
    expect(OLD_PROCESS_SECONDS).toBe(24 * 3600);
    expect(LARGE_PROCESS_BYTES).toBe(1024 ** 3);
  });
});

describe('summarize', () => {
  it('lists the ten largest processes, biggest first', () => {
    const processes = Array.from({ length: 14 }, (_, i) => proc(100 + i, (i + 1) * MB));
    const snapshot = summarize(sampleOf(processes), new MemoryHistory());
    expect(snapshot.processes).toHaveLength(MEMORY_TOP_COUNT);
    expect(snapshot.processes[0].bytes).toBe(14 * MB);
    expect(snapshot.processes.map((p) => p.bytes)).toEqual([...snapshot.processes.map((p) => p.bytes)].sort((a, b) => b - a));
    expect(snapshot.processCount).toBe(14);
  });

  it('keeps a flagged process in the list even when ten larger ones exist, and marks it', () => {
    const big = Array.from({ length: 10 }, (_, i) => proc(100 + i, 5 * 1024 ** 3));
    const old = proc(200, LARGE_PROCESS_BYTES + 5 * MB, { ageSeconds: OLD_PROCESS_SECONDS + 100 });
    const snapshot = summarize(sampleOf([...big, old]), new MemoryHistory());
    expect(snapshot.processes).toHaveLength(11);
    expect(snapshot.processes.find((p) => p.pid === 200)?.oldAndLarge).toBe(true);
    expect(snapshot.processes.filter((p) => p.oldAndLarge)).toHaveLength(1);
    expect(snapshot.oldAndLargeCount).toBe(1);
  });

  it('totals by category in a fixed order, empty categories included', () => {
    const snapshot = summarize(
      sampleOf([proc(1, 10 * MB, { category: 'app' }), proc(2, 5 * MB, { category: 'agents' }), proc(3, 7 * MB, { category: 'agents' })]),
      new MemoryHistory(),
    );
    expect(snapshot.categories).toEqual([
      { category: 'app', bytes: 10 * MB, count: 1 },
      { category: 'editor', bytes: 0, count: 0 },
      { category: 'agents', bytes: 12 * MB, count: 2 },
      { category: 'other', bytes: 0, count: 0 },
    ]);
    expect(snapshot.totalBytes).toBe(22 * MB);
  });

  it('builds the per-project table and keeps unattributed memory last and honest', () => {
    const snapshot = summarize(
      sampleOf([
        proc(1, 400 * MB, { kind: 'extension-host', category: 'editor', projectPath: PROJECT_WEBAPP }),
        proc(2, 300 * MB, { kind: 'claude', category: 'agents', projectPath: PROJECT_WEBAPP }),
        proc(3, 900 * MB, { kind: 'tsserver', category: 'editor', projectPath: PROJECT_WEBAPP }),
        proc(4, 100 * MB, { projectPath: PROJECT_MOBILE }),
        proc(5, 2000 * MB, { category: 'app', kind: 'renderer' }),
      ]),
      new MemoryHistory(),
    );
    expect(snapshot.projects).toEqual([
      { project: 'webapp', hosts: 400 * MB, agents: 300 * MB, tsserver: 900 * MB, total: 1600 * MB, count: 3 },
      { project: 'mobile', hosts: 0, agents: 0, tsserver: 0, total: 100 * MB, count: 1 },
      { project: null, hosts: 0, agents: 0, tsserver: 0, total: 2000 * MB, count: 1 },
    ]);
  });

  it('carries the system figures and what the sample cost', () => {
    const snapshot = summarize(sampleOf([proc(1, MB)]), new MemoryHistory());
    expect(snapshot).toMatchObject({ installedBytes: 16 * 1024 ** 3, freePercent: 40, sampleMs: 700 });
  });

  it('is plain data with no command lines', async () => {
    const runner = fakeRunner();
    const sample = await collectMemory({ run: runner.run, rootPid: ROOT_PID, projectPaths: () => [PROJECT_WEBAPP], now: Date.now, installedBytes: () => 0 });
    const snapshot = summarize(sample, new MemoryHistory());
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toMatch(/7e166f5d|--resume|shell-snapshots|cancellationPipeName|\/Users\/dev\/\.vscode/);
  });
});

describe('projectNames', () => {
  it('uses the folder name, and the parent folder when two share a name', () => {
    expect(projectNames(['/a/work/app', '/a/play/app', '/a/work/site'])).toEqual(
      new Map([
        ['/a/work/app', 'work/app'],
        ['/a/play/app', 'play/app'],
        ['/a/work/site', 'site'],
      ]),
    );
  });
});

describe('MemoryHistory', () => {
  it('collects a series per process and a series for the total', () => {
    const history = new MemoryHistory();
    history.record([proc(1, 10, { ageSeconds: 5 }), proc(2, 20, { ageSeconds: 5 })]);
    history.record([proc(1, 12, { ageSeconds: 10 }), proc(2, 18, { ageSeconds: 10 })]);
    expect(history.series(1)).toEqual([10, 12]);
    expect(history.series(2)).toEqual([20, 18]);
    expect(history.totalSeries()).toEqual([30, 30]);
  });

  it('starts over when a pid is reused by a younger process', () => {
    const history = new MemoryHistory();
    history.record([proc(1, 10, { ageSeconds: 500 })]);
    history.record([proc(1, 99, { ageSeconds: 2 })]);
    expect(history.series(1)).toEqual([99]);
  });

  it('forgets processes that are gone', () => {
    const history = new MemoryHistory();
    history.record([proc(1, 10)]);
    history.record([proc(2, 10)]);
    expect(history.series(1)).toEqual([]);
  });

  it('keeps only the last few minutes', () => {
    const history = new MemoryHistory();
    for (let i = 0; i < MEMORY_HISTORY_LENGTH + 10; i++) history.record([proc(1, i, { ageSeconds: i })]);
    expect(history.series(1)).toHaveLength(MEMORY_HISTORY_LENGTH);
    expect(history.series(1).at(-1)).toBe(MEMORY_HISTORY_LENGTH + 9);
    expect(history.totalSeries()).toHaveLength(MEMORY_HISTORY_LENGTH);
  });

  it('clears everything', () => {
    const history = new MemoryHistory();
    history.record([proc(1, 10)]);
    history.clear();
    expect(history.series(1)).toEqual([]);
    expect(history.totalSeries()).toEqual([]);
  });
});
