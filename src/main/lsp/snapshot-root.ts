import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

interface BlobEntry { path: string; sha: string; size: number; executable: boolean }
const MAX_FILES = 30_000;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ROOTS = 13;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.json', '.jsonc']);
const DEPENDENCY_FILES = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock']);
const SNAPSHOT_BASE = /^lantern-lsp-p(\d+)-/;

async function cleanupOrphanSnapshotRoots(base = os.tmpdir(), signal: typeof process.kill = process.kill) {
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(base, { withFileTypes: true }); } catch { return; }
  await Promise.allSettled(entries.map(async (entry) => {
    const match = entry.isDirectory() && !entry.isSymbolicLink() ? entry.name.match(SNAPSHOT_BASE) : null;
    if (!match) return;
    try { signal(Number(match[1]), 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') await rm(path.join(base, entry.name), { recursive: true, force: true });
    }
  }));
}

function neededByTypeScript(relative: string) {
  return SOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase()) || DEPENDENCY_FILES.has(path.basename(relative));
}

interface SnapshotEntry {
  pending: Promise<string>;
  references: number;
}

interface SnapshotLease {
  root: string;
  retain: () => () => Promise<void>;
  release: () => Promise<void>;
}

function treeEntries(project: string, revision: string) {
  return new Promise<BlobEntry[]>((resolve, reject) => execFile('git', ['ls-tree', '-rlz', revision], { cwd: project, maxBuffer: 16 * 1024 * 1024, timeout: 15_000 }, (error, stdout) => {
    if (error) return reject(error);
    const entries: BlobEntry[] = [];
    let bytes = 0;
    for (const record of stdout.split('\0')) {
      if (!record) continue;
      const match = record.match(/^(\d{6}) blob ([0-9a-f]{40})\s+(\d+)\t([\s\S]+)$/);
      if (!match) continue;
      if (match[1] !== '100644' && match[1] !== '100755') continue;
      const relative = match[4];
      if (!relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) continue;
      if (!neededByTypeScript(relative)) continue;
      const size = Number(match[3]);
      entries.push({ path: relative, sha: match[2], size, executable: match[1] === '100755' });
      bytes += size;
      if (entries.length > MAX_FILES || bytes > MAX_BYTES) return reject(new Error('revision snapshot exceeds the preview safety limit'));
    }
    resolve(entries);
  }));
}

function readBlobs(project: string, entries: BlobEntry[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: project, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let settled = false;
    const fail = (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); child.kill(); reject(error); } };
    const timer = setTimeout(() => fail(new Error('revision blob read timed out')), 30_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES + entries.length * 96) fail(new Error('revision snapshot exceeds the preview safety limit'));
      else chunks.push(chunk);
    });
    child.stderr?.on('data', (chunk) => { if (stderr.length < 8_192) stderr += String(chunk); });
    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(stderr.trim() || 'could not read revision blobs'));
    });
    child.stdin?.end(`${entries.map((entry) => entry.sha).join('\n')}\n`);
  });
}

async function writeBlobs(root: string, entries: BlobEntry[], batch: Buffer) {
  let offset = 0;
  for (const entry of entries) {
    const newline = batch.indexOf(10, offset);
    const header = newline >= 0 ? batch.subarray(offset, newline).toString('ascii').match(/^[0-9a-f]{40} blob (\d+)$/) : null;
    if (!header || Number(header[1]) !== entry.size) throw new Error('invalid git cat-file response');
    const start = newline + 1;
    const end = start + entry.size;
    if (end >= batch.length || batch[end] !== 10) throw new Error('truncated git cat-file response');
    const target = path.join(root, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, batch.subarray(start, end), { mode: entry.executable ? 0o755 : 0o644 });
    offset = end + 1;
  }
}

function matchingDependencies(project: string, snapshot: string, entries: BlobEntry[]) {
  const modules = path.join(project, 'node_modules');
  if (!fs.existsSync(modules)) return null;
  if (fs.existsSync(path.join(snapshot, 'pnpm-workspace.yaml'))) return null;
  try {
    if (JSON.parse(fs.readFileSync(path.join(snapshot, 'package.json'), 'utf8')).workspaces) return null;
    for (const entry of fs.readdirSync(modules)) {
      const candidate = path.join(modules, entry);
      if (fs.lstatSync(candidate).isSymbolicLink() && fs.realpathSync(candidate).startsWith(`${project}${path.sep}`)) return null;
    }
  } catch { return null; }
  const manifests = entries.filter((entry) => path.basename(entry.path) === 'package.json').map((entry) => entry.path);
  const locks = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'].filter((file) => fs.existsSync(path.join(snapshot, file)));
  if (!locks.length) return null;
  for (const relative of new Set([...manifests, ...locks])) {
    const current = path.join(project, relative);
    const archived = path.join(snapshot, relative);
    if (!fs.existsSync(current) || !fs.readFileSync(current).equals(fs.readFileSync(archived))) return null;
  }
  return modules;
}

class SnapshotRoots {
  private readonly roots = new Map<string, SnapshotEntry>();
  private readonly base = fs.mkdtempSync(path.join(os.tmpdir(), `lantern-lsp-p${process.pid}-`));
  private disposed = false;

  constructor() { void cleanupOrphanSnapshotRoots(); }

  async acquire(project: string, revision: string): Promise<SnapshotLease> {
    if (this.disposed) return Promise.reject(new Error('semantic service is shutting down'));
    const key = `${project}\0${revision}`;
    let entry = this.roots.get(key);
    if (!entry) {
      if (this.roots.size >= MAX_ROOTS) return Promise.reject(new Error('historical semantic snapshot limit reached'));
      const pending = (async () => {
        const root = await mkdtemp(path.join(this.base, 'snapshot-'));
        try {
          const entries = await treeEntries(project, revision);
          await writeBlobs(root, entries, await readBlobs(project, entries));
          const modules = matchingDependencies(project, root, entries);
          if (modules) fs.symlinkSync(modules, path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
          return root;
        } catch (error) {
          await rm(root, { recursive: true, force: true });
          throw error;
        }
      })();
      entry = { pending, references: 0 };
      this.roots.set(key, entry);
      void pending.catch(() => this.roots.delete(key));
    }
    entry.references++;
    try {
      const root = await entry.pending;
      let released = false;
      const retain = () => {
        entry.references++;
        let retained = true;
        return async () => {
          if (!retained) return;
          retained = false;
          await this.release(key, entry);
        };
      };
      return {
        root,
        retain,
        release: async () => {
          if (released) return;
          released = true;
          await this.release(key, entry);
        },
      };
    } catch (error) {
      await this.release(key, entry);
      throw error;
    }
  }

  async dispose() {
    this.disposed = true;
    await Promise.allSettled([...this.roots.values()].map((entry) => entry.pending));
    this.roots.clear();
    await rm(this.base, { recursive: true, force: true });
  }

  private async release(key: string, entry: SnapshotEntry) {
    entry.references--;
    if (entry.references > 0 || this.roots.get(key) !== entry) return;
    this.roots.delete(key);
    const root = await entry.pending.catch(() => '');
    if (root) await rm(root, { recursive: true, force: true });
  }
}

export { SnapshotRoots, cleanupOrphanSnapshotRoots, treeEntries };
export type { SnapshotLease };
