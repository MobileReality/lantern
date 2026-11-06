import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { bundledSkillDir } from './agent';
import { lanternStamp } from './lantern-stamp';

interface SetupProgress {
  files: { done: number; total: number };
  bytes: { done: number; total: number };
  chunks: { done: number; total: number };
  next: { id: number; dir: string; files: number; pending: number } | null;
  features: boolean;
  platforms: boolean;
  sections: number;
}

const READ_TIMEOUT_MS = 120_000;

function planScript() {
  return path.join(bundledSkillDir(), 'scripts', 'plan.mjs');
}

function isProgress(value: any): value is SetupProgress {
  const pair = (v: any) => !!v && Number.isFinite(v.done) && Number.isFinite(v.total);
  return !!value && pair(value.files) && pair(value.bytes) && pair(value.chunks) && typeof value.features === 'boolean';
}

// plan.mjs runs in a worker thread, not the main one: hashing every mapped file of a big project
// takes seconds, and the packaged app cannot spawn a plain node (the RunAsNode fuse is off).
function runPlanStatus(project: string, languageCode: string, script = planScript(), timeoutMs = READ_TIMEOUT_MS): Promise<SetupProgress | null> {
  return new Promise((resolve) => {
    let out = '';
    let worker: Worker;
    try {
      worker = new Worker(script, { argv: [project, 'status', '--json'], env: { ...process.env, LANTERN_LANG: languageCode }, stdout: true, stderr: true });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => void worker.terminate(), timeoutMs);
    worker.stdout.on('data', (d: Buffer) => (out += d.toString()));
    worker.on('error', () => resolve(null));
    worker.on('exit', () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out.trim());
        resolve(isProgress(parsed) ? parsed : null);
      } catch {
        resolve(null);
      }
    });
  });
}

interface Cached {
  stamp: string;
  value: SetupProgress | null;
}

const cache = new Map<string, Cached>();
const flights = new Map<string, Promise<SetupProgress | null>>();

// A live poll re-reads only when something under .lantern/ (or the git refs) moved since the last
// read, so it costs a stat pass while a chunk is being mapped and one plan.mjs run per chunk.
// `fresh` skips that shortcut: source files changed outside .lantern/ are not in the stamp.
function readProgress(project: string, languageCode: string, fresh = false): Promise<SetupProgress | null> {
  const key = `${project}\n${languageCode}`;
  const inflight = flights.get(key);
  if (inflight) return inflight;
  const job = (async () => {
    const stamp = `${await lanternStamp(project)}\n${languageCode}`;
    const hit = cache.get(key);
    if (!fresh && hit && hit.stamp === stamp) return hit.value;
    const value = await runPlanStatus(project, languageCode);
    cache.set(key, { stamp, value });
    return value;
  })().finally(() => flights.delete(key));
  flights.set(key, job);
  return job;
}

export { readProgress, runPlanStatus, isProgress };
export type { SetupProgress };
