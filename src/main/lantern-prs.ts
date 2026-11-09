import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fetchOrigin, git } from './lantern-git';
import { hostStatus } from './lantern-host-status';
import type { HostStatus } from './lantern-host-status';
import { createRefCache } from './lantern-pr-cache';
import { PR_DIR, parsePrRecord } from './lantern-pr-parse';
import type { ParsedPr } from './lantern-pr-parse';
import { MAX_BRANCHES, REMOTE_PREFIX, scanRemote } from './lantern-pr-remote';
import type { PrRevisions } from './lantern-pr-revisions';
import type { LanternPr, LanternPrInfo, LanternPrState } from './lantern-types';

const MAX_MERGE_LOG = 5000;
const MAX_BRANCH_COMMITS = 500;
const MAX_CACHED_BASES = 32;
const MENTION = /pull request #(\d+)/g;
const STATE_RANK: Record<LanternPrState, number> = { open: 0, merged: 1, closed: 2, declined: 2 };

interface Found {
  pr: ParsedPr;
  source: LanternPr['source'];
}

interface PrLoad {
  prs: LanternPr[];
  warnings: string[];
}

interface PrLoadDetailed extends PrLoad {
  mergeCommits: Map<string, string>;
  baseTips: Map<string, Tip[]>;
  revisions: Map<string, Promise<PrRevisions | null>>;
}

interface MergeMention {
  at: string;
  sha: string;
  strong: boolean;
}

const mergedIdsCache = new Map<string, Map<string, MergeMention>>();

async function hasOrigin(root: string) {
  return (await git(root, ['remote', 'get-url', 'origin'])).ok;
}

async function readTreeRecords(root: string, warnings: string[]): Promise<Found[]> {
  let names: string[];
  try {
    names = (await fs.promises.readdir(path.join(root, PR_DIR))).filter((n) => n.endsWith('.pr')).sort();
  } catch {
    return [];
  }
  const found: Found[] = [];
  for (const name of names) {
    let text: string;
    try {
      text = await fs.promises.readFile(path.join(root, PR_DIR, name), 'utf8');
    } catch (e) {
      warnings.push(`${PR_DIR}/${name}: ${(e as Error).message}`);
      continue;
    }
    const res = parsePrRecord(text, name);
    if (res.pr) found.push({ pr: res.pr, source: 'tree' });
    else warnings.push(`${PR_DIR}/${name}: ${res.error}`);
  }
  return found;
}

async function resolveCommit(root: string, ref: string): Promise<string | null> {
  const res = await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return res.ok ? res.stdout.trim() : null;
}

interface Tip {
  ref: string;
  sha: string;
  strict: boolean;
}

async function mergedIdsOn(root: string, tip: Tip): Promise<Map<string, MergeMention>> {
  const key = `${root}\0${tip.sha}\0${tip.strict}`;
  const cached = mergedIdsCache.get(key);
  if (cached) return cached;
  const res = await git(root, ['log', tip.ref, '-E', '--grep=pull request #[0-9]+', `--max-count=${MAX_MERGE_LOG}`, '--format=%H%x1f%cI%x1f%P%x1f%B%x1e']);
  const ids = new Map<string, MergeMention>();
  if (!res.ok) return ids;
  for (const rec of res.stdout.split('\x1e')) {
    const [sha, at, parents, ...rest] = rec.split('\x1f');
    const body = rest.join('\x1f');
    if (!body.trim()) continue;
    const strong = (parents ?? '').trim().split(/\s+/).filter(Boolean).length > 1 || /^\s*(Merged in |Merge pull request)/.test(body);
    if (tip.strict && !strong) continue;
    const text = tip.strict ? (body.trim().split('\n')[0] ?? '') : body;
    for (const m of text.matchAll(MENTION)) {
      const prev = ids.get(m[1]);
      if (!prev || (strong && !prev.strong)) ids.set(m[1], { at: (at ?? '').trim(), sha: (sha ?? '').trim(), strong });
    }
  }
  mergedIdsCache.delete(key);
  mergedIdsCache.set(key, ids);
  while (mergedIdsCache.size > MAX_CACHED_BASES) mergedIdsCache.delete(mergedIdsCache.keys().next().value as string);
  return ids;
}

function pushTip(tips: Tip[], ref: string, sha: string | null, strict: boolean) {
  if (sha && !tips.some((t) => t.sha === sha)) tips.push({ ref, sha, strict });
}

async function baseTips(root: string, base: string) {
  const tips: Tip[] = [];
  for (const ref of [`${REMOTE_PREFIX}${base}`, `refs/heads/${base}`]) pushTip(tips, ref, await resolveCommit(root, ref), false);
  return tips;
}

async function defaultLineTips(root: string) {
  const tips: Tip[] = [];
  const refs = ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/heads/main'];
  const sym = await git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const name = sym.ok ? sym.stdout.trim().replace(/^refs\/remotes\/origin\//, '') : '';
  if (name) refs.push(`refs/heads/${name}`);
  for (const ref of refs) pushTip(tips, ref, await resolveCommit(root, ref), true);
  pushTip(tips, 'HEAD', await resolveCommit(root, 'HEAD'), true);
  return tips;
}

async function mergedAtAncestor(root: string, pr: ParsedPr, tip: Tip) {
  const res = await git(root, ['log', '--ancestry-path', '--reverse', '--format=%cI', `${pr.head}..${tip.ref}`]);
  return res.ok ? (res.stdout.trim().split('\n')[0] ?? '') : '';
}

interface MergeHit {
  at: string;
  commit?: string;
}

async function headPredatesBranch(root: string, pr: ParsedPr, branchTip: string, tip: Tip) {
  if ((await git(root, ['merge-base', '--is-ancestor', branchTip, tip.ref])).ok) return false;
  const shared = await git(root, ['merge-base', branchTip, tip.ref]);
  const sharedSha = shared.ok ? shared.stdout.trim() : '';
  return sharedSha !== '' && (await git(root, ['merge-base', '--is-ancestor', pr.head, sharedSha])).ok;
}

async function findMerge(root: string, pr: ParsedPr, tips: Tip[], branchTip?: string): Promise<MergeHit | null> {
  let hit: MergeMention | null = null;
  for (const tip of tips) {
    const found = (await mergedIdsOn(root, tip)).get(pr.id);
    if (found && (!hit || (found.strong && !hit.strong))) hit = found;
  }
  if (hit) return { at: hit.at, ...(hit.strong && hit.sha ? { commit: hit.sha } : {}) };
  for (const tip of tips) {
    if (tip.ref === 'HEAD') continue;
    if (branchTip && (await headPredatesBranch(root, pr, branchTip, tip))) continue;
    if ((await git(root, ['merge-base', '--is-ancestor', pr.head, tip.ref])).ok) return { at: await mergedAtAncestor(root, pr, tip) };
  }
  return null;
}

function byNewest(a: LanternPr, b: LanternPr) {
  return STATE_RANK[a.state] - STATE_RANK[b.state] || b.opened.localeCompare(a.opened) || Number(b.id) - Number(a.id);
}

async function isNewerRecord(root: string, known: Found, remote: ParsedPr) {
  if (known.source !== 'tree' || known.pr.head === remote.head) return false;
  return (await git(root, ['merge-base', '--is-ancestor', known.pr.head, remote.head])).ok;
}

function commitLines(res: { ok: boolean; stdout: string }) {
  return res.ok ? res.stdout.split('\n').filter((line) => line.includes('\x1f')) : [];
}

async function gitInfo(root: string, pr: ParsedPr, end: string): Promise<LanternPrInfo | undefined> {
  const format = '--format=%an%x1f%aI';
  let lines = commitLines(await git(root, ['log', '--no-merges', format, `--max-count=${MAX_BRANCH_COMMITS}`, end, '--not', `${REMOTE_PREFIX}${pr.base}`]));
  if (!lines.length) lines = commitLines(await git(root, ['log', '-1', format, end]));
  if (!lines.length) return undefined;
  const [, updated] = lines[0].split('\x1f');
  const [name] = lines[lines.length - 1].split('\x1f');
  return { from: 'git', ...(name ? { author: { name } } : {}), ...(updated ? { updated } : {}) };
}

async function loadGitPrs(root: string, mapped: Set<string>): Promise<PrLoadDetailed> {
  const warnings: string[] = [];
  const mergeCommits = new Map<string, string>();
  const tipsByBase = new Map<string, Tip[]>();
  if (!(await hasOrigin(root))) return { prs: [], warnings, mergeCommits, baseTips: tipsByBase, revisions: new Map() };

  const found = await readTreeRecords(root, warnings);
  const scan = await scanRemote(root, found.map((f) => f.pr.base));
  for (const rec of scan.records) {
    if (!rec.result.pr) {
      warnings.push(`origin/${rec.branch}:${PR_DIR}/${rec.fileName}: ${rec.result.error}`);
      continue;
    }
    const known = found.find((f) => f.pr.id === rec.result.pr!.id);
    if (known) {
      if (await isNewerRecord(root, known, rec.result.pr)) {
        known.pr = rec.result.pr;
        known.source = 'remote';
      }
      continue;
    }
    found.push({ pr: rec.result.pr, source: 'remote' });
  }
  if (scan.capped > 0) warnings.push(`PR scan: examined the ${MAX_BRANCHES} newest remote branches, skipped ${scan.capped} older`);

  const remoteTips = new Map(scan.branches.map((b) => [b.name, b.sha]));
  const lineTips = await defaultLineTips(root);
  const current = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const currentBranch = current.ok ? current.stdout.trim() : '';
  for (const { pr } of found) {
    if (tipsByBase.has(pr.base)) continue;
    const tips = await baseTips(root, pr.base);
    for (const t of lineTips) pushTip(tips, t.ref, t.sha, t.strict);
    tipsByBase.set(pr.base, tips);
  }

  const prs: LanternPr[] = [];
  for (const { pr, source } of found) {
    const merged = await findMerge(
      root,
      pr,
      (tipsByBase.get(pr.base) ?? []).filter((t) => t.ref !== 'HEAD' || currentBranch !== pr.branch),
      remoteTips.get(pr.branch),
    );
    if (merged?.commit) mergeCommits.set(pr.id, merged.commit);
    const state: LanternPrState = merged ? 'merged' : remoteTips.has(pr.branch) ? 'open' : 'closed';
    const tip = state === 'open' ? remoteTips.get(pr.branch) : undefined;
    const info = await gitInfo(root, pr, tip ?? pr.head);
    prs.push({
      id: pr.id,
      title: pr.title,
      url: pr.url,
      branch: pr.branch,
      base: pr.base,
      opened: pr.opened,
      head: pr.head,
      ...(pr.summary ? { summary: pr.summary } : {}),
      ...(pr.description ? { description: pr.description } : {}),
      ...(pr.plans ? { plans: pr.plans } : {}),
      files: pr.files.map((f) => ({ path: f.path, kind: f.kind, mapped: mapped.has(f.path), ...(f.reason ? { reason: f.reason } : {}) })),
      ...(pr.ordered ? { ordered: true } : {}),
      ...(pr.flow ? { flow: pr.flow } : {}),
      ...(pr.flowError ? { flowError: pr.flowError } : {}),
      state,
      ...(tip ? { tip } : {}),
      ...(merged?.at ? { mergedAt: merged.at } : {}),
      ...(info ? { info } : {}),
      source,
    });
  }
  return { prs: prs.sort(byNewest), warnings, mergeCommits, baseTips: tipsByBase, revisions: new Map() };
}

const gitLoads = createRefCache<PrLoadDetailed>();
const served = new Map<string, string>();

function loadGitCached(root: string) {
  return gitLoads.get(root, () => loadGitPrs(root, new Set()));
}

function withMapped(prs: LanternPr[], mapped: Set<string>): LanternPr[] {
  if (!mapped.size) return prs;
  return prs.map((pr) => ({ ...pr, files: pr.files.map((f) => (f.mapped === mapped.has(f.path) ? f : { ...f, mapped: mapped.has(f.path) })) }));
}

async function loadPrsDetailed(root: string, mapped: Set<string>, host: HostStatus = hostStatus): Promise<PrLoadDetailed> {
  const { value: load } = await loadGitCached(root);
  const { prs, note } = host.apply(root, load.prs);
  return { ...load, prs: withMapped([...prs].sort(byNewest), mapped), warnings: note ? [...load.warnings, note] : load.warnings };
}

function prsDigest(prs: LanternPr[]) {
  return createHash('sha1').update(JSON.stringify(prs, (key, value) => (key === 'mapped' ? undefined : value))).digest('hex');
}

async function loadPrs(root: string, mapped: Set<string>, host: HostStatus = hostStatus): Promise<PrLoad> {
  const { prs, warnings } = await loadPrsDetailed(root, mapped, host);
  served.set(root, prsDigest(prs));
  return { prs, warnings };
}

async function revalidatePrs(root: string, host: HostStatus = hostStatus): Promise<{ changed: boolean; load: PrLoadDetailed }> {
  const load = await loadPrsDetailed(root, new Set(), host);
  const seen = served.get(root);
  return { changed: seen !== undefined && seen !== prsDigest(load.prs), load };
}

function dropPrCache(root: string) {
  gitLoads.drop(root);
  served.delete(root);
}

async function refreshHostStates(root: string, force: boolean, host: HostStatus) {
  try {
    const { value } = await loadGitCached(root);
    await host.refresh(root, value.prs, force);
  } catch {
    return;
  }
}

async function fetchPrs(project: unknown, force: unknown = false, host: HostStatus = hostStatus): Promise<{ ok: boolean; error?: string }> {
  if (typeof project !== 'string' || !project.trim()) return { ok: false, error: 'project must be a non-empty string' };
  try {
    const root = path.resolve(project);
    if (!(await hasOrigin(root))) return { ok: false, error: 'not a git project with an origin remote' };
    const fetched = await fetchOrigin(root);
    await refreshHostStates(root, force === true, host);
    return fetched;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export { loadPrs, loadPrsDetailed, revalidatePrs, dropPrCache, fetchPrs, resolveCommit };
export type { PrLoad, PrLoadDetailed, Tip };
