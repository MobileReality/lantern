import { msg } from '@shared/lang/messages';
import { PROVIDER, PROVIDERS } from '@shared/providers';
import type { AccountLookup } from './lantern-host-account';
import { mapInBatches } from './lantern-batch';
import { readHostCredentials } from './lantern-host-credentials';
import { bitbucketRepoOf } from './lantern-host-origin';
import type { HostnameResolver } from './lantern-host-origin';
import { fetchHostState } from './lantern-host-request';
import type { HostAnswer } from './lantern-host-request';
import type { LanternPr } from './lantern-types';

const HOST_TTL_MS = 5 * 60 * 1000;
const MAX_PARALLEL = 4;
const MAX_PROJECTS = 32;

type Unavailable = 'no-credentials' | 'failed';

const noteOf = (unavailable: Unavailable) => msg(unavailable === 'failed' ? 'hostStatus.failed' : 'hostStatus.noAccount', { provider: PROVIDERS[PROVIDER.bitbucket].name });

interface HostStatusOptions {
  baseUrl?: string;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  account?: AccountLookup;
  resolveHostname?: HostnameResolver;
}

interface Entry extends HostAnswer {
  at: number;
}

interface ProjectStatus {
  entries: Map<string, Entry>;
  unavailable: Unavailable | null;
  version: number;
}

interface Overlaid {
  prs: LanternPr[];
  note: string | null;
}

function createHostStatus(options: HostStatusOptions = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? HOST_TTL_MS;
  const projects = new Map<string, ProjectStatus>();
  const running = new Map<string, Promise<void>>();
  let account: AccountLookup | null = options.account ?? null;

  function statusOf(root: string): ProjectStatus {
    const known = projects.get(root);
    if (known) return known;
    const created: ProjectStatus = { entries: new Map(), unavailable: null, version: 0 };
    projects.set(root, created);
    while (projects.size > MAX_PROJECTS) projects.delete(projects.keys().next().value as string);
    return created;
  }

  function signature(status: ProjectStatus) {
    return `${status.unavailable}|${[...status.entries].map(([id, e]) => `${id}:${e.state}:${e.base ?? ''}`).sort().join(',')}`;
  }

  function isFresh(entry: Entry | undefined) {
    return !!entry && now() - entry.at < ttlMs;
  }

  async function lookupAll(root: string, openIds: string[], status: ProjectStatus) {
    const repo = await bitbucketRepoOf(root, options.resolveHostname);
    if (!repo) return null;
    const credentials = (await account?.(root)) ?? (await readHostCredentials(root, options.env));
    if (!credentials) return 'no-credentials' as const;
    const due = openIds.filter((id) => !isFresh(status.entries.get(id)));
    const answers = await mapInBatches(due, async (id) => [id, await fetchHostState(repo, id, credentials, options)] as const, MAX_PARALLEL);
    let failed = false;
    for (const [id, answer] of answers) {
      if (answer) status.entries.set(id, { ...answer, at: now() });
      else failed = true;
    }
    return failed ? ('failed' as const) : null;
  }

  async function run(root: string, openIds: string[], force: boolean) {
    const status = statusOf(root);
    const before = signature(status);
    if (force) for (const entry of status.entries.values()) entry.at = Number.NEGATIVE_INFINITY;
    for (const id of status.entries.keys()) if (!openIds.includes(id)) status.entries.delete(id);
    status.unavailable = openIds.length ? await lookupAll(root, openIds, status) : null;
    if (signature(status) !== before) status.version++;
  }

  function refresh(root: string, openIds: string[], force = false): Promise<void> {
    const inflight = running.get(root);
    if (inflight && !force) return inflight;
    const job = (inflight ?? Promise.resolve()).then(() => run(root, openIds, force));
    const settled = job.catch(() => undefined).finally(() => {
      if (running.get(root) === settled) running.delete(root);
    });
    running.set(root, settled);
    return settled;
  }

  function apply(root: string, prs: LanternPr[]): Overlaid {
    const status = projects.get(root);
    if (!status || !prs.some((p) => p.state === 'open')) return { prs, note: null };
    const next = prs.map((p) => {
      const entry = p.state === 'open' ? status.entries.get(p.id) : undefined;
      if (!entry) return p;
      if (entry.state !== 'open') return { ...p, state: entry.state };
      return entry.base ? { ...p, hostBase: entry.base } : p;
    });
    return { prs: next, note: status.unavailable ? noteOf(status.unavailable) : null };
  }

  return {
    refresh,
    apply,
    version: (root: string) => projects.get(root)?.version ?? 0,
    useAccounts: (lookup: AccountLookup) => {
      account = lookup;
    },
  };
}

type HostStatus = ReturnType<typeof createHostStatus>;

const hostStatus = createHostStatus();

export { createHostStatus, hostStatus, HOST_TTL_MS, noteOf };
export type { HostStatus, HostStatusOptions };
