import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TEMP_SUFFIX = '.tmp';
const TEMP_ID_BYTES = 4;
const PERMISSION_BITS = 0o777;
const DEFAULT_FILE_MODE = 0o644;
const MISSING_FILE = 'ENOENT';

function writeTarget(link: string): string {
  try {
    return fs.realpathSync(link);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== MISSING_FILE) throw err;
  }
  try {
    return path.resolve(path.dirname(link), fs.readlinkSync(link));
  } catch {
    return link;
  }
}

function existingMode(target: string): number | undefined {
  try {
    return fs.statSync(target).mode & PERMISSION_BITS;
  } catch {
    return undefined;
  }
}

function writeFileAtomically(link: string, text: string, createMode = DEFAULT_FILE_MODE): void {
  const target = writeTarget(link);
  const mode = existingMode(target);
  const temp = `${target}.${process.pid}.${randomBytes(TEMP_ID_BYTES).toString('hex')}${TEMP_SUFFIX}`;
  try {
    const fd = fs.openSync(temp, 'wx', mode ?? createMode);
    try {
      fs.writeFileSync(fd, text);
      if (mode !== undefined) fs.fchmodSync(fd, mode);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, target);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

export { writeFileAtomically };
