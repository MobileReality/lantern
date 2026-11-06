import { git } from './lantern-git';
import { REMOTE_PREFIX, listRemoteBranches } from './lantern-pr-remote';
import { resolveCommit } from './lantern-prs';
import type { PrLoadDetailed } from './lantern-prs';
import type { LanternPr } from './lantern-types';

type BaseSource = 'recorded' | 'host' | 'default' | 'chosen';

interface PrBase {
  name: string;
  source: BaseSource;
}

interface PrChoices {
  bases: string[];
  branches: string[];
}

interface PrSides {
  base?: string;
  branch?: string;
}

interface PrRevisions {
  before: string | null;
  branch: string;
  removedBefore?: string | null;
  against?: PrBase;
}

const MAX_CHOICES = 200;
const DEFAULT_LINE_NAME = 'main';

async function firstRef(root: string, refs: string[]) {
  for (const ref of refs) {
    const sha = await resolveCommit(root, ref);
    if (sha) return sha;
  }
  return null;
}

async function mergeBase(root: string, a: string, b: string) {
  const result = await git(root, ['merge-base', a, b]);
  return result.ok ? result.stdout.trim() || null : null;
}

function namedCommit(root: string, name: string) {
  return firstRef(root, [`${REMOTE_PREFIX}${name}`, `refs/heads/${name}`]);
}

async function defaultLine(root: string): Promise<{ name: string; sha: string } | null> {
  const symbolic = await git(root, ['symbolic-ref', '--quiet', `${REMOTE_PREFIX}HEAD`]);
  const target = symbolic.ok ? symbolic.stdout.trim().slice(REMOTE_PREFIX.length) : '';
  const lines = [
    { ref: `${REMOTE_PREFIX}HEAD`, name: target || DEFAULT_LINE_NAME },
    { ref: `${REMOTE_PREFIX}${DEFAULT_LINE_NAME}`, name: DEFAULT_LINE_NAME },
    { ref: `refs/heads/${DEFAULT_LINE_NAME}`, name: DEFAULT_LINE_NAME },
  ];
  for (const line of lines) {
    const sha = await resolveCommit(root, line.ref);
    if (sha) return { name: line.name, sha };
  }
  return null;
}

async function prChoices(root: string, pr: LanternPr): Promise<PrChoices> {
  const remote = (await listRemoteBranches(root)).map((b) => b.name).slice(0, MAX_CHOICES);
  const line = await defaultLine(root);
  return { bases: [...new Set([...(line ? [line.name] : []), ...remote])], branches: [...new Set([pr.branch, ...remote])] };
}

async function acceptedSides(root: string, pr: LanternPr, sides: PrSides | undefined): Promise<PrSides | undefined> {
  if (!sides || (!sides.base && !sides.branch)) return undefined;
  const choices = await prChoices(root, pr);
  const base = sides.base && choices.bases.includes(sides.base) ? sides.base : undefined;
  const branch = sides.branch && choices.branches.includes(sides.branch) ? sides.branch : undefined;
  return base || branch ? { ...(base ? { base } : {}), ...(branch ? { branch } : {}) } : undefined;
}

async function baseCandidates(root: string, pr: LanternPr, sides: PrSides | undefined) {
  const out: Array<{ name: string; source: BaseSource; sha: string }> = [];
  const add = async (name: string | undefined, source: BaseSource) => {
    const sha = name ? await namedCommit(root, name) : null;
    if (name && sha) out.push({ name, source, sha });
  };
  if (sides?.base) {
    await add(sides.base, 'chosen');
    return out;
  }
  await add(pr.base, 'recorded');
  if (pr.hostBase && pr.hostBase !== pr.base) await add(pr.hostBase, 'host');
  const line = await defaultLine(root);
  if (line && line.name !== pr.base && line.name !== pr.hostBase) out.push({ ...line, source: 'default' });
  return out;
}

async function openRevisions(root: string, pr: LanternPr, requested?: PrSides): Promise<PrRevisions | null> {
  const sides = await acceptedSides(root, pr, requested);
  const branch = await namedCommit(root, sides?.branch ?? pr.branch);
  if (!branch) return null;
  for (const base of await baseCandidates(root, pr, sides)) {
    const before = await mergeBase(root, base.sha, branch);
    if (before) return { branch, before, ...(base.source === 'recorded' ? {} : { against: { name: base.name, source: base.source } }) };
  }
  return { branch, before: null };
}

async function mergedRevisions(root: string, pr: LanternPr, load: PrLoadDetailed): Promise<PrRevisions | null> {
  const merge = load.mergeCommits.get(pr.id);
  if (merge) return { branch: merge, before: await resolveCommit(root, `${merge}^1`) };
  const head = await resolveCommit(root, pr.head);
  if (!head) return null;
  for (const tip of load.baseTips.get(pr.base) ?? []) {
    const before = await mergeBase(root, head, tip.sha);
    if (before && before !== head) return { branch: head, before };
  }
  return { branch: head, before: null, removedBefore: await resolveCommit(root, `${head}^`) };
}

function revisionsOf(root: string, pr: LanternPr, load: PrLoadDetailed, sides?: PrSides) {
  return pr.state === 'open' ? openRevisions(root, pr, sides) : mergedRevisions(root, pr, load);
}

function resolvePrRevisions(root: string, pr: LanternPr, load: PrLoadDetailed, sides?: PrSides) {
  if (sides) return revisionsOf(root, pr, load, sides);
  const key = [pr.id, pr.state, pr.head, pr.base, pr.hostBase ?? ''].join('\0');
  const known = load.revisions.get(key);
  if (known) return known;
  const pending = revisionsOf(root, pr, load, sides);
  load.revisions.set(key, pending);
  pending.catch(() => {
    if (load.revisions.get(key) === pending) load.revisions.delete(key);
  });
  return pending;
}

function unreadableReason(pr: LanternPr): string | null {
  if (pr.state === 'closed') return 'this pull request was declined and its branch is gone';
  return pr.state === 'declined' ? 'this pull request was declined' : null;
}

export { prChoices, resolvePrRevisions, unreadableReason };
export type { BaseSource, PrBase, PrChoices, PrRevisions, PrSides };
