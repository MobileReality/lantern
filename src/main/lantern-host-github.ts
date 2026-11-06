import type { CodeHost } from './lantern-host-origin';
import { PR_ID, REQUEST_TIMEOUT_MS, getReply, isBranchName, parseBody } from './lantern-host-request';
import type { HostAnswer, HostState, Reply, RequestOptions } from './lantern-host-request';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'Lantern';
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_FORBIDDEN = 403;

interface RateLimited {
  rateLimited: true;
}

type GithubLookup = HostAnswer | RateLimited | null;

const isRateLimited = (lookup: GithubLookup): lookup is RateLimited => lookup !== null && 'rateLimited' in lookup;

function fieldsOf(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
}

function githubStateOf(body: unknown): HostState | null {
  const fields = fieldsOf(body);
  if (fields?.state === 'open') return 'open';
  if (fields?.state !== 'closed') return null;
  const mergedAt = fields.merged_at;
  return fields.merged === true || (typeof mergedAt === 'string' && mergedAt !== '') ? 'merged' : 'declined';
}

function githubBaseOf(body: unknown): string | null {
  const base = fieldsOf(fieldsOf(body)?.base);
  const name = typeof base?.ref === 'string' ? base.ref.trim() : '';
  return isBranchName(name) ? name : null;
}

function pullUrl(baseUrl: string, repo: CodeHost, id: string) {
  return `${baseUrl.replace(/\/+$/, '')}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${id}`;
}

function limitedBy(reply: Reply) {
  if (reply.status === HTTP_TOO_MANY_REQUESTS) return true;
  return reply.status === HTTP_FORBIDDEN && (reply.headers.get('x-ratelimit-remaining') === '0' || reply.headers.has('retry-after'));
}

async function fetchGithubState(repo: CodeHost, id: string, token: string, options: RequestOptions = {}): Promise<GithubLookup> {
  if (!PR_ID.test(id)) return null;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': GITHUB_API_VERSION, 'User-Agent': USER_AGENT };
  try {
    const reply = await getReply(pullUrl(options.baseUrl ?? GITHUB_API, repo, id), headers, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    if (reply && limitedBy(reply)) return { rateLimited: true };
    const body = parseBody(reply);
    const state = githubStateOf(body);
    if (!state) return null;
    const base = githubBaseOf(body);
    return base ? { state, base } : { state };
  } catch {
    return null;
  }
}

export { fetchGithubState, githubBaseOf, githubStateOf, isRateLimited, GITHUB_API };
export type { GithubLookup, RateLimited };
