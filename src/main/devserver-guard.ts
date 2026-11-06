import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

const TOKEN_BYTES = 32;
const TOKEN_HEADER = 'x-lantern-debug-token';
const TOKEN_PARAM = 'token';
const ALLOWED_METHODS = new Set(['GET', 'POST']);
const SAME_USER_FETCH = 'none';

const REFUSAL = { UNAUTHORIZED: 401, FORBIDDEN: 403, METHOD_NOT_ALLOWED: 405 } as const;

interface GuardInput {
  method: string | undefined;
  headers: IncomingHttpHeaders;
  url: URL;
  port: number;
  token: string;
}

function newDebugToken() {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function tokenMatches(given: string | undefined, token: string) {
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(token));
}

function hasLoopbackHost(host: string | undefined, port: number) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

// A browser page sends Origin on cross-origin fetches and Sec-Fetch-Site on every request it makes,
// <img> and <script> included; a terminal client sends neither.
function comesFromAPage(headers: IncomingHttpHeaders) {
  const site = headers['sec-fetch-site'];
  return headers.origin !== undefined || (site !== undefined && site !== SAME_USER_FETCH);
}

function refusalFor({ method, headers, url, port, token }: GuardInput): number | null {
  if (!hasLoopbackHost(headers.host, port)) return REFUSAL.FORBIDDEN;
  if (comesFromAPage(headers)) return REFUSAL.FORBIDDEN;
  if (!method || !ALLOWED_METHODS.has(method)) return REFUSAL.METHOD_NOT_ALLOWED;
  const given = headers[TOKEN_HEADER] ?? url.searchParams.get(TOKEN_PARAM) ?? undefined;
  return tokenMatches(Array.isArray(given) ? given[0] : given, token) ? null : REFUSAL.UNAUTHORIZED;
}

export { newDebugToken, refusalFor, REFUSAL, TOKEN_HEADER };
