import path from 'node:path';
import { hostStatus } from './lantern-host-status';
import type { HostStatus } from './lantern-host-status';
import { resolvePrRevisions } from './lantern-pr-revisions';
import { dropPrCache, fetchPrs, loadPrsDetailed, revalidatePrs } from './lantern-prs';
import type { PrLoadDetailed } from './lantern-prs';
import type { LanternPr } from './lantern-types';

const WARM_OPEN_LIMIT = 24;

const warming = new Map<string, Promise<void>>();
const again = new Set<string>();

async function primeRevisions(root: string, pr: LanternPr, load: PrLoadDetailed) {
  try {
    await resolvePrRevisions(root, pr, load);
  } catch {
    return;
  }
}

async function warmOnce(root: string, host: HostStatus) {
  try {
    const load = await loadPrsDetailed(root, new Set(), host);
    for (const pr of load.prs.filter((p) => p.state === 'open').slice(0, WARM_OPEN_LIMIT)) await primeRevisions(root, pr, load);
  } catch {
    return;
  }
}

function warmPrs(project: string, host: HostStatus = hostStatus): Promise<void> {
  const root = path.resolve(project);
  const running = warming.get(root);
  if (running) {
    again.add(root);
    return running;
  }
  const job = (async () => {
    do {
      again.delete(root);
      await warmOnce(root, host);
    } while (again.has(root));
  })().finally(() => warming.delete(root));
  warming.set(root, job);
  return job;
}

async function fetchAndWarmPrs(project: unknown, force: unknown = false, host: HostStatus = hostStatus) {
  const fetched = await fetchPrs(project, force, host);
  if (typeof project === 'string' && project.trim()) void warmPrs(project, host);
  return fetched;
}

async function refreshPrData(project: string, host: HostStatus = hostStatus): Promise<{ ok: boolean; error?: string }> {
  const root = path.resolve(project);
  dropPrCache(root);
  const fetched = await fetchPrs(project, true, host);
  try {
    await loadPrsDetailed(root, new Set(), host);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  void warmPrs(project, host);
  return fetched;
}

async function enterPr(project: string, prId: string, host: HostStatus = hostStatus): Promise<{ changed: boolean }> {
  const root = path.resolve(project);
  try {
    const { changed, load } = await revalidatePrs(root, host);
    const pr = load.prs.find((p) => p.id === prId);
    if (pr) void primeRevisions(root, pr, load);
    return { changed };
  } catch {
    return { changed: false };
  }
}

export { warmPrs, fetchAndWarmPrs, refreshPrData, enterPr, WARM_OPEN_LIMIT };
