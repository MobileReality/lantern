import { MEMORY_SAMPLE_INTERVAL_MS, type MemorySnapshot } from '../shared/memory';
import type { MemorySample } from './memory-collect';

export interface SamplerDeps {
  collect: () => Promise<MemorySample>;
  summarize: (sample: MemorySample) => MemorySnapshot;
  reset: () => void;
  now: () => number;
  schedule: (run: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
  onError?: (error: unknown) => void;
}

export type SnapshotListener = (snapshot: MemorySnapshot) => void;

export function createSampler(deps: SamplerDeps) {
  const listeners = new Set<SnapshotListener>();
  let timer: unknown = null;
  let inFlight = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let latest: MemorySnapshot | null = null;

  function clearTimer() {
    if (timer !== null) deps.cancel(timer);
    timer = null;
  }

  function scheduleNext(delayMs: number) {
    clearTimer();
    timer = deps.schedule(tick, delayMs);
  }

  function tick() {
    timer = null;
    if (listeners.size) void run();
  }

  async function run() {
    if (inFlight) return;
    inFlight = true;
    lastStart = deps.now();
    try {
      const sample = await deps.collect();
      if (listeners.size) {
        const snapshot = deps.summarize(sample);
        latest = snapshot;
        for (const listener of [...listeners]) listener(snapshot);
      }
    } catch (error) {
      deps.onError?.(error);
    } finally {
      inFlight = false;
      if (listeners.size) scheduleNext(MEMORY_SAMPLE_INTERVAL_MS);
    }
  }

  function begin() {
    const wait = Math.max(0, lastStart + MEMORY_SAMPLE_INTERVAL_MS - deps.now());
    if (wait > 0 || inFlight) scheduleNext(wait);
    else void run();
  }

  function end() {
    clearTimer();
    latest = null;
    deps.reset();
  }

  return {
    subscribe(listener: SnapshotListener) {
      listeners.add(listener);
      if (listeners.size === 1) begin();
      else if (latest) listener(latest);
      return () => {
        if (!listeners.delete(listener) || listeners.size) return;
        end();
      };
    },
    latest: () => latest,
    isRunning: () => listeners.size > 0,
  };
}
