import type { FreeMemoryResult, MemoryKind } from '../shared/memory';
import { registeredProject } from './agent-request';
import { attributeTree, readProcessRows, readWorkingDirectories, runCommand, walkTree, type CommandRunner, type TreeEntry } from './memory-collect';
import { MEMORY_SUPPORTED_PLATFORMS } from './memory-service';
import { isSignalablePid, terminatePids } from './prockill';
import { descendantsOf } from './proctree';

const TERMINATE_GRACE_MS = 1500;

export interface ReleaseScope {
  rootPid: number;
  serverPid: number;
  project: string;
}

export interface ReleasePlan {
  pids: number[];
  kinds: Partial<Record<MemoryKind, number>>;
}

export interface ReleaseDeps {
  supported: boolean;
  run: CommandRunner;
  rootPid: number;
  serverPid: () => number | null;
  projectPaths: () => string[];
  registered: (value: unknown) => string | null;
  sharedWindow: (project: string) => boolean;
  terminate: (pids: number[]) => Promise<unknown>;
}

export const signalableTargets = (candidates: number[], { rootPid, serverPid }: Pick<ReleaseScope, 'rootPid' | 'serverPid'>) =>
  candidates.filter((pid) => isSignalablePid(pid) && pid !== rootPid && pid !== serverPid);

export function planRelease(tree: TreeEntry[], projectOf: Map<number, string>, scope: ReleaseScope): ReleasePlan | null {
  const rows = tree.map(({ row }) => row);
  const entryOf = new Map(tree.map((entry) => [entry.row.pid, entry]));
  const belowServer = new Set(descendantsOf(rows, scope.serverPid));
  const hosts = tree
    .filter(({ row, identity }) => identity.kind === 'extension-host' && belowServer.has(row.pid) && projectOf.get(row.pid) === scope.project)
    .map(({ row }) => row.pid);
  if (!hosts.length) return null;
  const candidates = new Set(hosts.flatMap((host) => [host, ...descendantsOf(rows, host)]));
  const foreign = [...candidates].filter((pid) => {
    const owner = projectOf.get(pid);
    return owner !== undefined && owner !== scope.project;
  });
  const foreignTrees = new Set(foreign.flatMap((pid) => [pid, ...descendantsOf(rows, pid)]));
  const inScope = [...candidates].filter((pid) => !foreignTrees.has(pid) && belowServer.has(pid) && entryOf.get(pid)?.identity.category !== 'app');
  const pids = signalableTargets(inScope, scope);
  const kinds: ReleasePlan['kinds'] = {};
  for (const pid of pids) {
    const kind = entryOf.get(pid)!.identity.kind;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  return { pids, kinds };
}

export async function releaseProjectMemory(value: unknown, deps: ReleaseDeps): Promise<FreeMemoryResult> {
  if (!deps.supported) return { ok: false, reason: 'unsupported' };
  const project = deps.registered(value);
  if (!project) return { ok: false, reason: 'invalid-project' };
  const serverPid = deps.serverPid();
  if (serverPid === null) return { ok: false, reason: 'no-server' };
  if (deps.sharedWindow(project)) return { ok: false, reason: 'shared-window' };
  const rows = await readProcessRows(deps.run);
  if (!rows.some((row) => row.pid === deps.rootPid)) return { ok: false, reason: 'unreadable' };
  const tree = walkTree(rows, deps.rootPid);
  if (!tree.some(({ row }) => row.pid === serverPid)) return { ok: false, reason: 'no-server' };
  const projectOf = attributeTree(tree, await readWorkingDirectories(deps.run, tree), deps.projectPaths());
  const plan = planRelease(tree, projectOf, { rootPid: deps.rootPid, serverPid, project });
  if (!plan || !plan.pids.length) return { ok: false, reason: 'no-host' };
  await deps.terminate(plan.pids);
  return { ok: true, terminated: plan.kinds };
}

export function createProjectRelease({ platform, ...deps }: Omit<ReleaseDeps, 'supported' | 'run' | 'terminate' | 'registered'> & { platform: NodeJS.Platform }) {
  const full: ReleaseDeps = {
    ...deps,
    supported: MEMORY_SUPPORTED_PLATFORMS.includes(platform),
    run: runCommand,
    registered: (value) => registeredProject(value, deps.projectPaths()),
    terminate: (pids) => terminatePids(pids, TERMINATE_GRACE_MS),
  };
  return (value: unknown) => releaseProjectMemory(value, full);
}
