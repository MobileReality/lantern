const COMPARE_PREFIX = 'local:cmp:';
const WORKTREE = '@';
const REF = /^(?!-)(?!.*\.\.)[\w./-]{1,200}$/;

interface CompareTarget {
  base: string;
  head: string;
}

interface CompareStat {
  ok: boolean;
  files: number;
  add: number;
  del: number;
  error?: string;
}

interface CompareRef {
  name: string;
  date: string;
  subject: string;
}

interface CompareRefs {
  branches: CompareRef[];
  base: string;
  current: string;
  dirty: number;
}

interface CompareCommit {
  sha: string;
  short: string;
  date: string;
  subject: string;
}

function isRef(value: string) {
  return REF.test(value);
}

function compareId(base: string, head: string) {
  return `${COMPARE_PREFIX}${base}|${head}`;
}

function parseCompareId(id: unknown): CompareTarget | null {
  if (typeof id !== 'string' || !id.startsWith(COMPARE_PREFIX)) return null;
  const [base, head, ...rest] = id.slice(COMPARE_PREFIX.length).split('|');
  if (rest.length || !base || !head || !isRef(base) || !(head === WORKTREE || isRef(head))) return null;
  return { base, head };
}

function parseCompareSpec(spec: unknown): string | null {
  if (typeof spec !== 'string') return null;
  const m = /^([^.\s]+(?:\.[^.\s]+)*)(?:\.{2,3}(.*))?$/.exec(spec.trim());
  if (!m) return null;
  const head = !m[2] || m[2] === 'worktree' ? WORKTREE : m[2];
  const id = compareId(m[1], head);
  return parseCompareId(id) ? id : null;
}

function pointLabel(point: string) {
  if (point === WORKTREE) return 'working tree';
  return /^[0-9a-f]{40}$/.test(point) ? point.slice(0, 7) : point;
}

function isLocalId(id: unknown) {
  return parseCompareId(id) !== null;
}

function compareTitle(target: CompareTarget) {
  return `${pointLabel(target.base)} → ${pointLabel(target.head)}`;
}

function prRef(id: string) {
  const target = parseCompareId(id);
  return target ? compareTitle(target) : `#${id}`;
}

export { compareTitle, isLocalId, prRef, COMPARE_PREFIX, WORKTREE, compareId, isRef, parseCompareId, parseCompareSpec, pointLabel };
export type { CompareCommit, CompareRef, CompareRefs, CompareStat, CompareTarget };
