import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomically } from '../atomic-write';

const PRIVATE_FILE_MODE = 0o600;

function writePrivateJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomically(file, `${JSON.stringify(value, null, 2)}\n`, PRIVATE_FILE_MODE);
  fs.chmodSync(file, PRIVATE_FILE_MODE);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { writePrivateJson, readJson, isRecord, PRIVATE_FILE_MODE };
