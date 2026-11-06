import { describe, expect, it } from 'vitest';
import { isSignalablePid, killTree, terminatePids, type KillDeps } from '../src/main/prockill';
import { parsePsAged } from '../src/main/memory-parse';
import { fixture } from './helpers/memory-fixtures';

const ALL_ROWS = parsePsAged(fixture('ps-aged.txt'));

interface Sent {
  pid: number;
  signal: string;
}

function recorder(dies: (signal: string) => boolean = () => true) {
  const sent: Sent[] = [];
  const gone = new Set<number>();
  const deps: KillDeps = {
    signal: (pid, signal) => {
      sent.push({ pid, signal });
      if (dies(signal)) gone.add(pid);
    },
    snapshot: async () => ALL_ROWS.filter((row) => !gone.has(row.pid)),
  };
  return { sent, deps, pidsOf: (signal: string) => sent.filter((s) => s.signal === signal).map((s) => s.pid) };
}

describe('isSignalablePid', () => {
  it.each([1, 0, -1, -4020, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (pid) => {
    expect(isSignalablePid(pid)).toBe(false);
  });

  it('accepts an ordinary pid', () => {
    expect(isSignalablePid(2)).toBe(true);
    expect(isSignalablePid(4020)).toBe(true);
  });
});

describe('terminatePids', () => {
  it('never hands pid 1 or lower to the kill function', async () => {
    const { sent, deps } = recorder();
    const targets = await terminatePids([1, 0, -1, 4020, 4022], 0, deps);
    expect(targets).toEqual([4020, 4022]);
    expect(sent.map((s) => s.pid)).toEqual([4020, 4022]);
  });

  it('signals nothing when every pid is refused', async () => {
    const { sent, deps } = recorder();
    expect(await terminatePids([1, 0, -1], 0, deps)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('signals exactly the pids it was given, never their children', async () => {
    const { pidsOf, deps } = recorder();
    await terminatePids([4020], 0, deps);
    expect(pidsOf('SIGTERM')).toEqual([4020]);
    expect(pidsOf('SIGKILL')).toEqual([]);
  });

  it('terminates politely first and force-kills only the listed pids that survive', async () => {
    const { pidsOf, deps } = recorder((signal) => signal === 'SIGKILL');
    await terminatePids([4020, 4022], 0, deps);
    expect(pidsOf('SIGTERM')).toEqual([4020, 4022]);
    expect(pidsOf('SIGKILL')).toEqual([4020, 4022]);
  });

  it('survives a kill function that throws', async () => {
    const deps: KillDeps = {
      signal: () => {
        throw new Error('ESRCH');
      },
      snapshot: async () => [],
    };
    await expect(terminatePids([4020], 0, deps)).resolves.toEqual([4020]);
  });
});

describe('killTree with an injected kill function', () => {
  it('refuses a root of pid 1 or lower without taking a snapshot', async () => {
    const { sent, deps } = recorder();
    let snapshots = 0;
    const counted: KillDeps = { ...deps, snapshot: async () => (snapshots++, ALL_ROWS) };
    for (const root of [1, 0, -1]) await killTree(root, 0, counted);
    expect(sent).toEqual([]);
    expect(snapshots).toBe(0);
  });

  it('signals the root and everything below it, and nothing else', async () => {
    const { pidsOf, deps } = recorder();
    await killTree(4020, 0, deps);
    expect(pidsOf('SIGTERM').sort((a, b) => a - b)).toEqual([4020, 4021, 4022, 4023, 4025, 4030, 4031, 4032, 4033]);
  });
});
