import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CodeSource } from '../shared/code-highlighting';
import { issueSource } from './lsp/source-provenance';
import { CODE_HL_MAX_BYTES, CODE_VIEW_MAX_LINES } from '../shared/code-preview';

interface ProjectFile {
  exists: boolean;
  text: string;
  truncated: number;
  clipped?: boolean;
  refused?: boolean;
  note?: string;
  reason?: string;
  source?: CodeSource;
}

const REFUSED: ProjectFile = { exists: false, text: '', truncated: 0, refused: true };
const MISSING: ProjectFile = { exists: false, text: '', truncated: 0 };

function isEscaping(rel: string) {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel) || path.win32.isAbsolute(rel)) return true;
  return rel.split(/[\\/]/).some((part) => part === '..');
}

function resolveInside(project: string, rel: string) {
  const root = fs.realpathSync(project);
  const real = fs.realpathSync(path.join(root, rel));
  const within = path.relative(root, real);
  return within && !within.startsWith('..') && !path.isAbsolute(within) ? real : null;
}

function regularFileInside(project: string, rel: string) {
  try {
    const real = resolveInside(project, rel);
    return real && fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

function readHead(file: string, size: number) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, CODE_HL_MAX_BYTES));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readProjectFile(project: unknown, rel: unknown): ProjectFile {
  if (typeof project !== 'string' || !project || typeof rel !== 'string' || isEscaping(rel)) return REFUSED;
  let real: string | null;
  try {
    real = resolveInside(project, rel);
  } catch {
    return MISSING;
  }
  if (!real) return REFUSED;
  try {
    const stat = fs.statSync(real);
    if (!stat.isFile()) return MISSING;
    const clipped = stat.size > CODE_HL_MAX_BYTES;
    let text = readHead(real, stat.size);
    if (clipped) text = text.slice(0, Math.max(text.lastIndexOf('\n'), 0));
    const lines = text.split('\n');
    const truncated = Math.max(lines.length - CODE_VIEW_MAX_LINES, 0);
    if (truncated) text = lines.slice(0, CODE_VIEW_MAX_LINES).join('\n');
    const source = clipped ? undefined : issueSource(fs.realpathSync(project), rel, { kind: 'working-tree', revision: 'working-tree', contentHash: createHash('sha256').update(text).digest('hex') });
    return { exists: true, text, truncated, clipped, ...(source ? { source } : {}) };
  } catch {
    return MISSING;
  }
}

export { readProjectFile, isEscaping, regularFileInside };
export type { ProjectFile };
