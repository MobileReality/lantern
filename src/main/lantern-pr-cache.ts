import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mapInBatches } from './lantern-batch';
import { git } from './lantern-git';
import { PR_DIR } from './lantern-pr-parse';

const REF_FORMAT = '%(refname)%09%(objectname)%09%(symref)';

async function gitRefState(root: string) {
  const [refs, head, origin] = await Promise.all([
    git(root, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/remotes', 'refs/heads']),
    git(root, ['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD']),
    git(root, ['remote', 'get-url', 'origin']),
  ]);
  return [refs.ok ? refs.stdout : 'no-refs', head.ok ? head.stdout : 'no-head', origin.ok ? origin.stdout : 'no-origin'].join('\n--\n');
}

async function treeRecordState(root: string) {
  let names: string[];
  try {
    names = (await fs.promises.readdir(path.join(root, PR_DIR))).filter((n) => n.endsWith('.pr')).sort();
  } catch {
    return 'no-records';
  }
  const stats = await mapInBatches(names, async (name) => {
    try {
      const s = await fs.promises.stat(path.join(root, PR_DIR, name), { bigint: true });
      return `${name}:${s.size}:${s.mtimeNs}:${s.ino}`;
    } catch {
      return `${name}:gone`;
    }
  });
  return stats.join('\n');
}

async function refState(root: string): Promise<string> {
  const [refs, records] = await Promise.all([gitRefState(root), treeRecordState(root)]);
  return createHash('sha1').update(refs).update('\0').update(records).digest('hex');
}

interface Slot<T> {
  key: string;
  value: T;
}

interface Flight<T> {
  key: string;
  promise: Promise<T>;
}

interface Revalidated<T> {
  value: T;
  key: string;
  reloaded: boolean;
}

function createRefCache<T>(stateOf: (root: string) => Promise<string> = refState) {
  const slots = new Map<string, Slot<T>>();
  const flights = new Map<string, Flight<T>>();

  async function get(root: string, load: () => Promise<T>): Promise<Revalidated<T>> {
    const key = await stateOf(root);
    const slot = slots.get(root);
    if (slot?.key === key) return { value: slot.value, key, reloaded: false };
    const running = flights.get(root);
    if (running?.key === key) return { value: await running.promise, key, reloaded: true };
    const flight: Flight<T> = { key, promise: load() };
    flights.set(root, flight);
    try {
      const value = await flight.promise;
      if (flights.get(root) === flight) slots.set(root, { key, value });
      return { value, key, reloaded: true };
    } finally {
      if (flights.get(root) === flight) flights.delete(root);
    }
  }

  return {
    get,
    peek: (root: string) => slots.get(root)?.value,
    drop(root: string) {
      slots.delete(root);
      flights.delete(root);
    },
    clear() {
      slots.clear();
      flights.clear();
    },
  };
}

type RefCache<T> = ReturnType<typeof createRefCache<T>>;

export { createRefCache, refState };
export type { RefCache, Revalidated };
