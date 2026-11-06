import type { PrFileDiff } from '@main/lantern-prdiff';
import type { PrSides } from '@main/lantern-pr-revisions';

type ReadDiff = (pr: string, path: string, sides?: PrSides) => Promise<PrFileDiff>;

interface DiffCache {
  read: ReadDiff;
  preload(pr: string, order: string[], current: string): void;
  stop(): void;
  size(): number;
}

const PRELOAD_CONCURRENCY = 3;

function neighbourOrder(order: string[], current: string): string[] {
  const at = order.indexOf(current);
  if (at < 0) return [current, ...order];
  const out = [current];
  for (let step = 1; out.length < order.length; step++) {
    if (at + step < order.length) out.push(order[at + step]);
    if (at - step >= 0) out.push(order[at - step]);
  }
  return out;
}

function createDiffCache(read: ReadDiff, versionOf: (pr: string) => string, concurrency = PRELOAD_CONCURRENCY): DiffCache {
  const entries = new Map<string, Promise<PrFileDiff>>();
  const versions = new Map<string, string>();
  const chosen = new Set<string>();
  let queue: Array<{ pr: string; path: string }> = [];
  let running = 0;
  let epoch = 0;

  function keyOf(pr: string, path: string) {
    return `${pr}\n${versionOf(pr)}\n${path}`;
  }

  function dropStale(pr: string) {
    const version = versionOf(pr);
    if (versions.get(pr) === version) return;
    versions.set(pr, version);
    const prefix = `${pr}\n`;
    const keep = `${pr}\n${version}\n`;
    for (const key of [...entries.keys()]) if (key.startsWith(prefix) && !key.startsWith(keep)) entries.delete(key);
  }

  function readChosen(pr: string, path: string, sides?: PrSides): Promise<PrFileDiff> {
    if (!sides) {
      chosen.delete(pr);
      return fetch(pr, path);
    }
    chosen.add(pr);
    epoch++;
    queue = [];
    return read(pr, path, sides);
  }

  function fetch(pr: string, path: string): Promise<PrFileDiff> {
    dropStale(pr);
    const key = keyOf(pr, path);
    const hit = entries.get(key);
    if (hit) return hit;
    const pending = read(pr, path).then(
      (res) => {
        if (!res.ok && entries.get(key) === pending) entries.delete(key);
        return res;
      },
      (err) => {
        if (entries.get(key) === pending) entries.delete(key);
        throw err;
      },
    );
    entries.set(key, pending);
    return pending;
  }

  function pump(mine: number) {
    while (mine === epoch && running < concurrency && queue.length) {
      const next = queue.shift()!;
      if (entries.has(keyOf(next.pr, next.path))) continue;
      running++;
      fetch(next.pr, next.path).then(() => {}, () => {}).then(() => {
        running--;
        pump(epoch);
      });
    }
  }

  return {
    read: readChosen,
    preload(pr, order, current) {
      dropStale(pr);
      const mine = ++epoch;
      if (chosen.has(pr)) {
        queue = [];
        return;
      }
      queue = neighbourOrder(order, current).filter((path) => !entries.has(keyOf(pr, path))).map((path) => ({ pr, path }));
      pump(mine);
    },
    stop() {
      epoch++;
      queue = [];
    },
    size: () => entries.size,
  };
}

export { createDiffCache, neighbourOrder, PRELOAD_CONCURRENCY };
export type { DiffCache };
