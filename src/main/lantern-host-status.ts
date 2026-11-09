import { msg } from '@shared/lang/messages';
import { PROVIDERS } from '@shared/providers';
import type { CodeHostId } from '@shared/providers';
import type { AccountLookup } from './lantern-host-account';
import { mapInBatches } from './lantern-batch';
import { withAvatars } from './lantern-host-avatar';
import { DRIVERS, recordBelongsTo } from './lantern-host-drivers';
import { isRateLimited } from './lantern-host-github';
import { codeHostOf } from './lantern-host-origin';
import type { CodeHost, HostnameResolver } from './lantern-host-origin';
import type { HostAnswer } from './lantern-host-request';
import type { LanternPr } from './lantern-types';

const HOST_TTL_MS = 5 * 60 * 1000;
const MAX_PARALLEL = 4;
const MAX_PROJECTS = 32;
const MAX_SETTLED_LOOKUPS = 30;

type Unavailable = 'no-credentials' | 'failed';

const NOTE_KEYS = {
  failed: { plain: 'hostStatus.failed', merged: 'hostStatus.failedMerged' },
  'no-credentials': { plain: 'hostStatus.noAccount', merged: 'hostStatus.noAccountMerged' },
} as const;

const noteOf = (unavailable: Unavailable, provider: CodeHostId) => msg(NOTE_KEYS[unavailable][DRIVERS[provider].asks('merged') ? 'merged' : 'plain'], { provider: PROVIDERS[provider].name });

interface HostStatusOptions {
  baseUrl?: string;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  account?: AccountLookup;
  resolveHostname?: HostnameResolver;
  fetchAvatar?: typeof fetch;
}

interface Entry extends HostAnswer {
  at: number;
}

interface ProjectStatus {
  provider: CodeHostId | null;
  entries: Map<string, Entry>;
  unavailable: Unavailable | null;
  pausedUntil: number;
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
    const created: ProjectStatus = { provider: null, entries: new Map(), unavailable: null, pausedUntil: Number.NEGATIVE_INFINITY, version: 0 };
    projects.set(root, created);
    while (projects.size > MAX_PROJECTS) projects.delete(projects.keys().next().value as string);
    return created;
  }

  function signature(status: ProjectStatus) {
    return `${status.unavailable}|${[...status.entries].map(([id, e]) => JSON.stringify([id, e.state, e.base, e.info?.updated, e.info?.reviewers?.map((r) => [r.approved, r.changes])])).sort().join(',')}`;
  }

  function isFresh(entry: Entry | undefined) {
    return !!entry && now() - entry.at < ttlMs;
  }

  function idsToAsk(host: CodeHost, prs: LanternPr[]) {
    const driver = DRIVERS[host.provider];
    const asked = prs.filter((p) => driver.asks(p.state) && recordBelongsTo(host.provider, p.url));
    const open = asked.filter((p) => p.state === 'open');
    const settled = asked.filter((p) => p.state !== 'open').slice(0, MAX_SETTLED_LOOKUPS);
    return [...open, ...settled].map((p) => p.id);
  }

  async function lookupAll(root: string, host: CodeHost, ids: string[], status: ProjectStatus) {
    const driver = DRIVERS[host.provider];
    const credentials = await driver.credentials(root, { account, env: options.env });
    if (!credentials) return 'no-credentials' as const;
    const due = ids.filter((id) => !isFresh(status.entries.get(id)));
    const paused = () => now() < status.pausedUntil;
    if (due.length && paused()) return 'failed' as const;
    const ask = async (id: string) => {
      if (paused()) return [id, null] as const;
      const answer = await driver.fetch(host, id, credentials, options);
      if (answer && isRateLimited(answer)) status.pausedUntil = now() + ttlMs;
      if (!answer || isRateLimited(answer) || !answer.info) return [id, answer] as const;
      return [id, { ...answer, info: await withAvatars(answer.info, options.fetchAvatar) }] as const;
    };
    const answers = await mapInBatches(due, ask, MAX_PARALLEL);
    let failed = false;
    for (const [id, answer] of answers) {
      if (answer && !isRateLimited(answer)) status.entries.set(id, { ...answer, at: now() });
      else failed = true;
    }
    return failed ? ('failed' as const) : null;
  }

  async function run(root: string, prs: LanternPr[], force: boolean) {
    const status = statusOf(root);
    const before = signature(status);
    const host = prs.length ? await codeHostOf(root, options.resolveHostname) : null;
    if (host?.provider !== status.provider) status.entries.clear();
    status.provider = host?.provider ?? null;
    const ids = host ? idsToAsk(host, prs) : [];
    if (force) for (const entry of status.entries.values()) entry.at = Number.NEGATIVE_INFINITY;
    for (const id of status.entries.keys()) if (!ids.includes(id)) status.entries.delete(id);
    status.unavailable = host && ids.length ? await lookupAll(root, host, ids, status) : null;
    if (signature(status) !== before) status.version++;
  }

  function refresh(root: string, prs: LanternPr[], force = false): Promise<void> {
    const inflight = running.get(root);
    if (inflight && !force) return inflight;
    const job = (inflight ?? Promise.resolve()).then(() => run(root, prs, force));
    const settled = job.catch(() => undefined).finally(() => {
      if (running.get(root) === settled) running.delete(root);
    });
    running.set(root, settled);
    return settled;
  }

  function apply(root: string, prs: LanternPr[]): Overlaid {
    const status = projects.get(root);
    const provider = status?.provider;
    if (!status || !provider || !prs.some((p) => DRIVERS[provider].asks(p.state))) return { prs, note: null };
    const next = prs.map((p) => {
      const entry = DRIVERS[provider].asks(p.state) ? status.entries.get(p.id) : undefined;
      if (!entry) return p;
      const info = entry.info ? { info: { ...p.info, ...entry.info } } : {};
      if (entry.state === 'merged' && p.state === 'merged') return { ...p, ...info };
      if (entry.state !== 'open') return { ...withHostState(p, entry.state), ...info };
      if (p.state !== 'open') return { ...withHostState(p, 'open', entry.base), ...info };
      return { ...p, ...(entry.base ? { hostBase: entry.base } : {}), ...info };
    });
    return { prs: next, note: status.unavailable ? noteOf(status.unavailable, provider) : null };
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

function withHostState(pr: LanternPr, state: LanternPr['state'], base?: string): LanternPr {
  const { mergedAt: _mergedAt, ...rest } = pr;
  return { ...rest, state, ...(base ? { hostBase: base } : {}) };
}

type HostStatus = ReturnType<typeof createHostStatus>;

const hostStatus = createHostStatus();

export { createHostStatus, hostStatus, HOST_TTL_MS, noteOf };
export type { HostStatus, HostStatusOptions };
