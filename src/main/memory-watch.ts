import { MEMORY_UPDATE_CHANNEL, type MemorySnapshot, type MemoryViewState } from '../shared/memory';

export interface MemoryViewer {
  isDestroyed(): boolean;
  send(channel: string, payload: MemorySnapshot): void;
  on(event: string, listener: () => void): unknown;
}

export interface MemorySource {
  subscribe(listener: (snapshot: MemorySnapshot) => void): () => void;
  latest(): MemorySnapshot | null;
}

const VIEWER_GONE_EVENTS = ['destroyed', 'did-start-loading', 'render-process-gone'];

export function createMemoryWatch({ supported, source }: { supported: boolean; source: MemorySource }) {
  const watching = new Map<MemoryViewer, () => void>();
  const wired = new WeakSet<MemoryViewer>();

  function unwatch(viewer: MemoryViewer) {
    watching.get(viewer)?.();
    watching.delete(viewer);
  }

  function wire(viewer: MemoryViewer) {
    if (wired.has(viewer)) return;
    wired.add(viewer);
    for (const event of VIEWER_GONE_EVENTS) viewer.on(event, () => unwatch(viewer));
  }

  function watch(viewer: MemoryViewer) {
    if (watching.has(viewer) || viewer.isDestroyed()) return;
    wire(viewer);
    watching.set(
      viewer,
      source.subscribe((snapshot) => {
        if (viewer.isDestroyed()) unwatch(viewer);
        else viewer.send(MEMORY_UPDATE_CHANNEL, snapshot);
      }),
    );
  }

  return {
    handle(viewer: MemoryViewer, on: unknown): MemoryViewState {
      if (!supported) return { supported: false };
      if (on === true) watch(viewer);
      else if (on === false) unwatch(viewer);
      return { supported: true, snapshot: source.latest() };
    },
    watcherCount: () => watching.size,
  };
}
