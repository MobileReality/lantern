import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CODE_HL_MAX_BYTES, CODE_VIEW_MAX_LINES, MAX_DOCUMENT_BYTES } from '../shared/code-preview';
import { isEscaping, regularFileInside } from './filecontent';
import { git } from './lantern-git';
import { isLocalId, localRevisions } from './lantern-local';
import { loadPrsDetailed } from './lantern-prs';
import { resolvePrRevisions, unreadableReason } from './lantern-pr-revisions';
import type { PrLoadDetailed } from './lantern-prs';
import type { LanternPr } from './lantern-types';
import type { CodeSource } from '../shared/code-highlighting';
import { issueSource } from './lsp/source-provenance';

type PrFileVersion = 'branch' | 'before';

interface PrFile {
  ok: boolean;
  text: string;
  truncated: boolean;
  binary: boolean;
  version: PrFileVersion;
  reason?: string;
  source?: CodeSource;
}

const PR_ID = /^\d{1,12}$/;

function unavailable(reason: string, version: PrFileVersion = 'branch'): PrFile {
  return { ok: false, text: '', truncated: false, binary: false, version, reason };
}

function clip(text: string) {
  let out = text;
  let truncated = false;
  const lines = out.split('\n');
  if (lines.length > CODE_VIEW_MAX_LINES) {
    out = lines.slice(0, CODE_VIEW_MAX_LINES).join('\n');
    truncated = true;
  }
  if (out.length > CODE_HL_MAX_BYTES) {
    out = out.slice(0, Math.max(out.lastIndexOf('\n', CODE_HL_MAX_BYTES), 0));
    truncated = true;
  }
  return { out, truncated };
}

async function show(root: string, commit: string, rel: string, version: PrFileVersion): Promise<PrFile> {
  const res = await git(root, ['show', `${commit}:${rel}`]);
  const overflow = res.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
  if (!res.ok && !(overflow && res.stdout)) return unavailable('the file is not in that version of the pull request', version);
  if (res.stdout.includes('\0')) return { ok: true, text: '', truncated: false, binary: true, version };
  const { out, truncated } = clip(res.stdout);
  const source = issueSource(fsRealRoot(root), rel, { kind: 'revision' as const, revision: commit, contentHash: createHash('sha256').update(res.stdout).digest('hex') });
  return { ok: true, text: out, truncated: truncated || overflow, binary: false, version, source };
}

async function readWorktree(root: string, rel: string): Promise<PrFile> {
  try {
    const real = fsRealRoot(root);
    const full = regularFileInside(real, rel);
    if (!full) return unavailable('the file is not in the working tree');
    if ((await fs.promises.stat(full)).size > MAX_DOCUMENT_BYTES) return unavailable('the file is too large to show');
    const raw = await fs.promises.readFile(full);
    if (raw.includes(0)) return { ok: true, text: '', truncated: false, binary: true, version: 'branch' };
    const { out, truncated } = clip(raw.toString('utf8'));
    const source = issueSource(real, rel, { kind: 'working-tree', revision: 'working-tree', contentHash: createHash('sha256').update(raw).digest('hex') });
    return { ok: true, text: out, truncated, binary: false, version: 'branch', source };
  } catch {
    return unavailable('the file is not in the working tree');
  }
}

async function readLocalFile(root: string, id: string, rel: string): Promise<PrFile> {
  const revisions = await localRevisions(root, id);
  if (!revisions) return unavailable('one side of the comparison is not available locally');
  const current = revisions.branch ? await show(root, revisions.branch, rel, 'branch') : await readWorktree(root, rel);
  if (current.ok) return current;
  const before = await show(root, revisions.before, rel, 'before');
  return before.ok ? before : current;
}

async function readPrFile(project: unknown, prId: unknown, rel: unknown): Promise<PrFile> {
  if (typeof project !== 'string' || !project.trim()) return unavailable('invalid project');
  if (typeof prId !== 'string' || !(PR_ID.test(prId) || isLocalId(prId))) return unavailable('invalid pull request id');
  if (typeof rel !== 'string' || isEscaping(rel)) return unavailable('invalid path');
  try {
    const root = path.resolve(project);
    if (isLocalId(prId)) return readLocalFile(root, prId, rel);
    const load = await loadPrsDetailed(root, new Set());
    const pr = load.prs.find((p) => p.id === prId);
    if (!pr) return unavailable('pull request not found');
    const refusal = unreadableReason(pr);
    if (refusal) return unavailable(refusal);
    const removed = pr.files.some((f) => f.path === rel && f.kind === 'removed');
    const revisions = await resolvePrRevisions(root, pr, load);
    if (!revisions) return unavailable('the pull request commits are not available locally', removed ? 'before' : 'branch');
    const revision = removed ? revisions.before ?? revisions.removedBefore : revisions.branch;
    if (!revision) return unavailable('the pull request base is not available locally', removed ? 'before' : 'branch');
    return show(root, revision, rel, removed ? 'before' : 'branch');
  } catch (e) {
    return unavailable((e as Error).message);
  }
}

async function readRegisteredPrFile(isRegistered: (dir: string) => boolean, project: unknown, prId: unknown, rel: unknown): Promise<PrFile> {
  if (typeof project !== 'string' || !project.trim() || !isRegistered(project)) return unavailable('not a registered project');
  return readPrFile(project, prId, rel);
}

export { readPrFile, readRegisteredPrFile };
export type { PrFile, PrFileVersion };

function fsRealRoot(root: string) {
  return fs.realpathSync(root);
}
