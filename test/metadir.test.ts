import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dataDir, ensureLocalDir, listFiles, localDir, readDataFile, removeFile, writeDataFile } from '../src/main/metadir';
import { git } from './helpers/git-repo';

let project: string;
let explainsDir: string;

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-meta-'));
  explainsDir = path.join(project, '.lantern', '.project', 'explains');
  fs.mkdirSync(explainsDir, { recursive: true });
  fs.writeFileSync(path.join(explainsDir, 'a.md'), 'A');
  fs.writeFileSync(path.join(explainsDir, 'b.md'), 'B');
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

const remove = (name: string) => removeFile(project, 'explains', '.md', name);

describe('removeFile', () => {
  it('deletes a file inside the meta directory', () => {
    expect(remove('a.md')).toBe(true);
    expect(fs.existsSync(path.join(explainsDir, 'a.md'))).toBe(false);
    expect(listFiles(project, 'explains', '.md').map((f) => f.name)).toEqual(['b.md']);
  });

  it('refuses a name that escapes the directory', () => {
    const outside = path.join(project, 'secret.md');
    fs.writeFileSync(outside, 'keep');
    expect(remove('../secret.md')).toBe(false);
    expect(remove('../../secret.md')).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it('refuses an absolute path', () => {
    const outside = path.join(project, 'secret.md');
    fs.writeFileSync(outside, 'keep');
    expect(remove(outside)).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it('refuses a name with the wrong extension', () => {
    fs.writeFileSync(path.join(explainsDir, 'notes.txt'), 'x');
    expect(remove('notes.txt')).toBe(false);
    expect(fs.existsSync(path.join(explainsDir, 'notes.txt'))).toBe(true);
  });

  it('refuses empty input and reports failure for a missing file', () => {
    expect(remove('')).toBe(false);
    expect(removeFile('', 'explains', '.md', 'a.md')).toBe(false);
    expect(remove('nope.md')).toBe(false);
  });
});

describe('project data folder', () => {
  it('lives in .lantern/.project', () => {
    expect(localDir(project)).toBe(path.join(project, '.lantern', '.project'));
    expect(dataDir(project)).toBe(localDir(project));
  });

  it('creates nothing when only reading', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-meta-bare-'));
    try {
      expect(listFiles(bare, 'explains', '.md')).toEqual([]);
      expect(() => readDataFile(bare, 'review.json')).toThrow();
      expect(removeFile(bare, 'explains', '.md', 'a.md')).toBe(false);
      expect(fs.readdirSync(bare)).toEqual([]);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('creates the folder with a catch-all ignore file on the first write', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-meta-bare-'));
    try {
      writeDataFile(bare, 'review.json', '{}\n');
      expect(fs.readFileSync(path.join(bare, '.lantern', '.project', '.gitignore'), 'utf8')).toBe('*\n');
      expect(readDataFile(bare, 'review.json')).toBe('{}\n');
      expect(fs.readdirSync(path.join(bare, '.lantern'))).toEqual(['.project']);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('adds the ignore file to a folder that exists without one, and keeps an edited one', () => {
    writeDataFile(project, 'review.json', '{}\n');
    const ignore = path.join(localDir(project), '.gitignore');
    expect(fs.readFileSync(ignore, 'utf8')).toBe('*\n');
    fs.writeFileSync(ignore, '*\n!keep.txt\n');
    writeDataFile(project, 'review.json', '{"a":1}\n');
    expect(fs.readFileSync(ignore, 'utf8')).toBe('*\n!keep.txt\n');
    fs.rmSync(ignore);
    writeDataFile(project, 'review.json', '{}\n');
    expect(fs.readFileSync(ignore, 'utf8')).toBe('*\n');
  });

  it('never shows up in git, whatever is written into it', () => {
    git(project, ['init', '-q', '-b', 'main']);
    writeDataFile(project, 'review.json', '{}\n');
    ensureLocalDir(project);
    fs.mkdirSync(path.join(localDir(project), 'explains'), { recursive: true });
    fs.writeFileSync(path.join(localDir(project), 'explains', 'c.md'), 'C');
    expect(git(project, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
    git(project, ['add', '.lantern']);
    expect(git(project, ['status', '--porcelain'])).toBe('');
  });
});
