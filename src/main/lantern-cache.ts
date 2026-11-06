import fs from 'node:fs';

interface Entry<V> {
  mtimeMs: number;
  size: number;
  value: V;
}

class StampedCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  reads = 0;

  get size() {
    return this.entries.size;
  }

  pass(scope: string): CachePass<V> {
    return new CachePass(this, scope);
  }

  async resolve(abs: string, parse: (text: string) => V): Promise<V> {
    const { mtimeMs, size } = await fs.promises.stat(abs);
    const cached = this.entries.get(abs);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.value;
    this.reads++;
    const value = parse(await fs.promises.readFile(abs, 'utf8'));
    this.entries.set(abs, { mtimeMs, size, value });
    return value;
  }

  drop(scope: string, keep: Set<string>) {
    for (const key of this.entries.keys()) if (key.startsWith(scope) && !keep.has(key)) this.entries.delete(key);
  }
}

class CachePass<V> {
  private readonly touched = new Set<string>();

  constructor(
    private readonly cache: StampedCache<V>,
    private readonly scope: string,
  ) {}

  resolve(abs: string, parse: (text: string) => V): Promise<V> {
    this.touched.add(abs);
    return this.cache.resolve(abs, parse);
  }

  finish() {
    this.cache.drop(this.scope, this.touched);
  }
}

export { StampedCache };
export type { CachePass };
