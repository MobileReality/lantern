import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSessionId } from './provider';

const RECENT_MS = 10 * 60 * 1000;
const ACTIVE_MS = 30 * 1000;
const MAX_FILES = 80;
const META_BYTES = 64 * 1024;
const metadataCache = new Map<string, { size: number; id: string; cwd: string; eligible: boolean }>();

function codexSessionsRoot() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
}

function recentDayDirs(root: string, now: number) {
  const dirs: string[] = [];
  for (let offset = 0; offset < 2; offset++) {
    const date = new Date(now - offset * 24 * 60 * 60 * 1000);
    dirs.push(path.join(root, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')));
  }
  return dirs;
}

function isSubagentSource(source: unknown) {
  if (typeof source === 'string') return source.toLowerCase().includes('subagent');
  if (!source || typeof source !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(source, 'subagent') || JSON.stringify(source).includes('parent_thread_id');
}

function isMainSource(source: unknown) {
  return typeof source === 'string' && ['vscode', 'cli', 'exec'].includes(source.toLowerCase());
}

function readSessionMeta(file: string, size: number) {
  const cached = metadataCache.get(file);
  if (cached && cached.size === size) return cached;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(Math.min(size, META_BYTES));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    for (const line of buffer.toString('utf8', 0, read).split('\n')) {
      if (!line.includes('session_meta')) continue;
      const record = JSON.parse(line) as { type?: unknown; payload?: Record<string, unknown> };
      if (record.type !== 'session_meta' || !record.payload) continue;
      const id = typeof record.payload.id === 'string' ? record.payload.id : typeof record.payload.session_id === 'string' ? record.payload.session_id : '';
      const cwd = typeof record.payload.cwd === 'string' ? record.payload.cwd : '';
      const meta = { size, id, cwd, eligible: isMainSource(record.payload.source) && !isSubagentSource(record.payload.source) };
      metadataCache.set(file, meta);
      return meta;
    }
  } catch {}
  finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
  return { size, id: '', cwd: '', eligible: false };
}

function scanCodex(root = codexSessionsRoot(), now = Date.now()) {
  if (metadataCache.size > MAX_FILES * 4) metadataCache.clear();
  const candidates: { file: string; mtimeMs: number; size: number }[] = [];
  for (const dir of recentDayDirs(root, now)) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      try {
        const stat = fs.statSync(file);
        if (stat.isFile() && now - stat.mtimeMs <= RECENT_MS) candidates.push({ file, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {}
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.slice(0, MAX_FILES).flatMap(({ file, mtimeMs, size }) => {
    const meta = readSessionMeta(file, size);
    if (!isSessionId(meta.id) || !meta.cwd || !meta.eligible) return [];
    return [{
      id: meta.id,
      provider: 'codex' as const,
      cwd: meta.cwd,
      project: path.basename(meta.cwd) || meta.cwd,
      state: now - mtimeMs < ACTIVE_MS ? 'running' : 'idle',
      updatedAt: Math.round(mtimeMs),
    }];
  });
}

export { ACTIVE_MS, RECENT_MS, codexSessionsRoot, isMainSource, isSubagentSource, readSessionMeta, recentDayDirs, scanCodex };
