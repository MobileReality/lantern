import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SnapshotRoots, cleanupOrphanSnapshotRoots } from '../src/main/lsp/snapshot-root';
import { commitFile, git, makeWorld } from './helpers/git-repo';
import type { World } from './helpers/git-repo';

let world: World | undefined;
let snapshots: SnapshotRoots | undefined;

afterEach(async () => {
  await snapshots?.dispose();
  if (world) fs.rmSync(world.dir, { recursive: true, force: true });
});

describe('historical semantic roots', () => {
  it('removes only snapshot roots whose owning process is gone', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-cleanup-test-'));
    const dead = `lantern-lsp-p111-dead`;
    const live = `lantern-lsp-p222-live`;
    const legacy = 'lantern-lsp-legacy';
    const unrelated = 'other-p333';
    for (const name of [dead, live, legacy, unrelated]) fs.mkdirSync(path.join(temp, name));
    fs.symlinkSync(path.join(temp, unrelated), path.join(temp, 'lantern-lsp-p111-link'));
    await cleanupOrphanSnapshotRoots(temp, ((pid: number) => {
      if (pid === 111) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      if (pid === 222) throw Object.assign(new Error('hidden'), { code: 'EPERM' });
      return true;
    }) as typeof process.kill);
    expect(fs.existsSync(path.join(temp, dead))).toBe(false);
    expect(fs.existsSync(path.join(temp, live))).toBe(true);
    expect(fs.existsSync(path.join(temp, legacy))).toBe(true);
    expect(fs.existsSync(path.join(temp, unrelated))).toBe(true);
    expect(fs.lstatSync(path.join(temp, 'lantern-lsp-p111-link')).isSymbolicLink()).toBe(true);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  it('materializes exact blobs despite export-ignore and export-subst attributes', async () => {
    world = makeWorld();
    const source = 'export const marker = "$Format:%H$";\n';
    commitFile(world.project, '.gitattributes', 'src/hidden.ts export-ignore export-subst\n', 'attributes');
    commitFile(world.project, 'src/hidden.ts', source, 'source');
    const revision = git(world.project, ['rev-parse', 'HEAD']);
    snapshots = new SnapshotRoots();
    const snapshot = await snapshots.acquire(world.project, revision);
    expect(fs.readFileSync(path.join(snapshot.root, 'src/hidden.ts'), 'utf8')).toBe(source);
    await snapshot.release();
  });

  it('skips unrelated symlinks instead of materializing their targets', async () => {
    world = makeWorld();
    fs.symlinkSync('/etc/passwd', path.join(world.project, 'outside'));
    git(world.project, ['add', 'outside']);
    git(world.project, ['commit', '-q', '-m', 'link']);
    const revision = git(world.project, ['rev-parse', 'HEAD']);
    snapshots = new SnapshotRoots();
    const snapshot = await snapshots.acquire(world.project, revision);
    expect(fs.existsSync(path.join(snapshot.root, 'outside'))).toBe(false);
    await snapshot.release();
  });

  it('keeps a shared snapshot until every request lease is released', async () => {
    world = makeWorld();
    const revision = git(world.project, ['rev-parse', 'HEAD']);
    snapshots = new SnapshotRoots();
    const first = await snapshots.acquire(world.project, revision);
    const second = await snapshots.acquire(world.project, revision);
    expect(second.root).toBe(first.root);

    await first.release();
    expect(fs.existsSync(second.root)).toBe(true);
    await second.release();
    expect(fs.existsSync(second.root)).toBe(false);
  });

  it('filters unrelated binary blobs before applying snapshot limits', async () => {
    world = makeWorld();
    fs.writeFileSync(path.join(world.project, 'large.bin'), Buffer.alloc(65 * 1024 * 1024));
    commitFile(world.project, 'src/kept.ts', 'export const kept = true;\n', 'source');
    git(world.project, ['add', 'large.bin']);
    git(world.project, ['commit', '-q', '-m', 'binary']);
    const head = git(world.project, ['rev-parse', 'HEAD']);
    snapshots = new SnapshotRoots();

    const snapshot = await snapshots.acquire(world.project, head);

    expect(fs.readFileSync(path.join(snapshot.root, 'src/kept.ts'), 'utf8')).toContain('kept');
    expect(fs.existsSync(path.join(snapshot.root, 'large.bin'))).toBe(false);
    await snapshot.release();
    expect(fs.existsSync(snapshot.root)).toBe(false);
  });
});
