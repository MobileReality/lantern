import { describe, expect, it, vi } from 'vitest';
import { MEMORY_SAMPLE_INTERVAL_MS, type MemorySnapshot } from '../src/shared/memory';
import type { MemorySample } from '../src/main/memory-collect';
import { createSampler } from '../src/main/memory-sampler';

const snapshotOf = (takenAt: number) => ({ takenAt }) as MemorySnapshot;

function rig() {
  const clock = { now: 10_000 };
  const timers: { id: number; run: () => void; delayMs: number; live: boolean }[] = [];
  const pending: { resolve: (s: MemorySample) => void; reject: (e: unknown) => void }[] = [];
  const collect = vi.fn(
    () =>
      new Promise<MemorySample>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  const summarize = vi.fn((sample: MemorySample) => snapshotOf(sample.takenAt));
  const reset = vi.fn();
  const onError = vi.fn();
  const sampler = createSampler({
    collect,
    summarize,
    reset,
    onError,
    now: () => clock.now,
    schedule: (run, delayMs) => {
      const timer = { id: timers.length, run, delayMs, live: true };
      timers.push(timer);
      return timer.id;
    },
    cancel: (handle) => {
      timers[handle as number].live = false;
    },
  });
  const finish = async (takenAt = clock.now) => {
    pending.shift()!.resolve({ takenAt } as MemorySample);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const liveTimers = () => timers.filter((t) => t.live);
  const fire = () => {
    const timer = liveTimers()[0];
    timer.live = false;
    timer.run();
  };
  return { clock, sampler, collect, summarize, reset, onError, finish, liveTimers, fire, pending };
}

describe('the sampling throttle', () => {
  it('does nothing until a view opens', () => {
    const { collect, liveTimers } = rig();
    expect(collect).not.toHaveBeenCalled();
    expect(liveTimers()).toHaveLength(0);
  });

  it('takes the first sample as soon as the first view opens', async () => {
    const { sampler, collect, finish } = rig();
    const seen: MemorySnapshot[] = [];
    sampler.subscribe((s) => seen.push(s));
    expect(collect).toHaveBeenCalledTimes(1);
    await finish(1);
    expect(seen).toEqual([snapshotOf(1)]);
  });

  it('waits the full interval after a sample before taking the next one', async () => {
    const { sampler, collect, finish, liveTimers, fire } = rig();
    sampler.subscribe(() => {});
    await finish();
    expect(liveTimers().map((t) => t.delayMs)).toEqual([MEMORY_SAMPLE_INTERVAL_MS]);
    expect(MEMORY_SAMPLE_INTERVAL_MS).toBeGreaterThanOrEqual(5000);
    expect(collect).toHaveBeenCalledTimes(1);
    fire();
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('never runs two samples at once', async () => {
    const { sampler, collect, finish, fire, liveTimers } = rig();
    sampler.subscribe(() => {});
    sampler.subscribe(() => {});
    expect(collect).toHaveBeenCalledTimes(1);
    await finish();
    fire();
    expect(collect).toHaveBeenCalledTimes(2);
    expect(liveTimers()).toHaveLength(0);
    await finish();
    expect(liveTimers()).toHaveLength(1);
  });

  it('hands a second view the latest reading without sampling again', async () => {
    const { sampler, collect, finish } = rig();
    sampler.subscribe(() => {});
    await finish(7);
    const late = vi.fn();
    sampler.subscribe(late);
    expect(late).toHaveBeenCalledWith(snapshotOf(7));
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it('keeps going after a failed sample', async () => {
    const { sampler, pending, onError, liveTimers } = rig();
    sampler.subscribe(() => {});
    pending.shift()!.reject(new Error('top failed'));
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    await vi.waitFor(() => expect(liveTimers()).toHaveLength(1));
  });
});

describe('stopping when the view closes', () => {
  it('cancels the timer and forgets the history when the last view closes', async () => {
    const { sampler, finish, liveTimers, reset } = rig();
    const unsubscribe = sampler.subscribe(() => {});
    await finish();
    expect(liveTimers()).toHaveLength(1);
    unsubscribe();
    expect(liveTimers()).toHaveLength(0);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(sampler.isRunning()).toBe(false);
    expect(sampler.latest()).toBeNull();
  });

  it('keeps sampling while another view is still open', async () => {
    const { sampler, finish, liveTimers, reset } = rig();
    const first = sampler.subscribe(() => {});
    sampler.subscribe(() => {});
    await finish();
    first();
    expect(liveTimers()).toHaveLength(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('takes no further samples once closed, however long it stays closed', async () => {
    const { sampler, collect, finish, clock, liveTimers } = rig();
    const unsubscribe = sampler.subscribe(() => {});
    await finish();
    unsubscribe();
    clock.now += 60 * 60 * 1000;
    expect(liveTimers()).toHaveLength(0);
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it('drops a sample that finishes after the view closed', async () => {
    const { sampler, summarize, finish, liveTimers } = rig();
    const listener = vi.fn();
    const unsubscribe = sampler.subscribe(listener);
    unsubscribe();
    await finish();
    expect(summarize).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(liveTimers()).toHaveLength(0);
  });

  it('does not unsubscribe twice', async () => {
    const { sampler, finish, reset } = rig();
    const unsubscribe = sampler.subscribe(() => {});
    await finish();
    unsubscribe();
    unsubscribe();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('keeps the interval when the view is reopened quickly', async () => {
    const { sampler, collect, finish, clock, liveTimers } = rig();
    const unsubscribe = sampler.subscribe(() => {});
    await finish();
    unsubscribe();
    clock.now += 1200;
    sampler.subscribe(() => {});
    expect(collect).toHaveBeenCalledTimes(1);
    expect(liveTimers().map((t) => t.delayMs)).toEqual([MEMORY_SAMPLE_INTERVAL_MS - 1200]);
  });

  it('samples straight away when reopened after the interval', async () => {
    const { sampler, collect, finish, clock } = rig();
    const unsubscribe = sampler.subscribe(() => {});
    await finish();
    unsubscribe();
    clock.now += MEMORY_SAMPLE_INTERVAL_MS + 1;
    sampler.subscribe(() => {});
    expect(collect).toHaveBeenCalledTimes(2);
  });
});
