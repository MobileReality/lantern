import { createHttp } from './http.mjs';

export const API = 'https://api.github.com';

export function createGithubApi({ token, fetch, redact }) {
  const http = createHttp({ fetch, redact });
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'lantern-github',
    Authorization: `Bearer ${token}`,
  };
  return {
    get: (path) => http.request('GET', `${API}${path}`, { headers }),
    post: (path, body) => http.request('POST', `${API}${path}`, { headers, body }),
    patch: (path, body) => http.request('PATCH', `${API}${path}`, { headers, body }),
  };
}
