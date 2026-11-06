import { COMMIT_PATTERN, PR_EXPLAIN_MAX_PATH, PR_ID_PATTERN } from '../shared/pr-explain';
import type { PrExplainTarget } from '../shared/pr-explain';
import { registeredProject } from './agent-request';
import { isEscaping } from './filecontent';
import { loadPrsDetailed } from './lantern-prs';
import type { LanternPr, LanternPrFile } from './lantern-types';

interface ResolvedPrExplain {
  target: PrExplainTarget;
  pr: LanternPr;
  file: LanternPrFile;
}

const INVALID_REQUEST = 'Invalid explain request';

type Resolution = { ok: true; value: ResolvedPrExplain } | { ok: false; error: string };

function parseTarget(value: unknown, projectPaths: string[]): PrExplainTarget | null {
  if (!value || typeof value !== 'object') return null;
  const arg = value as { project?: unknown; pr?: unknown; path?: unknown };
  const project = registeredProject(arg.project, projectPaths);
  if (!project || typeof arg.pr !== 'string' || !PR_ID_PATTERN.test(arg.pr)) return null;
  if (typeof arg.path !== 'string' || arg.path.length > PR_EXPLAIN_MAX_PATH || isEscaping(arg.path)) return null;
  return { project, pr: arg.pr, path: arg.path };
}

function parseSaved(value: unknown, projectPaths: string[]) {
  const target = parseTarget(value, projectPaths);
  const head = (value as { head?: unknown } | null)?.head;
  return target && typeof head === 'string' && COMMIT_PATTERN.test(head) ? { target, head } : null;
}

async function resolvePrTarget(target: PrExplainTarget): Promise<Resolution> {
  try {
    const load = await loadPrsDetailed(target.project, new Set());
    const pr = load.prs.find((p) => p.id === target.pr);
    if (!pr) return { ok: false, error: 'pull request not found' };
    if (pr.state === 'closed') return { ok: false, error: 'this pull request was declined and its branch is gone' };
    const file = pr.files.find((f) => f.path === target.path);
    if (!file) return { ok: false, error: 'this file is not part of the pull request' };
    return { ok: true, value: { target, pr, file } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function resolvePrExplainRequest(value: unknown, projectPaths: string[]): Promise<Resolution> {
  const target = parseTarget(value, projectPaths);
  return target ? resolvePrTarget(target) : { ok: false, error: INVALID_REQUEST };
}

export { INVALID_REQUEST, parseSaved, parseTarget, resolvePrExplainRequest, resolvePrTarget };
export type { ResolvedPrExplain };
