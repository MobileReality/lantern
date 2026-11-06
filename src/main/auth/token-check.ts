import type { TokenInput } from '@shared/auth-input';
import { CHECK_FAILURE } from '@shared/auth-kinds';
import type { CheckFailure } from '@shared/auth-kinds';
import { msg } from '@shared/lang/messages';
import { PROVIDER, PROVIDERS, TOKEN_FIELD } from './providers';
import type { ProviderId } from './providers';

class TokenCheckError extends Error {
  constructor(
    readonly reason: CheckFailure,
    readonly status?: number,
  ) {
    super(reason);
    this.name = 'TokenCheckError';
  }
}

interface CheckedAccount {
  login: string;
  displayName: string;
  scopes: string[];
  expiresAt: number | null;
  email?: string | null;
}

type Endpoints = { [K in ProviderId]: K extends typeof PROVIDER.jira ? (site: string) => string : string };

interface CheckDeps {
  endpoints?: Endpoints;
  gateway?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_ENDPOINTS: Endpoints = { [PROVIDER.github]: 'https://api.github.com', [PROVIDER.bitbucket]: 'https://api.bitbucket.org', [PROVIDER.jira]: (site) => site };
const DEFAULT_GATEWAY = `https://${PROVIDERS[PROVIDER.jira].hosts.find((host) => host.startsWith('api.'))}`;
const CHECK_TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 1_000_000;
const GITHUB_EXPIRY_HEADER = 'github-authentication-token-expiration';
const GITHUB_EXPIRY = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/;

const basic = (email: string, token: string) => `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

interface CheckRequest {
  url: string;
  headers: Record<string, string>;
}

const COMMON_HEADERS = { 'User-Agent': 'Lantern', Accept: 'application/json' };

const REQUESTS: { [K in ProviderId]: (input: TokenInput, endpoints: Endpoints) => CheckRequest } = {
  [PROVIDER.github]: (input, endpoints) => ({
    url: `${endpoints[PROVIDER.github]}/user`,
    headers: { ...COMMON_HEADERS, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${input.token}` },
  }),
  [PROVIDER.bitbucket]: (input, endpoints) => ({
    url: `${endpoints[PROVIDER.bitbucket]}/2.0/user`,
    headers: { ...COMMON_HEADERS, Authorization: basic(input.email ?? '', input.token) },
  }),
  [PROVIDER.jira]: (input, endpoints) => ({
    url: `${endpoints[PROVIDER.jira](input.site ?? '')}/rest/api/3/myself`,
    headers: { ...COMMON_HEADERS, Authorization: basic(input.email ?? '', input.token) },
  }),
};

interface RetryContext {
  endpoints: Endpoints;
  gateway: string;
  call: (request: CheckRequest) => Promise<Response>;
}

const TENANT_INFO_PATH = '/_edge/tenant_info';

const RETRIES: { [K in ProviderId]?: (input: TokenInput, context: RetryContext) => Promise<CheckRequest | null> } = {
  [PROVIDER.jira]: async (input, { endpoints, gateway, call }) => {
    let cloudId: string | null = null;
    try {
      const tenant = await call({ url: `${endpoints[PROVIDER.jira](input.site ?? '')}${TENANT_INFO_PATH}`, headers: COMMON_HEADERS });
      cloudId = tenant.ok ? text((await parseBody(tenant)).cloudId) : null;
    } catch {}
    if (!cloudId) return null;
    const { headers } = REQUESTS[PROVIDER.jira](input, endpoints);
    return { url: `${gateway}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/myself`, headers };
  },
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

function scopesOf(headers: Headers): string[] {
  return (headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function githubExpiry(headers: Headers): number | null {
  const match = GITHUB_EXPIRY.exec(headers.get(GITHUB_EXPIRY_HEADER) ?? '');
  const at = match ? Date.parse(`${match[1]}T${match[2]}Z`) : Number.NaN;
  return Number.isNaN(at) ? null : at;
}

type AccountReader = (body: Record<string, unknown>, headers: Headers, email: string | null) => CheckedAccount;

const malformed = (): never => {
  throw new TokenCheckError(CHECK_FAILURE.malformed);
};

const ACCOUNT_READERS: { [K in ProviderId]: AccountReader } = {
  [PROVIDER.github]: (body, headers) => {
    const login = text(body.login) ?? malformed();
    return { login, displayName: text(body.name) ?? login, scopes: scopesOf(headers), expiresAt: githubExpiry(headers), ...(text(body.email) ? { email: text(body.email) } : {}) };
  },
  [PROVIDER.bitbucket]: (body, headers) => {
    const login = text(body.nickname) ?? text(body.account_id) ?? malformed();
    return { login, displayName: text(body.display_name) ?? login, scopes: scopesOf(headers), expiresAt: null };
  },
  [PROVIDER.jira]: (body, _headers, email) => {
    const login = text(body.accountId) && email ? email : malformed();
    return { login, displayName: text(body.displayName) ?? login, scopes: [], expiresAt: null };
  },
};

function failureOf(status: number): TokenCheckError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return new TokenCheckError(CHECK_FAILURE.unauthorized, status);
  if (status === 403) return new TokenCheckError(CHECK_FAILURE.forbidden, status);
  if (status === 429 || status >= 500) return new TokenCheckError(CHECK_FAILURE.unavailable, status);
  return new TokenCheckError(CHECK_FAILURE.malformed, status);
}

async function parseBody(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (raw.length > MAX_BODY_CHARS) throw new TokenCheckError(CHECK_FAILURE.malformed, response.status);
  try {
    const body: unknown = JSON.parse(raw);
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  throw new TokenCheckError(CHECK_FAILURE.malformed, response.status);
}

const transportFailure = (err: unknown) => new TokenCheckError(err instanceof Error && err.name === 'TimeoutError' ? CHECK_FAILURE.timeout : CHECK_FAILURE.network);

async function checkToken(input: TokenInput, { endpoints = DEFAULT_ENDPOINTS, gateway = DEFAULT_GATEWAY, fetch: send = fetch, timeoutMs = CHECK_TIMEOUT_MS }: CheckDeps = {}): Promise<CheckedAccount> {
  const call = ({ url, headers }: CheckRequest) => send(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  let response: Response;
  try {
    response = await call(REQUESTS[input.provider](input, endpoints));
    const retry = response.status === 401 ? await RETRIES[input.provider]?.(input, { endpoints, gateway, call }) : null;
    if (retry) response = await call(retry);
  } catch (err) {
    throw transportFailure(err);
  }
  const failure = failureOf(response.status);
  if (failure) throw failure;
  try {
    return ACCOUNT_READERS[input.provider](await parseBody(response), response.headers, input.email);
  } catch (err) {
    throw err instanceof TokenCheckError ? err : transportFailure(err);
  }
}

interface FailureContext {
  provider: string;
  asksForEmail: boolean;
  status?: number;
  seconds: number;
}

const FAILURE_MESSAGES: { [K in CheckFailure]: (context: FailureContext) => string } = {
  [CHECK_FAILURE.unauthorized]: ({ provider, asksForEmail }) => msg(asksForEmail ? 'auth.check.unauthorizedEmail' : 'auth.check.unauthorizedToken', { provider }),
  [CHECK_FAILURE.forbidden]: ({ provider }) => msg('auth.check.forbidden', { provider }),
  [CHECK_FAILURE.unavailable]: ({ provider, status }) => msg('auth.check.unavailable', { provider, status: status ?? 'unknown' }),
  [CHECK_FAILURE.timeout]: ({ provider, seconds }) => msg('auth.check.timeout', { provider, seconds }),
  [CHECK_FAILURE.network]: ({ provider }) => msg('auth.check.network', { provider }),
  [CHECK_FAILURE.malformed]: ({ provider, status }) => (status ? msg('auth.check.malformedStatus', { provider, status }) : msg('auth.check.malformed', { provider })),
};

function describeCheckFailure(provider: ProviderId, err: TokenCheckError, timeoutMs = CHECK_TIMEOUT_MS): string {
  const { name, tokenFields } = PROVIDERS[provider];
  return FAILURE_MESSAGES[err.reason]({ provider: name, asksForEmail: tokenFields.includes(TOKEN_FIELD.email), status: err.status, seconds: Math.round(timeoutMs / 1000) });
}

export { checkToken, describeCheckFailure, TokenCheckError, DEFAULT_ENDPOINTS, CHECK_TIMEOUT_MS };
export type { CheckedAccount, CheckFailure, Endpoints, CheckDeps };
