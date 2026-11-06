import { createHttp } from './http.mjs';

export const API = 'https://api.bitbucket.org/2.0';

const SCOPES_HEADER = 'x-oauth-scopes';

export function createBitbucketApi({ email, token, fetch, redact }) {
  let lastScopes = '';
  const capture = async (...request) => {
    const response = await fetch(...request);
    lastScopes = response.headers?.get?.(SCOPES_HEADER) ?? '';
    return response;
  };
  const http = createHttp({ fetch: capture, redact });
  const headers = { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` };
  return {
    get: (path) => http.request('GET', `${API}${path}`, { headers }),
    post: (path, body) => http.request('POST', `${API}${path}`, { headers, body }),
    put: (path, body) => http.request('PUT', `${API}${path}`, { headers, body }),
    scopes: () => lastScopes.split(',').map((scope) => scope.trim()).filter(Boolean),
  };
}
