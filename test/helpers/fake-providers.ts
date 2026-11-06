import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Endpoints } from '@main/auth/token-check';
import type { ProviderId } from '@shared/providers';

type FakeProvider = ProviderId;
type Mode = { kind: 'ok' } | { kind: 'status'; status: number } | { kind: 'hang' } | { kind: 'garbage' } | { kind: 'redirect' };

interface FakeAccount {
  token: string;
  email?: string;
  login: string;
  displayName: string;
  scopes?: string[];
  expires?: string;
}

interface RecordedRequest {
  provider: FakeProvider;
  method: string;
  path: string;
  authorization: string;
}

const PATHS: Record<string, FakeProvider> = { '/user': 'github', '/2.0/user': 'bitbucket', '/rest/api/3/myself': 'jira' };

const basic = (email: string, token: string) => `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

function expectedHeader(provider: FakeProvider, account: FakeAccount) {
  return provider === 'github' ? `Bearer ${account.token}` : basic(account.email ?? '', account.token);
}

function bodyOf(provider: FakeProvider, account: FakeAccount) {
  if (provider === 'github') return { login: account.login, name: account.displayName, ...(account.email ? { email: account.email } : {}) };
  if (provider === 'bitbucket') return { nickname: account.login, display_name: account.displayName, account_id: `acct-${account.login}` };
  return { accountId: `acct-${account.login}`, displayName: account.displayName, emailAddress: account.email };
}

async function startFakeProviders() {
  const accounts: Record<FakeProvider, FakeAccount[]> = { github: [], bitbucket: [], jira: [] };
  const modes: Record<FakeProvider, Mode> = { github: { kind: 'ok' }, bitbucket: { kind: 'ok' }, jira: { kind: 'ok' } };
  const requests: RecordedRequest[] = [];
  const hanging = new Set<http.ServerResponse>();

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const provider = PATHS[path];
    if (!provider || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    const authorization = String(req.headers.authorization ?? '');
    requests.push({ provider, method: req.method, path, authorization });
    const mode = modes[provider];
    if (mode.kind === 'hang') {
      hanging.add(res);
      return;
    }
    if (mode.kind === 'garbage') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<html>sign in</html>');
      return;
    }
    if (mode.kind === 'redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }).end();
      return;
    }
    if (mode.kind === 'status') {
      res.writeHead(mode.status, { 'content-type': 'application/json' }).end('{"message":"nope"}');
      return;
    }
    const account = accounts[provider].find((entry) => expectedHeader(provider, entry) === authorization);
    if (!account) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"message":"Bad credentials"}');
      return;
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (account.scopes) headers['x-oauth-scopes'] = account.scopes.join(', ');
    if (account.expires) headers['github-authentication-token-expiration'] = account.expires;
    res.writeHead(200, headers).end(JSON.stringify(bodyOf(provider, account)));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const endpoints: Endpoints = { github: baseUrl, bitbucket: baseUrl, jira: () => baseUrl };

  return {
    baseUrl,
    endpoints,
    requests,
    allow: (provider: FakeProvider, account: FakeAccount) => void accounts[provider].push(account),
    mode: (provider: FakeProvider, mode: Mode) => {
      modes[provider] = mode;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const res of hanging) res.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

type FakeProviders = Awaited<ReturnType<typeof startFakeProviders>>;

export { startFakeProviders };
export type { FakeProviders, FakeAccount, FakeProvider, Mode, RecordedRequest };
