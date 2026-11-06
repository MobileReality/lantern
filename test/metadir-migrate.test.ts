import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_META_DIR, legacyDirOf, migrateLegacyDir } from '../src/main/metadir-migrate';

const CAN_DENY_READS = process.platform !== 'win32' && process.getuid?.() !== 0;
const OLD_TIME = 1_600_000_000;

let project: string;

const legacy = () => path.join(project, LEGACY_META_DIR);
const target = () => path.join(project, '.lantern', '.project');
const staging = () => `${target()}.migrating`;

function put(root: string, rel: string, text: string, mtimeSeconds?: number) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (mtimeSeconds) fs.utimesSync(file, mtimeSeconds, mtimeSeconds);
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const tree = (root: string, rel = ''): string[] =>
  fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [`${path.posix.join(rel, e.name)}/`, ...tree(root, path.posix.join(rel, e.name))] : [path.posix.join(rel, e.name)])).sort();

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-migrate-'));
});

afterEach(() => {
  for (const dir of [legacy(), target()]) {
    try {
      for (const entry of tree(dir)) fs.chmodSync(path.join(dir, entry), entry.endsWith('/') ? 0o755 : 0o644);
    } catch {}
  }
  fs.rmSync(project, { recursive: true, force: true });
});

describe('migrateLegacyDir', () => {
  it('moves an old folder into .lantern/.project and removes the old folder', () => {
    put(legacy(), 'review.json', '{"a":1}\n', OLD_TIME);
    put(legacy(), 'project.json', '{"name":"x"}\n');
    put(legacy(), 'explains/one.md', 'ONE', OLD_TIME);
    put(legacy(), 'explains/deep/two.md', 'TWO');

    expect(migrateLegacyDir(project, target())).toEqual({ status: 'moved' });

    expect(tree(target())).toEqual(['explains/', 'explains/deep/', 'explains/deep/two.md', 'explains/one.md', 'project.json', 'review.json']);
    expect(read(target(), 'review.json')).toBe('{"a":1}\n');
    expect(read(target(), 'explains/deep/two.md')).toBe('TWO');
    expect(fs.existsSync(legacy())).toBe(false);
    expect(fs.existsSync(staging())).toBe(false);
  });

  it('keeps file times, so explainers stay ordered newest first', () => {
    put(legacy(), 'explains/one.md', 'ONE', OLD_TIME);
    migrateLegacyDir(project, target());
    expect(Math.round(fs.statSync(path.join(target(), 'explains', 'one.md')).mtimeMs / 1000)).toBe(OLD_TIME);
  });

  it('creates .lantern only for the move, and nothing else beside the map-less project', () => {
    put(legacy(), 'review.json', '{}\n');
    migrateLegacyDir(project, target());
    expect(fs.readdirSync(path.join(project, '.lantern'))).toEqual(['.project']);
    expect(fs.existsSync(path.join(project, '.lantern', 'map'))).toBe(false);
  });

  it('does nothing and creates nothing when there is no old folder', () => {
    expect(migrateLegacyDir(project, target())).toEqual({ status: 'none' });
    expect(fs.readdirSync(project)).toEqual([]);
  });

  it('leaves a project that only has the new folder untouched', () => {
    put(target(), 'review.json', 'NEW');
    expect(migrateLegacyDir(project, target())).toEqual({ status: 'none' });
    expect(tree(target())).toEqual(['review.json']);
    expect(read(target(), 'review.json')).toBe('NEW');
  });

  it('is idempotent', () => {
    put(legacy(), 'review.json', 'OLD');
    expect(migrateLegacyDir(project, target()).status).toBe('moved');
    expect(migrateLegacyDir(project, target())).toEqual({ status: 'none' });
    expect(read(target(), 'review.json')).toBe('OLD');
  });

  it('replaces a staging folder left behind by an interrupted run', () => {
    put(staging(), 'junk.txt', 'half a copy');
    put(legacy(), 'review.json', 'OLD');
    expect(migrateLegacyDir(project, target()).status).toBe('moved');
    expect(tree(target())).toEqual(['review.json']);
    expect(fs.existsSync(staging())).toBe(false);
  });

  describe('when both folders exist', () => {
    it('never overwrites a file that is already in the new folder', () => {
      put(target(), 'review.json', 'NEW');
      put(legacy(), 'review.json', 'OLD');

      const outcome = migrateLegacyDir(project, target());

      expect(read(target(), 'review.json')).toBe('NEW');
      expect(outcome).toEqual({ status: 'merged', kept: ['review.json'] });
      expect(read(legacy(), 'review.json')).toBe('OLD');
    });

    it('brings over what the new folder lacks and drops old copies that are already there', () => {
      put(target(), 'review.json', 'SAME');
      put(target(), 'explains/kept.md', 'NEW KEPT');
      put(legacy(), 'review.json', 'SAME');
      put(legacy(), 'project.json', 'ONLY OLD');
      put(legacy(), 'explains/kept.md', 'OLD KEPT');
      put(legacy(), 'explains/only-old.md', 'ONLY OLD MD', OLD_TIME);

      const outcome = migrateLegacyDir(project, target());

      expect(outcome).toEqual({ status: 'merged', kept: ['explains/kept.md'] });
      expect(read(target(), 'project.json')).toBe('ONLY OLD');
      expect(read(target(), 'explains/only-old.md')).toBe('ONLY OLD MD');
      expect(Math.round(fs.statSync(path.join(target(), 'explains', 'only-old.md')).mtimeMs / 1000)).toBe(OLD_TIME);
      expect(read(target(), 'explains/kept.md')).toBe('NEW KEPT');
      expect(tree(legacy())).toEqual(['explains/', 'explains/kept.md']);
      expect(read(legacy(), 'explains/kept.md')).toBe('OLD KEPT');
    });

    it('removes the old folder once everything in it is in the new one', () => {
      put(target(), 'review.json', 'SAME');
      put(legacy(), 'review.json', 'SAME');
      put(legacy(), 'explains/a.md', 'A');
      expect(migrateLegacyDir(project, target())).toEqual({ status: 'merged', kept: [] });
      expect(fs.existsSync(legacy())).toBe(false);
      expect(tree(target())).toEqual(['explains/', 'explains/a.md', 'review.json']);
    });

    it('keeps an old file that sits where the new folder has a directory', () => {
      put(target(), 'explains/inner.md', 'NEW');
      put(legacy(), 'explains', 'a file where a directory is');
      expect(migrateLegacyDir(project, target())).toEqual({ status: 'merged', kept: ['explains'] });
      expect(read(target(), 'explains/inner.md')).toBe('NEW');
      expect(read(legacy(), 'explains')).toBe('a file where a directory is');
    });
  });

  describe.skipIf(!CAN_DENY_READS)('when copying fails part way', () => {
    it('leaves the old folder whole, leaves no new folder or staging folder, and says what happened', () => {
      put(legacy(), 'a-first.json', 'A');
      put(legacy(), 'explains/b-second.md', 'B');
      put(legacy(), 'z-unreadable.json', 'Z');
      fs.chmodSync(path.join(legacy(), 'z-unreadable.json'), 0o000);

      const outcome = migrateLegacyDir(project, target());

      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') return;
      expect(outcome.useLegacy).toBe(true);
      expect(outcome.message).toContain(`${LEGACY_META_DIR}/`);
      expect(outcome.message).toContain('.lantern/.project/');
      expect(outcome.message).toContain('Nothing was deleted');
      expect(tree(legacy())).toEqual(['a-first.json', 'explains/', 'explains/b-second.md', 'z-unreadable.json']);
      expect(read(legacy(), 'a-first.json')).toBe('A');
      expect(fs.existsSync(target())).toBe(false);
      expect(fs.existsSync(staging())).toBe(false);
    });

    it('moves the data on the next attempt once the cause is gone', () => {
      put(legacy(), 'a-first.json', 'A');
      put(legacy(), 'z-unreadable.json', 'Z');
      fs.chmodSync(path.join(legacy(), 'z-unreadable.json'), 0o000);
      expect(migrateLegacyDir(project, target()).status).toBe('failed');

      fs.chmodSync(path.join(legacy(), 'z-unreadable.json'), 0o644);

      expect(migrateLegacyDir(project, target())).toEqual({ status: 'moved' });
      expect(tree(target())).toEqual(['a-first.json', 'z-unreadable.json']);
      expect(fs.existsSync(legacy())).toBe(false);
    });

    it('keeps what a merge did not reach in the old folder and reports it', () => {
      put(target(), 'existing.json', 'NEW');
      put(legacy(), 'a-first.json', 'A');
      put(legacy(), 'z-unreadable.json', 'Z');
      fs.chmodSync(path.join(legacy(), 'z-unreadable.json'), 0o000);

      const outcome = migrateLegacyDir(project, target());

      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') return;
      expect(outcome.useLegacy).toBe(false);
      expect(read(target(), 'existing.json')).toBe('NEW');
      expect(fs.existsSync(path.join(legacy(), 'z-unreadable.json'))).toBe(true);
    });
  });
});

describe('legacyDirOf', () => {
  it('is the old folder inside the project', () => {
    expect(legacyDirOf(project)).toBe(path.join(project, LEGACY_META_DIR));
  });
});

describe('first access through the stores', () => {
  let store: typeof import('../src/main/metadir');

  beforeEach(async () => {
    vi.resetModules();
    store = await import('../src/main/metadir');
  });

  it('migrates on a read, once, and serves the moved data from the new folder', () => {
    put(legacy(), 'review.json', '{"x":1}\n');
    put(legacy(), 'explains/a.md', 'A');

    expect(store.readDataFile(project, 'review.json')).toBe('{"x":1}\n');
    expect(store.listFiles(project, 'explains', '.md').map((f) => f.name)).toEqual(['a.md']);

    expect(fs.existsSync(legacy())).toBe(false);
    expect(read(target(), '.gitignore')).toBe('*\n');
    expect(store.dataDir(project)).toBe(target());
  });

  it('does not touch an old folder that appears after the first access in this session', () => {
    expect(store.dataDir(project)).toBe(target());
    put(legacy(), 'review.json', 'LATE');
    expect(store.dataDir(project)).toBe(target());
    expect(fs.existsSync(legacy())).toBe(true);
    expect(fs.existsSync(target())).toBe(false);
  });

  it('adds the ignore file to data that came from the old folder', () => {
    put(legacy(), 'review.json', '{}\n');
    store.dataDir(project);
    expect(tree(target())).toEqual(['.gitignore', 'review.json']);
  });

  it('adds the ignore file after a merge as well', () => {
    put(target(), 'review.json', 'NEW');
    put(legacy(), 'project.json', 'OLD');
    store.dataDir(project);
    expect(read(target(), '.gitignore')).toBe('*\n');
    expect(read(target(), 'project.json')).toBe('OLD');
  });

  describe.skipIf(!CAN_DENY_READS)('when the move fails', () => {
    beforeEach(() => {
      put(legacy(), 'review.json', '{"old":true}\n');
      put(legacy(), 'z-unreadable.json', 'Z');
      fs.chmodSync(path.join(legacy(), 'z-unreadable.json'), 0o000);
    });

    it('keeps the app working from the old data for the session and reports the failure once', () => {
      const problems: string[] = [];
      store.onMigrationProblem((problem) => problems.push(`${problem.projectPath}|${problem.message}`));

      expect(store.dataDir(project)).toBe(legacy());
      expect(store.readDataFile(project, 'review.json')).toBe('{"old":true}\n');
      store.writeDataFile(project, 'review.json', '{"old":false}\n');
      expect(store.dataDir(project)).toBe(legacy());
      expect(read(legacy(), 'review.json')).toBe('{"old":false}\n');

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(project);
      expect(problems[0]).toContain('Nothing was deleted');
      expect(fs.existsSync(path.join(project, '.lantern', '.project', 'review.json'))).toBe(false);
    });

    it('retries in the next session and moves the data', async () => {
      expect(store.dataDir(project)).toBe(legacy());
      fs.chmodSync(path.join(legacy(), 'z-unreadable.json'), 0o644);

      vi.resetModules();
      const next = await import('../src/main/metadir');

      expect(next.dataDir(project)).toBe(target());
      expect(next.readDataFile(project, 'review.json')).toBe('{"old":true}\n');
      expect(fs.existsSync(legacy())).toBe(false);
    });

    it('still protects the new folder from git when an explainer run prepares it', () => {
      store.dataDir(project);
      store.ensureLocalDir(project);
      expect(read(target(), '.gitignore')).toBe('*\n');
      expect(store.dataDir(project)).toBe(legacy());
    });
  });
});
