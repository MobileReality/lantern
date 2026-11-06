import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_DATA_DIR } from '../shared/project-data';

const LEGACY_META_DIR = '.mr-code-helper';
const STAGING_SUFFIX = '.migrating';

type Migration =
  | { status: 'none' }
  | { status: 'moved' }
  | { status: 'merged'; kept: string[] }
  | { status: 'failed'; message: string; useLegacy: boolean };

function legacyDirOf(projectPath: string) {
  return path.join(projectPath, LEGACY_META_DIR);
}

function isDirectory(target: string) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function exists(target: string) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function removeIfEmpty(dir: string) {
  try {
    fs.rmdirSync(dir);
  } catch {}
}

function sameBytes(a: string, b: string) {
  try {
    if (!fs.lstatSync(a).isFile() || !fs.lstatSync(b).isFile()) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

// Copy into a sibling, then rename it into place: the target either appears whole or not at all,
// and the old folder is only removed once the complete copy is there.
function moveWhole(legacy: string, target: string) {
  const staging = `${target}${STAGING_SUFFIX}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    fs.cpSync(legacy, staging, { recursive: true, preserveTimestamps: true });
    fs.renameSync(staging, target);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  try {
    fs.rmSync(legacy, { recursive: true });
  } catch {}
}

// Never overwrites: a file already in the target wins, and a differing old copy stays where it is.
function mergeDir(from: string, to: string, rel: string, kept: string[]) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    const where = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (exists(destination) && !isDirectory(destination)) {
        kept.push(where);
        continue;
      }
      mergeDir(source, destination, where, kept);
      removeIfEmpty(source);
    } else if (!exists(destination)) {
      fs.cpSync(source, destination, { preserveTimestamps: true, force: false, errorOnExist: true, verbatimSymlinks: true });
      fs.unlinkSync(source);
    } else if (sameBytes(source, destination)) {
      fs.unlinkSync(source);
    } else {
      kept.push(where);
    }
  }
}

function failure(error: unknown, target: string, targetExistedBefore: boolean): Migration {
  const reason = error instanceof Error ? error.message : String(error);
  const useLegacy = !targetExistedBefore && !exists(target);
  const next = useLegacy ? 'Lantern keeps using the old folder until this project is opened again.' : 'What is left in the old folder is moved the next time this project is opened.';
  return { status: 'failed', useLegacy, message: `Could not move ${LEGACY_META_DIR}/ to ${PROJECT_DATA_DIR}/ (${reason}). Nothing was deleted. ${next}` };
}

function migrateLegacyDir(projectPath: string, target: string): Migration {
  const legacy = legacyDirOf(projectPath);
  if (!isDirectory(legacy)) return { status: 'none' };
  const targetExistedBefore = exists(target);
  try {
    if (!targetExistedBefore) {
      moveWhole(legacy, target);
      return { status: 'moved' };
    }
    const kept: string[] = [];
    mergeDir(legacy, target, '', kept);
    removeIfEmpty(legacy);
    return { status: 'merged', kept };
  } catch (error) {
    return failure(error, target, targetExistedBefore);
  }
}

export { LEGACY_META_DIR, legacyDirOf, migrateLegacyDir };
export type { Migration };
