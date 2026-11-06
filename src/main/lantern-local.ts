import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WORKTREE, compareId, compareTitle, isLocalId, isRef, parseCompareId, pointLabel } from '../shared/local-review';
import type { CompareCommit, CompareRefs, CompareStat, CompareTarget } from '../shared/local-review';
import { regularFileInside } from './filecontent';
import { git } from './lantern-git';
import { decodePath } from './lantern-parse';
import { BRANCH_DIR, branchFileName, parseBranchRecord } from './lantern-pr-parse';
import type { ParsedPr } from './lantern-pr-parse';
import { REMOTE_PREFIX } from './lantern-pr-remote';
import { resolveCommit } from './lantern-prs';
import type { LanternMap, LanternPr, LanternPrFile, LanternPrFileKind } from './lantern-types';
import type { ReasonLookup } from './local-reasons';

const MAX_REFS = 200;
const MAX_COMMITS = 30;
const MAX_COUNTED_UNTRACKED = 500;
const MAX_COUNTED_BYTES = 2 * 1024 * 1024;
const MAX_COUNTED_TOTAL_BYTES = 32 * 1024 * 1024;
const NOT_MAP = ['--', '.', ':(exclude).lantern'];

interface LocalRevisions {
  before: string;
  branch: string | null;
  source?: string | null;
}

async function resolvePoint(root: string, point: string) {
  for (const ref of point === 'HEAD' ? [point] : [`refs/heads/${point}`, `${REMOTE_PREFIX}${point}`, point]) {
    const sha = await resolveCommit(root, ref);
    if (sha) return sha;
  }
  return null;
}

async function mergeBase(root: string, a: string, b: string) {
  const res = await git(root, ['merge-base', a, b]);
  return res.ok ? res.stdout.trim() || null : null;
}

async function lastSourceCommit(root: string, sha: string) {
  const res = await git(root, ['rev-list', '-1', sha, ...NOT_MAP]);
  return res.ok ? res.stdout.trim() || null : null;
}

async function revisionsOf(root: string, target: CompareTarget): Promise<LocalRevisions | null> {
  const [base, head] = await Promise.all([resolvePoint(root, target.base), resolvePoint(root, target.head === WORKTREE ? 'HEAD' : target.head)]);
  if (!base || !head) return null;
  const branch = target.head === WORKTREE ? null : head;
  return { before: (await mergeBase(root, base, head)) ?? base, branch, source: branch ? await lastSourceCommit(root, branch) : null };
}

async function localRevisions(root: string, id: string) {
  const target = parseCompareId(id);
  return target ? revisionsOf(root, target) : null;
}

function kindOf(status: string): LanternPrFileKind {
  if (status === 'A' || status === '?') return 'added';
  return status === 'D' ? 'removed' : 'modified';
}

function parseNameStatus(out: string, mapped: Set<string>): LanternPrFile[] {
  const parts = out.split('\0');
  const files: LanternPrFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [status, rel] = [parts[i], parts[i + 1]];
    if (status && rel) files.push({ path: rel, kind: kindOf(status[0]), mapped: mapped.has(rel) });
  }
  return files;
}

async function untrackedFiles(root: string) {
  const res = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return res.stdout.split('\0').filter((rel) => rel && !rel.startsWith('.lantern/'));
}

function range(rev: LocalRevisions) {
  return rev.branch ? [rev.before, rev.branch] : [rev.before];
}

async function changedFiles(root: string, rev: LocalRevisions, mapped: Set<string>) {
  const [diff, untracked] = await Promise.all([
    git(root, ['diff', '--no-renames', '--name-status', '-z', ...range(rev), ...NOT_MAP]),
    rev.branch ? Promise.resolve([]) : untrackedFiles(root),
  ]);
  return parseNameStatus(`${diff.stdout}${untracked.map((rel) => `?\0${rel}\0`).join('')}`, mapped);
}

function fileVersion(root: string, rev: LocalRevisions, rel: string) {
  if (rev.branch) return `${rev.before}:${rev.source ?? rev.branch}`;
  try {
    const stat = fs.lstatSync(path.join(root, rel));
    return `${rev.before}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${rev.before}:gone`;
  }
}

function withReasons(root: string, id: string, rev: LocalRevisions, files: LanternPrFile[], reasons: ReasonLookup) {
  return files.map((f) => {
    const reason = reasons(id, f.path, fileVersion(root, rev, f.path));
    return reason ? { ...f, reason } : f;
  });
}

function localPr(id: string, target: CompareTarget, files: LanternPrFile[]): LanternPr {
  return { id, title: compareTitle(target), url: '', branch: pointLabel(target.head), base: pointLabel(target.base), opened: '', head: '', files, state: 'open', source: 'local' };
}

type StampedRecord = ParsedPr & { stamp: string };

async function branchRecord(root: string, target: CompareTarget, rev: LocalRevisions): Promise<StampedRecord | null> {
  if (!rev.branch) return null;
  const name = target.head.replace(/^origin\//, '');
  const fileName = branchFileName(name);
  let text: string;
  try {
    text = await fs.promises.readFile(path.join(root, BRANCH_DIR, fileName), 'utf8');
  } catch {
    return null;
  }
  const { pr } = parseBranchRecord(text, fileName);
  return pr && pr.branch === name && pr.head === (rev.source ?? rev.before) ? { ...pr, stamp: createHash('sha1').update(text).digest('hex') } : null;
}

function withRecord(files: LanternPrFile[], record: ParsedPr): LanternPrFile[] {
  const position = new Map(record.files.map((f, i) => [f.path, i]));
  const reasoned = files.map((f) => {
    const reason = record.files.find((r) => r.path === f.path)?.reason ?? f.reason;
    return reason ? { ...f, reason } : f;
  });
  if (!record.ordered) return reasoned;
  return [...reasoned].sort((a, b) => (position.get(a.path) ?? Infinity) - (position.get(b.path) ?? Infinity));
}

function recordFields(record: ParsedPr): Partial<LanternPr> {
  return {
    ...(record.summary ? { summary: record.summary } : {}),
    ...(record.description ? { description: record.description } : {}),
    ...(record.plans ? { plans: record.plans } : {}),
    ...(record.ordered ? { ordered: true } : {}),
    ...(record.flow ? { flow: record.flow } : {}),
    ...(record.flowError ? { flowError: record.flowError } : {}),
  };
}

async function localPrs(root: string, ids: string[], mapped: Set<string>, reasons?: ReasonLookup): Promise<LanternPr[]> {
  const prs: LanternPr[] = [];
  for (const id of ids) {
    const target = parseCompareId(id);
    if (!target) continue;
    const rev = await revisionsOf(root, target);
    if (!rev) prs.push({ ...localPr(id, target, []), title: `${compareTitle(target)} (unavailable)` });
    else {
      const files = await changedFiles(root, rev, mapped);
      const record = await branchRecord(root, target, rev);
      const shown = reasons ? withReasons(root, id, rev, files, reasons) : files;
      prs.push({ ...localPr(id, target, record ? withRecord(shown, record) : shown), ...(record ? recordFields(record) : {}), revision: rev.branch ? `${rev.branch}${record ? `:${record.stamp}` : ''}` : await worktreeStamp(root), ...(rev.branch ? { tip: rev.branch } : {}) });
    }
  }
  return prs;
}

function recordReasons(root: string): ReasonLookup {
  const dir = path.join(root, '.lantern', 'local');
  const byKey = new Map<string, string>();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.reason'));
  } catch {
    return () => undefined;
  }
  for (const name of names) {
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
    } catch {
      continue;
    }
    const base = lines.find((l) => l.startsWith('#base '))?.slice(6).trim();
    const head = lines.find((l) => l.startsWith('#head '))?.slice(6).trim();
    if (lines[0] !== 'lantern-local 1' || !base || !head) continue;
    const id = compareId(base, head);
    for (const line of lines) {
      if (!line.startsWith('#reason ')) continue;
      const [enc, version, ...rest] = line.slice('#reason '.length).split(' ');
      const reason = rest.join(' ').trim();
      if (enc && version && reason) byKey.set(`${id}\0${decodePath(enc)}\0${version}`, reason);
    }
  }
  return (id, rel, version) => byKey.get(`${id}\0${rel}\0${version}`);
}

async function withLocalPrs(root: string, map: LanternMap, ids: string[], reasons?: ReasonLookup): Promise<LanternMap> {
  if (!ids.length) return map;
  const written = recordReasons(root);
  const lookup: ReasonLookup = (id, rel, version) => written(id, rel, version) ?? reasons?.(id, rel, version);
  const local = await localPrs(root, ids, new Set(map.nodes.map((n) => n.path)), lookup);
  return local.length ? { ...map, prs: [...local, ...map.prs] } : map;
}

function hasWorktree(ids: string[]) {
  return ids.some((id) => parseCompareId(id)?.head === WORKTREE);
}

async function worktreeStamp(root: string) {
  const res = await git(root, ['status', '--porcelain', '-z', '--untracked-files=all']);
  const stats = res.stdout
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => {
      try {
        const stat = fs.statSync(path.join(root, entry.slice(3)));
        return `${entry}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return entry;
      }
    });
  return createHash('sha1').update(stats.join('\0')).digest('hex');
}

async function countLines(root: string, files: string[]) {
  const real = fs.realpathSync(root);
  let lines = 0;
  let bytes = 0;
  for (const rel of files.slice(0, MAX_COUNTED_UNTRACKED)) {
    const full = regularFileInside(real, rel);
    if (!full) continue;
    try {
      const size = (await fs.promises.stat(full)).size;
      if (size > MAX_COUNTED_BYTES) continue;
      bytes += size;
      if (bytes > MAX_COUNTED_TOTAL_BYTES) break;
      const raw = await fs.promises.readFile(full);
      if (raw.includes(0)) continue;
      const text = raw.toString('utf8');
      lines += text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    } catch {}
  }
  return lines;
}

async function compareStat(root: string, base: unknown, head: unknown): Promise<CompareStat> {
  if (typeof base !== 'string' || typeof head !== 'string' || !isRef(base) || !(head === WORKTREE || isRef(head))) return { ok: false, files: 0, add: 0, del: 0, error: 'invalid comparison' };
  const rev = await revisionsOf(root, { base, head });
  if (!rev) return { ok: false, files: 0, add: 0, del: 0, error: 'one side is not available locally' };
  const [numstat, untracked] = await Promise.all([git(root, ['diff', '--no-renames', '--numstat', '-z', ...range(rev), ...NOT_MAP]), rev.branch ? Promise.resolve([]) : untrackedFiles(root)]);
  let files = 0;
  let add = 0;
  let del = 0;
  for (const row of numstat.stdout.split('\0')) {
    const [a, d] = row.split('\t');
    if (!row) continue;
    files++;
    add += Number(a) || 0;
    del += Number(d) || 0;
  }
  return { ok: true, files: files + untracked.length, add: add + (await countLines(root, untracked)), del };
}

async function compareRefs(root: string): Promise<CompareRefs> {
  const [refs, current, originHead, dirty] = await Promise.all([
    git(root, ['for-each-ref', '--sort=-committerdate', `--count=${MAX_REFS * 2}`, '--format=%(refname)%00%(objectname)%00%(committerdate:relative)%00%(subject)', 'refs/heads', 'refs/remotes/origin']),
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']),
    git(root, ['status', '--porcelain', '-z', '--untracked-files=all']),
  ]);
  const rows = refs.stdout
    .split('\n')
    .map((line) => line.split('\0'))
    .filter(([ref, sha]) => ref && sha)
    .map(([ref, sha, date, subject]) => ({ ref, sha, date: date ?? '', subject: subject ?? '', local: ref.startsWith('refs/heads/'), short: ref.replace(/^refs\/(heads|remotes\/origin)\//, '') }));
  const localTips = new Map(rows.filter((r) => r.local).map((r) => [r.short, r.sha]));
  const tips = new Map<string, string>();
  const branches: CompareRefs['branches'] = [];
  for (const r of rows) {
    if (!r.local && localTips.get(r.short) === r.sha) continue;
    const name = r.local || !localTips.has(r.short) ? r.short : `origin/${r.short}`;
    if (r.short === 'HEAD' || tips.has(name) || !isRef(name)) continue;
    tips.set(name, r.sha);
    branches.push({ name, date: r.date, subject: r.subject });
    if (branches.length >= MAX_REFS) break;
  }
  const named = originHead.ok ? originHead.stdout.trim().replace(/^refs\/remotes\/origin\//, '') : '';
  const base = [named, 'main', 'master'].filter(Boolean).flatMap((n) => [`origin/${n}`, n]).find((n) => tips.has(n)) ?? branches[0]?.name ?? 'HEAD';
  const dirtyCount = dirty.stdout.split('\0').filter((entry) => entry.length > 3 && entry[2] === ' ' && !entry.slice(3).startsWith('.lantern/')).length;
  return { branches, base, current: current.ok ? current.stdout.trim() : 'HEAD', dirty: dirtyCount };
}

async function compareCommits(root: string, ref: unknown): Promise<CompareCommit[]> {
  if (typeof ref !== 'string' || !isRef(ref)) return [];
  const sha = await resolvePoint(root, ref);
  if (!sha) return [];
  const res = await git(root, ['log', `--max-count=${MAX_COMMITS}`, '--format=%H%x00%h%x00%cr%x00%s', sha]);
  return res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [full, short, date, subject] = line.split('\0');
      return { sha: full, short, date, subject };
    });
}

export { compareCommits, compareRefs, compareStat, fileVersion, hasWorktree, recordReasons, isLocalId, localPrs, localRevisions, withLocalPrs, worktreeStamp };
export type { LocalRevisions };
