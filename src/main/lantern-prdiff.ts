import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CODE_HL_MAX_BYTES, CODE_VIEW_MAX_LINES, MAX_DOCUMENT_BYTES } from '../shared/code-preview';
import { isEscaping, regularFileInside } from './filecontent';
import { git } from './lantern-git';
import { isLocalId, localRevisions } from './lantern-local';
import { loadPrsDetailed, resolveCommit } from './lantern-prs';
import { prChoices, resolvePrRevisions, unreadableReason } from './lantern-pr-revisions';
import type { PrBase, PrChoices, PrSides } from './lantern-pr-revisions';
import type { PrLoadDetailed } from './lantern-prs';
import type { LanternPr } from './lantern-types';
import type { CodeSource } from '../shared/code-highlighting';
import { issueSource } from './lsp/source-provenance';

interface PrFileDiff {
  ok: boolean;
  diff: string;
  truncated: boolean;
  binary: boolean;
  reason?: string;
  oldSource?: CodeSource;
  newSource?: CodeSource;
  against?: PrBase;
  recordedBase?: string;
  candidates?: PrChoices;
}

const MAX_SIDE_NAME = 255;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d3b4cdc89c4ca7';
const DIFF_ARGS = ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-renames'];
const FULL_CONTEXT = '--unified=1000000';
const PLAIN_CONTEXT = '--unified=3';
const BINARY = /^Binary files .* differ$/m;
const PR_ID = /^\d{1,12}$/;

function unavailable(reason: string): PrFileDiff {
  return { ok: false, diff: '', truncated: false, binary: false, reason };
}

function noBaseReason(pr: LanternPr) {
  return `the base branch ${pr.base} of this pull request no longer exists here, and neither the host nor the default line gave another one to compare against`;
}

function noBranchReason(pr: LanternPr) {
  return `the branch ${pr.branch} of this pull request is not available locally`;
}

async function undeterminedBase(root: string, pr: LanternPr, reason: string): Promise<PrFileDiff> {
  return { ...unavailable(reason), recordedBase: pr.base, candidates: await prChoices(root, pr) };
}

function sidesOf(value: unknown): PrSides | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { base, branch } = value as { base?: unknown; branch?: unknown };
  const named = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= MAX_SIDE_NAME ? v : undefined);
  const sides: PrSides = { ...(named(base) ? { base: named(base) } : {}), ...(named(branch) ? { branch: named(branch) } : {}) };
  return sides.base || sides.branch ? sides : undefined;
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

function finish(res: { ok: boolean; code: number | string | null; stdout: string }, oldSource?: CodeSource, newSource?: CodeSource): PrFileDiff {
  const overflow = res.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
  if (!res.ok && !(overflow && res.stdout)) return unavailable('git could not produce this diff');
  if (BINARY.test(res.stdout)) return { ok: true, diff: '', truncated: false, binary: true };
  const { out, truncated } = clip(res.stdout);
  return { ok: true, diff: out, truncated: truncated || overflow, binary: false, ...(oldSource ? { oldSource } : {}), ...(newSource ? { newSource } : {}) };
}

async function diffBetween(root: string, from: string, to: string, rel: string, threeDot = false) {
  const range = threeDot ? [`${from}...${to}`] : [from, to];
  const source = (revision: string) => issueSource(fs.realpathSync(root), rel, { kind: 'revision' as const, revision, contentHash: '' });
  const oldSource = source(from);
  const newSource = source(to);
  const full = finish(await git(root, [...DIFF_ARGS, FULL_CONTEXT, ...range, '--', rel]), oldSource, newSource);
  if (!full.ok || !full.truncated) return full;
  return finish(await git(root, [...DIFF_ARGS, PLAIN_CONTEXT, ...range, '--', rel]), oldSource, newSource);
}

async function lastTouchDiff(root: string, head: string, rel: string): Promise<PrFileDiff> {
  const log = await git(root, ['--literal-pathspecs', 'log', '-1', '--format=%H', head, '--', rel]);
  const commit = log.ok ? log.stdout.trim() : '';
  if (!commit) return { ok: true, diff: '', truncated: false, binary: false };
  const parent = await resolveCommit(root, `${commit}^`);
  return diffBetween(root, parent ?? EMPTY_TREE, commit, rel);
}


function worktreeSource(real: string, rel: string): CodeSource | undefined {
  try {
    const full = regularFileInside(real, rel);
    if (!full || fs.statSync(full).size > MAX_DOCUMENT_BYTES) return undefined;
    return issueSource(real, rel, { kind: 'working-tree', revision: 'working-tree', contentHash: createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
  } catch {
    return undefined;
  }
}

async function worktreeDiff(root: string, before: string, rel: string): Promise<PrFileDiff> {
  const real = fs.realpathSync(root);
  const [inBefore, inIndex] = await Promise.all([
    git(root, ['cat-file', '-e', `${before}:${rel}`]).then((r) => r.ok),
    git(root, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', rel]).then((r) => r.ok),
  ]);
  const tracked = inBefore || inIndex;
  const oldSource = inBefore ? issueSource(real, rel, { kind: 'revision', revision: before, contentHash: '' }) : undefined;
  if (!tracked && !regularFileInside(real, rel)) return unavailable('the file is not a regular file inside the project');
  const newSource = worktreeSource(real, rel);
  const run = async (context: string) => {
    if (tracked) return git(root, [...DIFF_ARGS, context, before, '--', rel]);
    const res = await git(root, [...DIFF_ARGS, context, '--no-index', '--', '/dev/null', rel]);
    return { ...res, ok: res.ok || res.code === 1 };
  };
  const full = finish(await run(FULL_CONTEXT), oldSource, newSource);
  if (!full.ok || !full.truncated) return full;
  return finish(await run(PLAIN_CONTEXT), oldSource, newSource);
}

async function localDiff(root: string, id: string, rel: string): Promise<PrFileDiff> {
  const revisions = await localRevisions(root, id);
  if (!revisions) return unavailable('one side of the comparison is not available locally');
  if (!revisions.branch) return worktreeDiff(root, revisions.before, rel);
  return diffBetween(root, revisions.before, revisions.branch, rel);
}

async function readPrFileDiff(project: unknown, prId: unknown, rel: unknown, sides?: unknown): Promise<PrFileDiff> {
  if (typeof project !== 'string' || !project.trim()) return unavailable('invalid project');
  if (typeof prId !== 'string' || !(PR_ID.test(prId) || isLocalId(prId))) return unavailable('invalid pull request id');
  if (typeof rel !== 'string' || isEscaping(rel)) return unavailable('invalid path');
  try {
    const root = path.resolve(project);
    if (isLocalId(prId)) return localDiff(root, prId, rel);
    const load = await loadPrsDetailed(root, new Set());
    const pr = load.prs.find((p) => p.id === prId);
    if (!pr) return unavailable('pull request not found');
    const refusal = unreadableReason(pr);
    if (refusal) return unavailable(refusal);
    const revisions = await resolvePrRevisions(root, pr, load, sidesOf(sides));
    if (!revisions) return pr.state === 'open' ? undeterminedBase(root, pr, noBranchReason(pr)) : unavailable('the pull request commits are not available locally');
    if (!revisions.before) return pr.state === 'open' ? undeterminedBase(root, pr, noBaseReason(pr)) : lastTouchDiff(root, revisions.branch, rel);
    const diff = await diffBetween(root, revisions.before, revisions.branch, rel, pr.state === 'open');
    return revisions.against ? { ...diff, against: revisions.against, recordedBase: pr.base } : diff;
  } catch (e) {
    return unavailable((e as Error).message);
  }
}

async function readRegisteredPrFileDiff(isRegistered: (dir: string) => boolean, project: unknown, prId: unknown, rel: unknown, sides?: unknown): Promise<PrFileDiff> {
  if (typeof project !== 'string' || !project.trim() || !isRegistered(project)) return unavailable('not a registered project');
  return readPrFileDiff(project, prId, rel, sides);
}

export { readPrFileDiff, readRegisteredPrFileDiff };
export type { PrFileDiff };
