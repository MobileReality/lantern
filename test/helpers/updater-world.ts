import { vi } from 'vitest';
import type { ActivityState } from '../../src/main/updater/guard';
import type { HttpFetch } from '../../src/main/updater/feed';
import type { NativeUpdater } from '../../src/main/updater/native';
import { type UpdaterDeps, createUpdater } from '../../src/main/updater/service';
import type { UpdateNotice } from '../../src/shared/updates';

export const IDLE: ActivityState = { sessions: [], agentRunning: false, processes: { terminals: 0, running: 0 } };
export const BUSY: ActivityState = { sessions: [{ state: 'running' }], agentRunning: false, processes: { terminals: 1, running: 0 } };

export const FEED_NEWER = JSON.stringify({ name: 'v0.3.0', url: 'https://github.com/MobileReality/lantern/releases/download/v0.3.0/Lantern-mac.zip' });
export const LATEST_NEWER = JSON.stringify({ tag_name: 'v0.4.0' });

export interface Timer {
  ms: number;
  run: () => void;
  repeating: boolean;
  stopped: boolean;
}

export function manualTimers() {
  const timers: Timer[] = [];
  return {
    timers,
    api: {
      after: (ms: number, run: () => void) => {
        const timer: Timer = { ms, run, repeating: false, stopped: false };
        timers.push(timer);
        return () => {
          timer.stopped = true;
        };
      },
      every: (ms: number, run: () => void) => {
        const timer: Timer = { ms, run, repeating: true, stopped: false };
        timers.push(timer);
        return () => {
          timer.stopped = true;
        };
      },
    },
    running: () => timers.filter((timer) => !timer.stopped),
  };
}

export function fakeNative() {
  const handlers: { downloaded?: (version: string) => void; notAvailable?: () => void; error?: (message: string) => void } = {};
  const native: NativeUpdater & { setFeedUrl: ReturnType<typeof vi.fn>; checkForUpdates: ReturnType<typeof vi.fn>; quitAndInstall: ReturnType<typeof vi.fn> } = {
    setFeedUrl: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    onDownloaded: (listener) => {
      handlers.downloaded = listener;
    },
    onNotAvailable: (listener) => {
      handlers.notAvailable = listener;
    },
    onError: (listener) => {
      handlers.error = listener;
    },
  };
  return { native, handlers };
}

export interface WorldOptions extends Partial<UpdaterDeps> {
  status?: number;
  body?: string;
  activity?: ActivityState | (() => Promise<ActivityState>);
}

export function updaterWorld(options: WorldOptions = {}) {
  const { status = 204, body = '', activity = IDLE, ...rest } = options;
  const requests: string[] = [];
  const logs: { severity: string; message: string; detail?: string }[] = [];
  const published: (UpdateNotice | null)[] = [];
  const clock = manualTimers();
  const { native, handlers } = fakeNative();
  const state = { enabled: true, status, body, activity };
  const fetchUrl: HttpFetch = async (url) => {
    requests.push(url);
    return { status: state.status, text: async () => state.body };
  };
  const confirmRestart = vi.fn(async () => true);
  const openRelease = vi.fn();
  const updater = createUpdater({
    packaged: true,
    platform: 'darwin',
    arch: 'arm64',
    version: '0.2.2',
    enabled: () => state.enabled,
    fetch: fetchUrl,
    native,
    activity: async () => (typeof state.activity === 'function' ? state.activity() : state.activity),
    log: (severity, message, detail) => logs.push({ severity, message, detail }),
    publish: (notice) => published.push(notice),
    confirmRestart,
    openRelease,
    timers: clock.api,
    ...rest,
  });
  return { updater, state, requests, logs, published, clock, native, handlers, confirmRestart, openRelease };
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
