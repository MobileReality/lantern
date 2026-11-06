import { describe, expect, it } from 'vitest';
import {
  BASE_INTERVAL_MS,
  CHEAP_INTERVAL_MS,
  FAILURE_INTERVAL_CAP_MS,
  NO_WINDOW_INTERVAL_MS,
  QUIET_INTERVAL_CAP_MS,
  createPoller,
  nextDelay,
  snapshotSignature,
} from '../src/main/claude-poll';
import type { SessionSnapshot } from '../src/main/scanner';

const row = (id: string, state: SessionSnapshot['state'] = 'running'): SessionSnapshot => ({
  id, provider: 'claude', sessionId: id, cwd: `/${id}`, kind: 'background', state, startedAt: 1, waitingFor: '', changedAt: 0,
});

function harness(scans: Array<() => Promise<SessionSnapshot[] | null>>, windowOpen = true, cheap?: () => boolean) {
  const timers: Array<{ ms: number; run: () => void; cleared: boolean }> = [];
  const applied: Array<SessionSnapshot[] | null> = [];
  let published = 0;
  let calls = 0;
  const poller = createPoller({
    scan: () => scans[Math.min(calls++, scans.length - 1)](),
    apply: (snapshot) => { applied.push(snapshot); },
    publish: () => { published += 1; },
    hasOpenWindow: () => windowOpen,
    cheap,
    setTimer: (run, ms) => {
      const timer = { ms, run, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => { (handle as { cleared: boolean }).cleared = true; },
  });
  const pending = () => timers.filter((timer) => !timer.cleared);
  const fire = async () => {
    const timer = pending().at(-1)!;
    timer.cleared = true;
    timer.run();
    await poller.pollNow();
  };
  return { poller, timers, pending, fire, applied, published: () => published, scanCalls: () => calls };
}

describe('nextDelay', () => {
  it('starts at the base interval and doubles while nothing changes, up to a cap', () => {
    const delays = [0, 1, 2, 3, 4, 5, 9].map((quietPolls) => nextDelay({ quietPolls, failures: 0 }, true));
    expect(delays).toEqual([4000, 4000, 4000, 8000, 16000, QUIET_INTERVAL_CAP_MS, QUIET_INTERVAL_CAP_MS]);
    expect(BASE_INTERVAL_MS).toBe(4000);
  });

  it('backs off harder after failures and caps them', () => {
    expect([1, 2, 3, 6].map((failures) => nextDelay({ quietPolls: 0, failures }, true))).toEqual([8000, 16000, 32000, FAILURE_INTERVAL_CAP_MS]);
  });

  it('never polls faster than the no-window floor when no window is open', () => {
    expect(nextDelay({ quietPolls: 0, failures: 0 }, false)).toBe(NO_WINDOW_INTERVAL_MS);
    expect(nextDelay({ quietPolls: 9, failures: 0 }, false)).toBe(QUIET_INTERVAL_CAP_MS);
    expect(nextDelay({ quietPolls: 0, failures: 6 }, false)).toBe(FAILURE_INTERVAL_CAP_MS);
  });
});

describe('snapshotSignature', () => {
  it('ignores row order and tells apart state changes, failures and empty lists', () => {
    expect(snapshotSignature([row('a'), row('b')])).toBe(snapshotSignature([row('b'), row('a')]));
    expect(snapshotSignature([row('a')])).not.toBe(snapshotSignature([row('a', 'done')]));
    expect(snapshotSignature([])).not.toBe(snapshotSignature(null));
  });
});

describe('createPoller', () => {
  it('never overlaps: a second request while a scan is in flight shares it', async () => {
    let release: (value: SessionSnapshot[] | null) => void = () => {};
    const h = harness([() => new Promise((resolve) => { release = resolve; })]);

    const first = h.poller.pollNow();
    const second = h.poller.pollNow();
    h.poller.wake();
    expect(second).toBe(first);
    expect(h.scanCalls()).toBe(1);

    release([row('a')]);
    await first;
    expect(h.scanCalls()).toBe(1);
    expect(h.applied).toHaveLength(1);
  });

  it('schedules the next poll only after the current one finished', async () => {
    let release: (value: SessionSnapshot[] | null) => void = () => {};
    const h = harness([() => new Promise((resolve) => { release = resolve; })]);

    h.poller.start();
    expect(h.timers).toHaveLength(0);
    release([]);
    await h.poller.pollNow();
    expect(h.pending()).toHaveLength(1);
  });

  it('backs off while nothing changes and resets when a session changes', async () => {
    const h = harness([
      async () => [row('a')],
      async () => [row('a')],
      async () => [row('a')],
      async () => [row('a')],
      async () => [row('a')],
      async () => [row('a', 'done')],
    ]);

    h.poller.start();
    await h.poller.pollNow();
    const delays = [h.pending().at(-1)!.ms];
    for (let poll = 0; poll < 5; poll += 1) {
      await h.fire();
      delays.push(h.pending().at(-1)!.ms);
    }
    expect(delays).toEqual([4000, 4000, 4000, 8000, 16000, 4000]);
    expect(h.published()).toBe(2);
  });

  it('backs off on failures, publishes the first failure once, and recovers quickly', async () => {
    const h = harness([async () => null, async () => null, async () => null, async () => [row('a')]]);

    h.poller.start();
    await h.poller.pollNow();
    expect(h.pending().at(-1)!.ms).toBe(8000);
    await h.fire();
    expect(h.pending().at(-1)!.ms).toBe(16000);
    await h.fire();
    expect(h.pending().at(-1)!.ms).toBe(32000);
    await h.fire();
    expect(h.pending().at(-1)!.ms).toBe(4000);
    expect(h.applied).toEqual([null, null, null, [row('a')]]);
    expect(h.published()).toBe(2);
  });

  it('treats a scan that throws as a failed poll', async () => {
    const h = harness([async () => { throw new Error('spawn failed'); }]);

    h.poller.start();
    await h.poller.pollNow();
    expect(h.applied).toEqual([null]);
    expect(h.pending().at(-1)!.ms).toBe(8000);
  });

  it('polls slower with no open window', async () => {
    const h = harness([async () => [row('a')]], false);

    h.poller.start();
    await h.poller.pollNow();
    expect(h.pending().at(-1)!.ms).toBe(NO_WINDOW_INTERVAL_MS);
  });

  it('wakes immediately and resets the backoff', async () => {
    const h = harness([async () => [row('a')]]);

    h.poller.start();
    await h.poller.pollNow();
    await h.fire();
    await h.fire();
    await h.fire();
    expect(h.pending().at(-1)!.ms).toBe(8000);
    const before = h.scanCalls();
    h.poller.wake();
    await h.poller.pollNow();
    expect(h.scanCalls()).toBe(before + 1);
    expect(h.pending()).toHaveLength(1);
  });

  it('stops scheduling once stopped', async () => {
    const h = harness([async () => [row('a')]]);

    h.poller.start();
    await h.poller.pollNow();
    h.poller.stop();
    expect(h.pending()).toHaveLength(0);
  });

  it('polls every 2 seconds without backoff while scans are cheap, and backs off again on failure', async () => {
    const h = harness([async () => [row('a')], async () => [row('a')], async () => [row('a')], async () => null], false, () => true);
    h.poller.start();
    await h.poller.pollNow();
    const delays = [h.pending().at(-1)!.ms];
    for (let poll = 0; poll < 3; poll += 1) {
      await h.fire();
      delays.push(h.pending().at(-1)!.ms);
    }
    expect(delays).toEqual([CHEAP_INTERVAL_MS, CHEAP_INTERVAL_MS, CHEAP_INTERVAL_MS, NO_WINDOW_INTERVAL_MS]);
  });
});
