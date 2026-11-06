import fs from 'node:fs';
import path from 'node:path';
import { LANTERN_DIR, PROJECT_DATA_NAME } from '../shared/project-data';
import { legacyDirOf, migrateLegacyDir } from './metadir-migrate';
import type { Migration } from './metadir-migrate';

const IGNORE_FILE = '.gitignore';
const IGNORE_EVERYTHING = '*\n';

interface MetaFile {
  name: string;
  text: string;
  mtime: number;
}

interface MigrationProblem {
  projectPath: string;
  message: string;
}

const settled = new Map<string, Migration>();
const problemListeners = new Set<(problem: MigrationProblem) => void>();

function localDir(projectPath: string) {
  return path.join(projectPath, LANTERN_DIR, PROJECT_DATA_NAME);
}

function onMigrationProblem(listener: (problem: MigrationProblem) => void) {
  problemListeners.add(listener);
  return () => problemListeners.delete(listener);
}

function ensureIgnoreFile(dir: string) {
  try {
    fs.writeFileSync(path.join(dir, IGNORE_FILE), IGNORE_EVERYTHING, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

// Runs once per project per session, on the first access of any kind, so every store sees the
// same folder. A failure is reported once and never retried until the next session.
function settle(projectPath: string): Migration {
  const key = path.resolve(projectPath);
  const known = settled.get(key);
  if (known) return known;
  const outcome = migrateLegacyDir(projectPath, localDir(projectPath));
  settled.set(key, outcome);
  if (outcome.status === 'moved' || outcome.status === 'merged') {
    try {
      ensureIgnoreFile(localDir(projectPath));
    } catch {}
  }
  if (outcome.status === 'failed') for (const listener of problemListeners) listener({ projectPath, message: outcome.message });
  return outcome;
}

// Where this project's data lives right now: the new folder, or the old one for the session in
// which moving it failed, so the user keeps working with what they have.
function dataDir(projectPath: string) {
  const outcome = settle(projectPath);
  return outcome.status === 'failed' && outcome.useLegacy ? legacyDirOf(projectPath) : localDir(projectPath);
}

function ensureLocalDir(projectPath: string) {
  settle(projectPath);
  const dir = localDir(projectPath);
  fs.mkdirSync(dir, { recursive: true });
  ensureIgnoreFile(dir);
  return dir;
}

function ensureDataDir(projectPath: string) {
  const dir = dataDir(projectPath);
  if (dir === localDir(projectPath)) return ensureLocalDir(projectPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readDataFile(projectPath: string, name: string) {
  return fs.readFileSync(path.join(dataDir(projectPath), name), 'utf8');
}

function writeDataFile(projectPath: string, name: string, text: string) {
  fs.writeFileSync(path.join(ensureDataDir(projectPath), name), text);
}

// Newest first (by file mtime), so the most recently generated explainer leads;
// name breaks ties for a stable order.
function listFiles(projectPath: string, sub: string, ext: string): MetaFile[] {
  if (!projectPath) return [];
  const dir = path.join(dataDir(projectPath), sub);
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(ext));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const full = path.join(dir, name);
      let text = '';
      let mtime = 0;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {}
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {}
      return { name, text, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
}

// `name` comes from the renderer, so it must be a bare filename with the expected
// extension — never a path — or it could escape the project's meta directory.
function removeFile(projectPath: string, sub: string, ext: string, name: string) {
  if (!projectPath || !name) return false;
  if (name !== path.basename(name) || !name.endsWith(ext)) return false;
  const dir = path.join(dataDir(projectPath), sub);
  const target = path.join(dir, name);
  if (path.dirname(target) !== dir) return false;
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

export { localDir, dataDir, ensureLocalDir, ensureDataDir, readDataFile, writeDataFile, listFiles, removeFile, onMigrationProblem };
export type { MetaFile, MigrationProblem };
