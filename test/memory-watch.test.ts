import { describe, expect, it, vi } from 'vitest';
import { MEMORY_UPDATE_CHANNEL, type MemorySnapshot } from '../src/shared/memory';
import { createMemoryWatch, type MemorySource, type MemoryViewer } from '../src/main/memory-watch';
import { createMemoryService, MEMORY_SUPPORTED_PLATFORMS } from '../src/main/memory-service';

const snapshot = { takenAt: 5, totalBytes: 1 } as MemorySnapshot;

function fakeSource() {
  const listeners = new Set<(s: MemorySnapshot) => void>();
  const unsubscribed = vi.fn();
  const source: MemorySource = {
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribed();
      };
    }),
    latest: () => null,
  };
  return { source, listeners, unsubscribed, emit: (s: MemorySnapshot) => [...listeners].forEach((l) => { l(s); }) };
}

function fakeViewer() {
  const handlers = new Map<string, () => void>();
  const state = { destroyed: false };
  const viewer: MemoryViewer & { sent: { channel: string; payload: unknown }[]; trigger: (event: string) => void } = {
    sent: [],
    isDestroyed: () => state.destroyed,
    send(channel, payload) {
      this.sent.push({ channel, payload });
    },
    on(event, listener) {
      handlers.set(event, listener);
    },
    trigger: (event) => handlers.get(event)?.(),
  };
  return { viewer, state };
}

describe('the memory:watch handler', () => {
  it('answers not supported and never starts sampling where the platform is unsupported', () => {
    const { source } = fakeSource();
    const watch = createMemoryWatch({ supported: false, source });
    const { viewer } = fakeViewer();
    expect(watch.handle(viewer, true)).toEqual({ supported: false });
    expect(source.subscribe).not.toHaveBeenCalled();
  });

  it('starts sampling when a view opens and pushes every reading to it', () => {
    const { source, emit } = fakeSource();
    const watch = createMemoryWatch({ supported: true, source });
    const { viewer } = fakeViewer();
    expect(watch.handle(viewer, true)).toEqual({ supported: true, snapshot: null });
    emit(snapshot);
    expect(viewer.sent).toEqual([{ channel: MEMORY_UPDATE_CHANNEL, payload: snapshot }]);
  });

  it('stops sampling when the view closes', () => {
    const { source, unsubscribed, emit } = fakeSource();
    const watch = createMemoryWatch({ supported: true, source });
    const { viewer } = fakeViewer();
    watch.handle(viewer, true);
    watch.handle(viewer, false);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    emit(snapshot);
    expect(viewer.sent).toEqual([]);
    expect(watch.watcherCount()).toBe(0);
  });

  it('subscribes a window once however often it asks', () => {
    const { source } = fakeSource();
    const watch = createMemoryWatch({ supported: true, source });
    const { viewer } = fakeViewer();
    watch.handle(viewer, true);
    watch.handle(viewer, true);
    expect(source.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each(['destroyed', 'did-start-loading', 'render-process-gone'])('stops sampling when the window reports %s without closing the view', (event) => {
    const { source, unsubscribed } = fakeSource();
    const watch = createMemoryWatch({ supported: true, source });
    const { viewer } = fakeViewer();
    watch.handle(viewer, true);
    viewer.trigger(event);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    expect(watch.watcherCount()).toBe(0);
  });

  it('stops sampling for a window destroyed between two readings', () => {
    const { source, unsubscribed, emit } = fakeSource();
    const watch = createMemoryWatch({ supported: true, source });
    const { viewer, state } = fakeViewer();
    watch.handle(viewer, true);
    state.destroyed = true;
    emit(snapshot);
    expect(viewer.sent).toEqual([]);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });

  it('ignores a destroyed window asking to watch', () => {
    const { source } = fakeSource();
    const watch = createMemoryWatch({ supported: true, source });
    const { viewer, state } = fakeViewer();
    state.destroyed = true;
    watch.handle(viewer, true);
    expect(source.subscribe).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'yes', 1, {}, [true]])('ignores a malformed argument: %j', (arg) => {
    const { source } = fakeSource();
    const watch = createMemoryWatch({ supported: true, source });
    const { viewer } = fakeViewer();
    expect(watch.handle(viewer, arg)).toEqual({ supported: true, snapshot: null });
    expect(source.subscribe).not.toHaveBeenCalled();
  });

  it('keeps one window from stopping another window', () => {
    const { source, unsubscribed } = fakeSource();
    const watch = createMemoryWatch({ supported: true, source });
    const first = fakeViewer().viewer;
    const second = fakeViewer().viewer;
    watch.handle(first, true);
    watch.handle(second, true);
    watch.handle(first, false);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    expect(watch.watcherCount()).toBe(1);
  });
});

describe('the memory service on this platform list', () => {
  it('is macOS only for now', () => {
    expect(MEMORY_SUPPORTED_PLATFORMS).toEqual(['darwin']);
  });

  it.each(['win32', 'linux'] as const)('answers not supported on %s without sampling', (platform) => {
    const service = createMemoryService({ platform, rootPid: process.pid, projectPaths: () => [] });
    const { viewer } = fakeViewer();
    expect(service.handle(viewer, true)).toEqual({ supported: false });
    expect(service.watcherCount()).toBe(0);
  });
});
