import { mapInBatches } from './lantern-batch';
import { git } from './lantern-git';
import { PR_DIR, parsePrRecord } from './lantern-pr-parse';
import type { PrParseResult } from './lantern-pr-parse';

const REMOTE_PREFIX = 'refs/remotes/origin/';
const MAX_BRANCHES = 60;
const GIT_PARALLEL = 6;
const MAX_CACHED_REFS = 400;
const KNOWN_BASES = ['main', 'master', 'develop', 'dev', 'trunk'];

interface RemoteBranch {
  name: string;
  ref: string;
  sha: string;
}

interface RemoteRecord {
  fileName: string;
  branch: string;
  result: PrParseResult;
}

interface RemoteScan {
  branches: RemoteBranch[];
  bases: Set<string>;
  defaultBase: string | null;
  records: RemoteRecord[];
  capped: number;
}

const recordCache = new Map<string, RemoteRecord[]>();

function remember(key: string, value: RemoteRecord[]) {
  recordCache.delete(key);
  recordCache.set(key, value);
  while (recordCache.size > MAX_CACHED_REFS) recordCache.delete(recordCache.keys().next().value as string);
}

async function listRemoteBranches(root: string): Promise<RemoteBranch[]> {
  const res = await git(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%09%(objectname)', REMOTE_PREFIX]);
  if (!res.ok) return [];
  const out: RemoteBranch[] = [];
  for (const line of res.stdout.split('\n')) {
    const [ref, sha] = line.split('\t');
    if (!ref || !sha || !ref.startsWith(REMOTE_PREFIX)) continue;
    const name = ref.slice(REMOTE_PREFIX.length);
    if (name === 'HEAD') continue;
    out.push({ name, ref, sha });
  }
  return out;
}

async function defaultBaseOf(root: string, branches: RemoteBranch[]): Promise<string | null> {
  const head = await git(root, ['symbolic-ref', '--quiet', `${REMOTE_PREFIX}HEAD`]);
  const named = head.ok ? head.stdout.trim().slice(REMOTE_PREFIX.length) : '';
  if (named) return named;
  return KNOWN_BASES.find((b) => branches.some((x) => x.name === b)) ?? null;
}

async function recordBlobs(root: string, ref: string): Promise<Map<string, string> | null> {
  const res = await git(root, ['ls-tree', '-r', '-z', ref, '--', `${PR_DIR}/`]);
  if (!res.ok) return null;
  const blobs = new Map<string, string>();
  for (const entry of res.stdout.split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const sha = entry.slice(0, tab).split(' ')[2];
    const rel = entry.slice(tab + 1);
    const fileName = rel.slice(PR_DIR.length + 1);
    if (sha && rel.startsWith(`${PR_DIR}/`) && fileName.endsWith('.pr') && !fileName.includes('/')) blobs.set(fileName, sha);
  }
  return blobs;
}

async function readBranchRecords(root: string, branch: RemoteBranch, baseBlobs: Map<string, string>, baseKey: string | null): Promise<RemoteRecord[]> {
  const key = `${root}\0${branch.sha}\0${baseKey}`;
  const cached = baseKey === null ? undefined : recordCache.get(key);
  if (cached) return cached;
  const blobs = await recordBlobs(root, branch.ref);
  if (!blobs) return [];
  let complete = baseKey !== null;
  const changed = [...blobs].filter(([fileName, blob]) => baseBlobs.get(fileName) !== blob).map(([fileName]) => fileName);
  const records: RemoteRecord[] = [];
  for (const fileName of changed.sort()) {
    const shown = await git(root, ['show', `${branch.ref}:./${PR_DIR}/${fileName}`]);
    if (!shown.ok) complete = false;
    const result: PrParseResult = shown.ok ? parsePrRecord(shown.stdout, fileName) : { pr: null, error: 'could not read the record from git' };
    records.push({ fileName, branch: branch.name, result });
  }
  if (complete) remember(key, records);
  return records;
}

async function scanRemote(root: string, extraBases: Iterable<string> = []): Promise<RemoteScan> {
  const all = await listRemoteBranches(root);
  const defaultBase = await defaultBaseOf(root, all);
  const bases = new Set([...KNOWN_BASES, ...extraBases, ...(defaultBase ? [defaultBase] : [])]);
  const candidates = all.filter((b) => !bases.has(b.name));
  const examined = candidates.slice(0, MAX_BRANCHES);
  const baseBranch = defaultBase ? all.find((b) => b.name === defaultBase) : undefined;
  const readBase = baseBranch ? await recordBlobs(root, baseBranch.ref) : new Map<string, string>();
  const baseBlobs = readBase ?? new Map<string, string>();
  const baseKey = readBase ? (baseBranch?.sha ?? '') : null;
  const perBranch = await mapInBatches(examined, (b) => readBranchRecords(root, b, baseBlobs, baseKey), GIT_PARALLEL);
  return { branches: all, bases, defaultBase, records: perBranch.flat(), capped: candidates.length - examined.length };
}

function remoteCacheSize() {
  return recordCache.size;
}

export { listRemoteBranches, scanRemote, remoteCacheSize, MAX_BRANCHES, MAX_CACHED_REFS, REMOTE_PREFIX };
export type { RemoteBranch, RemoteRecord, RemoteScan };
