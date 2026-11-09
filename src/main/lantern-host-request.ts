import { hasControlCharacter } from '../shared/control-characters';
import type { HostCredentials } from './lantern-host-credentials';
import type { BitbucketRepo } from './lantern-host-origin';
import type { LanternPrInfo, LanternPrPerson, LanternPrReviewer } from './lantern-types';

const BITBUCKET_API = 'https://api.bitbucket.org/2.0';
const REQUEST_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 2;
const MAX_BODY_CHARS = 2_000_000;
const PR_ID = /^[0-9]{1,12}$/;

type HostState = 'open' | 'merged' | 'declined';

interface HostAnswer {
  state: HostState;
  base?: string;
  info?: LanternPrInfo;
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

type Json = Record<string, unknown>;

const MAX_NAME = 120;
const MAX_REVIEWERS = 20;

function objectOf(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function textOf(value: unknown, max = MAX_NAME): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function stampOf(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function avatarOf(user: Json): string | undefined {
  const href = objectOf(objectOf(user.links)?.avatar)?.href;
  return typeof href === 'string' && href.startsWith('https://') ? href : undefined;
}

function personOf(value: unknown): LanternPrPerson | null {
  const user = objectOf(value);
  const name = user && (textOf(user.display_name) ?? textOf(user.nickname));
  if (!user || !name) return null;
  const avatar = avatarOf(user);
  return avatar ? { name, avatar } : { name };
}

function userKey(value: unknown) {
  const user = objectOf(value);
  return textOf(user?.uuid) ?? textOf(user?.account_id) ?? textOf(user?.nickname) ?? textOf(user?.display_name) ?? '';
}

function reviewersOf(body: Json): LanternPrReviewer[] {
  const verdicts = new Map<string, Json>();
  for (const p of Array.isArray(body.participants) ? body.participants : []) {
    const participant = objectOf(p);
    if (participant) verdicts.set(userKey(participant.user), participant);
  }
  const hasVoice = (p: Json) => p.role === 'REVIEWER' || p.approved === true || p.state === 'changes_requested';
  const voted = [...verdicts.values()].filter(hasVoice).map((p) => p.user);
  const listed = Array.isArray(body.reviewers) ? body.reviewers : [];
  const users = new Map<string, unknown>();
  for (const user of [...listed, ...voted]) {
    const key = userKey(user);
    if (key && !users.has(key)) users.set(key, user);
  }
  return [...users.values()].slice(0, MAX_REVIEWERS).flatMap((user) => {
    const person = personOf(user);
    if (!person) return [];
    const verdict = verdicts.get(userKey(user));
    return [{ ...person, approved: verdict?.approved === true, changes: verdict?.state === 'changes_requested' }];
  });
}

function hostInfoOf(value: unknown): LanternPrInfo {
  const body = objectOf(value) ?? {};
  const author = personOf(body.author);
  const created = stampOf(body.created_on);
  const updated = stampOf(body.updated_on);
  const comments = countOf(body.comment_count);
  const tasks = countOf(body.task_count);
  return {
    from: 'host',
    ...(author ? { author } : {}),
    ...(created ? { created } : {}),
    ...(updated ? { updated } : {}),
    ...(comments !== undefined ? { comments } : {}),
    ...(tasks !== undefined ? { tasks } : {}),
    reviewers: reviewersOf(body),
    ...(body.draft === true ? { draft: true } : {}),
  };
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

interface Reply {
  ok: boolean;
  status: number;
  headers: Headers;
  text: string;
}

async function getReply(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Reply | null> {
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
      return { ok: false, status: res.status, headers: res.headers, text: '' };
    }
    return { ok: true, status: res.status, headers: res.headers, text: await res.text() };
  }
  return null;
}

function parseBody(reply: Reply | null): unknown {
  return reply?.ok && reply.text.length <= MAX_BODY_CHARS ? JSON.parse(reply.text) : null;
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  return parseBody(await getReply(url, headers, timeoutMs));
}

async function fetchHostState(repo: BitbucketRepo, id: string, credentials: HostCredentials, options: RequestOptions = {}): Promise<HostAnswer | null> {
  if (!PR_ID.test(id)) return null;
  const url = pullRequestUrl(options.baseUrl ?? BITBUCKET_API, repo, id);
  try {
    const body = await getJson(url, { Authorization: basicAuth(credentials), Accept: 'application/json' }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const state = hostStateOf(body);
    if (!state) return null;
    const base = hostBaseOf(body);
    return { state, ...(base ? { base } : {}), info: hostInfoOf(body) };
  } catch {
    return null;
  }
}

export { countOf, fetchHostState, getReply, hostBaseOf, hostInfoOf, hostStateOf, isBranchName, objectOf, parseBody, stampOf, textOf, BITBUCKET_API, MAX_REVIEWERS, PR_ID, REQUEST_TIMEOUT_MS };
export type { HostAnswer, HostState, Reply, RequestOptions };
