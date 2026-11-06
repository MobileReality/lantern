import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lanternStamp } from '../src/main/lantern-stamp';

let root: string;
const write = (rel: string, text: string, mtime?: number) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  if (mtime) fs.utimesSync(abs, mtime, mtime);
};

describe('lanternStamp', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-stamp-'));
    write('.lantern/map/src.lantern', 'lantern 1', 1000);
    write('.lantern/prs/3.pr', 'pr', 1000);
    write('.git/HEAD', 'ref: refs/heads/main', 1000);
    write('.git/refs/remotes/origin/main', 'abc', 1000);
    write('src/app.ts', 'code', 1000);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('is the same while nothing changed', async () => {
    expect(await lanternStamp(root)).toBe(await lanternStamp(root));
  });

  it('changes when a map file is edited, added or removed', async () => {
    const before = await lanternStamp(root);
    write('.lantern/map/src.lantern', 'lantern 1 changed', 2000);
    const edited = await lanternStamp(root);
    expect(edited).not.toBe(before);
    write('.lantern/lang/en/src.json', '{}');
    const added = await lanternStamp(root);
    expect(added).not.toBe(edited);
    fs.rmSync(path.join(root, '.lantern/lang'), { recursive: true });
    expect(await lanternStamp(root)).not.toBe(added);
  });

  it('changes when a pull request record or a remote ref moves', async () => {
    const before = await lanternStamp(root);
    write('.lantern/prs/4.pr', 'pr');
    const record = await lanternStamp(root);
    expect(record).not.toBe(before);
    write('.git/refs/remotes/origin/feat-x', 'def');
    expect(await lanternStamp(root)).not.toBe(record);
  });

  it('ignores source files', async () => {
    const before = await lanternStamp(root);
    write('src/app.ts', 'edited code', 5000);
    expect(await lanternStamp(root)).toBe(before);
  });

  it('works for a project with no map and no git', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-stamp-bare-'));
    try {
      expect(await lanternStamp(bare)).toBe(await lanternStamp(bare));
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
