import { hasControlCharacter } from '../shared/control-characters';
import type { HostCredentials } from './lantern-host-credentials';
import type { BitbucketRepo } from './lantern-host-origin';

const BITBUCKET_API = 'https://api.bitbucket.org/2.0';
const REQUEST_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 2;
const MAX_BODY_CHARS = 2_000_000;
const PR_ID = /^[0-9]{1,12}$/;

type HostState = 'open' | 'merged' | 'declined';

interface HostAnswer {
  state: HostState;
  base?: string;
}

interface RequestOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

const STATE_BY_HOST: Record<string, HostState> = { OPEN: 'open', DECLINED: 'declined', SUPERSEDED: 'declined', MERGED: 'merged' };

function hostStateOf(body: unknown): HostState | null {
  const raw = typeof body === 'object' && body !== null ? (body as { state?: unknown }).state : undefined;
  return typeof raw === 'string' ? (STATE_BY_HOST[raw.toUpperCase()] ?? null) : null;
}

const BRANCH_NAME_MAX_LENGTH = 255;
const STARTS_WITH_NON_SPACE = /^\S/;

function isBranchName(name: string): boolean {
  return name.length > 0 && name.length <= BRANCH_NAME_MAX_LENGTH && STARTS_WITH_NON_SPACE.test(name) && !hasControlCharacter(name);
}

function hostBaseOf(body: unknown): string | null {
  const destination = typeof body === 'object' && body !== null ? (body as { destination?: unknown }).destination : undefined;
  const branch = typeof destination === 'object' && destination !== null ? (destination as { branch?: unknown }).branch : undefined;
  const name = typeof branch === 'object' && branch !== null ? (branch as { name?: unknown }).name : undefined;
  return typeof name === 'string' && isBranchName(name.trim()) ? name.trim() : null;
}

function pullRequestUrl(baseUrl: string, repo: BitbucketRepo, id: string) {
  const root = baseUrl.replace(/\/+$/, '');
  return `${root}/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pullrequests/${id}`;
}

function sameOriginTarget(location: string | null, from: string): string | null {
  if (!location) return null;
  try {
    const next = new URL(location, from);
    return next.origin === new URL(from).origin ? next.href : null;
  } catch {
    return null;
  }
}

function basicAuth({ email, token }: HostCredentials) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

async function discard(res: Response) {
  try {
    await res.body?.cancel();
  } catch {
    // the connection is dropped either way
  }
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs);
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(target, { headers, redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      const next = sameOriginTarget(res.headers.get('location'), target);
      await discard(res);
      if (!next) return null;
      target = next;
      continue;
    }
    if (!res.ok) {
      await discard(res);
      return null;
    }
    const text = await res.text();
    return text.length > MAX_BODY_CHARS ? null : JSON.parse(text);
  }
  return null;
}

async function fetchHostState(repo: BitbucketRepo, id: string, credentials: HostCredentials, options: RequestOptions = {}): Promise<HostAnswer | null> {
  if (!PR_ID.test(id)) return null;
  const url = pullRequestUrl(options.baseUrl ?? BITBUCKET_API, repo, id);
  try {
    const body = await getJson(url, { Authorization: basicAuth(credentials), Accept: 'application/json' }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const state = hostStateOf(body);
    if (!state) return null;
    const base = hostBaseOf(body);
    return base ? { state, base } : { state };
  } catch {
    return null;
  }
}

export { fetchHostState, hostBaseOf, hostStateOf, BITBUCKET_API, REQUEST_TIMEOUT_MS };
export type { HostAnswer, HostState, RequestOptions };
