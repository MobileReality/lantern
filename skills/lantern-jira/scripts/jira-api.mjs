import { createHttp } from './http.mjs';

const ROUTES = Object.freeze({
  gateway: 'https://api.atlassian.com/ex/jira',
  tenantInfoPath: '/_edge/tenant_info',
  rejected: 401,
});
const ACCEPT = Object.freeze({ Accept: 'application/json', 'Accept-Language': 'en' });

export const REST = '/rest/api/3';

export function createJiraApi({ site, email, token, fetch, redact }) {
  const http = createHttp({ fetch, redact });
  const headers = { ...ACCEPT, Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` };
  let bases;

  async function lookupCloudId() {
    try {
      const tenant = await http.request('GET', `${site}${ROUTES.tenantInfoPath}`, { headers: ACCEPT });
      return tenant.ok && typeof tenant.data?.cloudId === 'string' && tenant.data.cloudId ? tenant.data.cloudId : null;
    } catch {
      return null;
    }
  }

  async function resolveBases() {
    const id = await lookupCloudId();
    return id ? [`${ROUTES.gateway}/${encodeURIComponent(id)}`, site] : [site];
  }

  async function call(method, path, body) {
    bases ??= await resolveBases();
    const first = await http.request(method, `${bases[0]}${path}`, { headers, body });
    if (first.status !== ROUTES.rejected || bases.length < 2) return first;
    bases.shift();
    return http.request(method, `${bases[0]}${path}`, { headers, body });
  }

  return {
    site,
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
  };
}
