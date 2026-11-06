import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boundEntries, createPrExplainStore, storeFileFor } from '../src/main/pr-explain-store';
import type { StoredExplanation } from '../src/main/pr-explain-store';
import { makeTmp } from './helpers/git-repo';

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

let dir: string;
let file: string;
let clock: number;

const now = () => (clock += 1);

beforeEach(() => {
  dir = makeTmp('ccm-pr-explain-store-');
  file = path.join(dir, 'store.json');
  clock = 1000;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function entry(n: number, text = 'text'): StoredExplanation {
  return { pr: String(n), path: `src/f${n}.ts`, head: HEAD_A, text, at: n };
}

describe('keying and staleness', () => {
  it('keeps the head the text was written for and is fresh only for that head', () => {
    const store = createPrExplainStore(file, undefined, now);
    store.save('7', 'src/a.ts', HEAD_A, 'about a');
    expect(store.lookup('7', 'src/a.ts', HEAD_A)).toMatchObject({ text: 'about a', head: HEAD_A, stale: false });
    expect(store.lookup('7', 'src/a.ts', HEAD_B)).toMatchObject({ text: 'about a', head: HEAD_A, stale: true });
  });

  it('keys by pull request and by path', () => {
    const store = createPrExplainStore(file, undefined, now);
    store.save('7', 'src/a.ts', HEAD_A, 'seven a');
    store.save('8', 'src/a.ts', HEAD_A, 'eight a');
    store.save('7', 'src/b.ts', HEAD_A, 'seven b');
    expect(store.lookup('7', 'src/a.ts', HEAD_A)?.text).toBe('seven a');
    expect(store.lookup('8', 'src/a.ts', HEAD_A)?.text).toBe('eight a');
    expect(store.lookup('7', 'src/b.ts', HEAD_A)?.text).toBe('seven b');
    expect(store.lookup('9', 'src/a.ts', HEAD_A)).toBeNull();
  });

  it('replaces the text for the same file, even when the head changed', () => {
    const store = createPrExplainStore(file, undefined, now);
    store.save('7', 'src/a.ts', HEAD_A, 'old');
    store.save('7', 'src/a.ts', HEAD_B, 'new');
    expect(store.lookup('7', 'src/a.ts', HEAD_B)).toMatchObject({ text: 'new', head: HEAD_B, stale: false });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).entries).toHaveLength(1);
  });

  it('survives a restart', () => {
    createPrExplainStore(file, undefined, now).save('7', 'src/a.ts', HEAD_A, 'kept');
    expect(createPrExplainStore(file, undefined, now).lookup('7', 'src/a.ts', HEAD_A)?.text).toBe('kept');
  });

  it('starts empty from a missing, corrupt or foreign file', () => {
    const store = createPrExplainStore(file, undefined, now);
    expect(store.lookup('7', 'src/a.ts', HEAD_A)).toBeNull();
    fs.writeFileSync(file, '{ not json');
    expect(store.lookup('7', 'src/a.ts', HEAD_A)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ version: 9, entries: [entry(7)] }));
    expect(store.lookup('7', 'src/f7.ts', HEAD_A)).toBeNull();
  });

  it('ignores stored entries with a malformed shape', () => {
    const good = entry(1);
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [good, { ...entry(2), head: 'zz' }, { ...entry(3), text: '' }, { ...entry(4), pr: 'x' }, 'junk', null] }));
    const store = createPrExplainStore(file, undefined, now);
    expect(store.lookup('1', 'src/f1.ts', HEAD_A)).not.toBeNull();
    expect(store.lookup('2', 'src/f2.ts', HEAD_A)).toBeNull();
    expect(store.lookup('3', 'src/f3.ts', HEAD_A)).toBeNull();
    expect(store.lookup('4', 'src/f4.ts', HEAD_A)).toBeNull();
  });

  it('gives each project its own file inside the app data folder', () => {
    const a = storeFileFor(dir, '/work/one');
    expect(a.startsWith(dir)).toBe(true);
    expect(storeFileFor(dir, '/work/one')).toBe(a);
    expect(storeFileFor(dir, '/work/two')).not.toBe(a);
  });
});

describe('the bounded store', () => {
  it('drops the oldest entries past the entry limit', () => {
    const store = createPrExplainStore(file, { entries: 3, bytes: 1_000_000 }, now);
    for (let n = 1; n <= 5; n += 1) store.save(String(n), `src/f${n}.ts`, HEAD_A, `text ${n}`);
    expect([1, 2, 3, 4, 5].map((n) => store.lookup(String(n), `src/f${n}.ts`, HEAD_A) !== null)).toEqual([false, false, true, true, true]);
  });

  it('drops the oldest entries past the size limit but always keeps the newest', () => {
    const big = 'x'.repeat(600);
    const store = createPrExplainStore(file, { entries: 100, bytes: 1000 }, now);
    store.save('1', 'src/f1.ts', HEAD_A, big);
    store.save('2', 'src/f2.ts', HEAD_A, big);
    expect(store.lookup('1', 'src/f1.ts', HEAD_A)).toBeNull();
    expect(store.lookup('2', 'src/f2.ts', HEAD_A)).not.toBeNull();
    const huge = createPrExplainStore(path.join(dir, 'huge.json'), { entries: 100, bytes: 10 }, now);
    huge.save('3', 'src/f3.ts', HEAD_A, big);
    expect(huge.lookup('3', 'src/f3.ts', HEAD_A)).not.toBeNull();
  });

  it('keeps the newest of equal timestamps', () => {
    const kept = boundEntries([entry(1), { ...entry(2), at: 1 }, { ...entry(3), at: 1 }], { entries: 1, bytes: 1_000_000 });
    expect(kept.map((e) => e.pr)).toEqual(['3']);
  });
});
