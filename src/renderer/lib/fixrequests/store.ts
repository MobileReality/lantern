import { hasRange, normalizeRange, parseItems } from './model';
import type { FixDraft, FixItem, FixPatch } from './model';

interface FixBackend {
  load(): FixItem[];
  save(items: FixItem[]): void;
}

interface FixStore {
  items(): FixItem[];
  add(draft: FixDraft): FixItem;
  update(id: string, patch: FixPatch): FixItem | null;
  remove(id: string): boolean;
  clear(): void;
  onChange(listener: () => void): () => void;
}

const STORAGE_KEY = 'lantern.fixRequests';

let idSeq = 0;

function newId() {
  idSeq += 1;
  return `fx-${Date.now().toString(36)}-${idSeq}`;
}

function withNormalRange(item: FixItem): FixItem {
  if (!hasRange(item)) {
    const { start: _start, end: _end, code: _code, ...whole } = item;
    return whole;
  }
  return { ...item, ...normalizeRange(item.start, item.end) };
}

function createFixStore(backend: FixBackend, makeId: () => string = newId): FixStore {
  let list = backend.load();
  const listeners = new Set<() => void>();

  function commit(next: FixItem[]) {
    list = next;
    backend.save(list);
    for (const listener of listeners) listener();
  }

  return {
    items: () => list.slice(),
    add(draft) {
      const item = withNormalRange({ ...draft, id: makeId() });
      commit([...list, item]);
      return item;
    },
    update(id, patch) {
      const at = list.findIndex((item) => item.id === id);
      if (at < 0) return null;
      const item = withNormalRange({ ...list[at], ...patch, id });
      commit(list.map((each, index) => (index === at ? item : each)));
      return item;
    },
    remove(id) {
      if (!list.some((item) => item.id === id)) return false;
      commit(list.filter((item) => item.id !== id));
      return true;
    },
    clear() {
      if (!list.length) return;
      commit([]);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

function storageKey(project: string | undefined, pr: string) {
  return `${STORAGE_KEY}|${project ?? ''}|${pr}`;
}

function browserFixBackend(project: string | undefined, pr: string): FixBackend {
  const key = storageKey(project, pr);
  return {
    load() {
      try {
        return parseItems(localStorage.getItem(key));
      } catch {
        return [];
      }
    },
    save(items) {
      try {
        if (items.length) localStorage.setItem(key, JSON.stringify(items));
        else localStorage.removeItem(key);
      } catch {
        return;
      }
    },
  };
}

function memoryFixBackend(initial: FixItem[] = []): FixBackend & { saved: FixItem[] } {
  const backend = {
    saved: initial,
    load: () => backend.saved.slice(),
    save(items: FixItem[]) {
      backend.saved = items;
    },
  };
  return backend;
}

export { browserFixBackend, createFixStore, memoryFixBackend, storageKey };
export type { FixBackend, FixStore };
