import { CHECK_FAILURE } from '@shared/auth-kinds';
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTokenInput } from '@shared/auth-input';
import type { TokenInput } from '@shared/auth-input';
import { TokenCheckError, checkToken, describeCheckFailure } from '@main/auth/token-check';
import { startFakeProviders } from './helpers/fake-providers';
import type { FakeProviders } from './helpers/fake-providers';
import { FAKE_ATLASSIAN_TOKEN, FAKE_GITHUB_TOKEN } from './helpers/fake-tokens';

const GITHUB_TOKEN = FAKE_GITHUB_TOKEN;
const ATLASSIAN_TOKEN = FAKE_ATLASSIAN_TOKEN;

function inputFor(provider: TokenInput['provider'], token: string, extra: Record<string, unknown> = {}): TokenInput {
  const parsed = parseTokenInput(provider, { token, email: 'me@acme.test', site: 'https://acme.atlassian.net', ...extra });
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.input;
}

let fake: FakeProviders;

beforeEach(async () => {
  fake = await startFakeProviders();
});

afterEach(async () => {
  await fake.close();
});

const check = (input: TokenInput, timeoutMs = 2000) => checkToken(input, { endpoints: fake.endpoints, timeoutMs });

async function failureOf(run: Promise<unknown>): Promise<TokenCheckError> {
  try {
    await run;
  } catch (err) {
    if (err instanceof TokenCheckError) return err;
    throw err;
  }
  throw new Error('expected the check to fail');
}

describe('GitHub', () => {
  it('calls GET /user with a Bearer token and reads the login, the name, the scopes and the expiry', async () => {
    fake.allow('github', { token: GITHUB_TOKEN, login: 'octo', displayName: 'Octo Cat', scopes: ['repo'], expires: '2026-12-31 10:30:00 UTC' });
    const account = await check(inputFor('github', GITHUB_TOKEN));
    expect(account).toEqual({ login: 'octo', displayName: 'Octo Cat', scopes: ['repo'], expiresAt: Date.UTC(2026, 11, 31, 10, 30, 0) });
    expect(fake.requests).toEqual([{ provider: 'github', method: 'GET', path: '/user', authorization: `Bearer ${GITHUB_TOKEN}` }]);
  });

  it('reads the public e-mail of the account, for the commit identity', async () => {
    fake.allow('github', { token: GITHUB_TOKEN, login: 'octo', displayName: 'Octo Cat', email: 'octo@x.test' });
    expect((await check(inputFor('github', GITHUB_TOKEN))).email).toBe('octo@x.test');
  });

  it('reports no expiry when the header is missing or unreadable', async () => {
    fake.allow('github', { token: GITHUB_TOKEN, login: 'octo', displayName: 'Octo Cat' });
    expect((await check(inputFor('github', GITHUB_TOKEN))).expiresAt).toBeNull();
  });

  it('maps a token without a name to its login', async () => {
    fake.allow('github', { token: GITHUB_TOKEN, login: 'octo', displayName: '' });
    expect((await check(inputFor('github', GITHUB_TOKEN))).displayName).toBe('octo');
  });
});

describe('Bitbucket', () => {
  it('calls GET /2.0/user with Basic email:token, which is what the delegate scripts send', async () => {
    fake.allow('bitbucket', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme', scopes: ['write:pullrequest:bitbucket'] });
    const account = await check(inputFor('bitbucket', ATLASSIAN_TOKEN));
    expect(account).toEqual({ login: 'meacme', displayName: 'Me Acme', scopes: ['write:pullrequest:bitbucket'], expiresAt: null });
    expect(fake.requests[0]).toMatchObject({ path: '/2.0/user', authorization: `Basic ${Buffer.from(`me@acme.test:${ATLASSIAN_TOKEN}`).toString('base64')}` });
  });
});

describe('Jira', () => {
  it('calls GET /rest/api/3/myself with Basic email:token and uses the email as the login', async () => {
    fake.allow('jira', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme' });
    const account = await check(inputFor('jira', ATLASSIAN_TOKEN));
    expect(account).toEqual({ login: 'me@acme.test', displayName: 'Me Acme', scopes: [], expiresAt: null });
    expect(fake.requests[0]).toMatchObject({ path: '/rest/api/3/myself' });
  });

  it('sends the request to the site the endpoints table names, built from the validated site', async () => {
    const seen: string[] = [];
    fake.allow('jira', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme' });
    await checkToken(inputFor('jira', ATLASSIAN_TOKEN), {
      endpoints: { ...fake.endpoints, jira: (site) => (seen.push(site), fake.baseUrl) },
    });
    expect(seen).toEqual(['https://acme.atlassian.net']);
  });
});

describe('failures, for every provider', () => {
  const cases = [
    ['github', GITHUB_TOKEN],
    ['bitbucket', ATLASSIAN_TOKEN],
    ['jira', ATLASSIAN_TOKEN],
  ] as const;

  it.each(cases)('%s: a rejected token is unauthorized', async (provider, token) => {
    const err = await failureOf(check(inputFor(provider, token)));
    expect(err.reason).toBe(CHECK_FAILURE.unauthorized);
  });

  it.each(cases)('%s: 403 is forbidden, 503 and 429 are unavailable', async (provider, token) => {
    fake.mode(provider, { kind: 'status', status: 403 });
    expect((await failureOf(check(inputFor(provider, token)))).reason).toBe(CHECK_FAILURE.forbidden);
    fake.mode(provider, { kind: 'status', status: 503 });
    expect(await failureOf(check(inputFor(provider, token)))).toMatchObject({ reason: CHECK_FAILURE.unavailable, status: 503 });
    fake.mode(provider, { kind: 'status', status: 429 });
    expect((await failureOf(check(inputFor(provider, token)))).reason).toBe(CHECK_FAILURE.unavailable);
  });

  it.each(cases)('%s: an answer that is not the expected JSON is malformed', async (provider, token) => {
    fake.mode(provider, { kind: 'garbage' });
    expect((await failureOf(check(inputFor(provider, token)))).reason).toBe(CHECK_FAILURE.malformed);
  });

  it.each(cases)('%s: a redirect is never followed and counts as malformed', async (provider, token) => {
    fake.mode(provider, { kind: 'redirect' });
    expect((await failureOf(check(inputFor(provider, token)))).reason).toBe(CHECK_FAILURE.malformed);
  });

  it.each(cases)('%s: a server that never answers times out', async (provider, token) => {
    fake.mode(provider, { kind: 'hang' });
    expect((await failureOf(check(inputFor(provider, token), 60))).reason).toBe(CHECK_FAILURE.timeout);
  });

  it('a server that is not there is a network failure', async () => {
    const port = Number(new URL(fake.baseUrl).port);
    await fake.close();
    const dead = { github: `http://127.0.0.1:${port}`, bitbucket: `http://127.0.0.1:${port}`, jira: () => `http://127.0.0.1:${port}` };
    const err = await failureOf(checkToken(inputFor('github', GITHUB_TOKEN), { endpoints: dead, timeoutMs: 2000 }));
    expect(err.reason).toBe(CHECK_FAILURE.network);
    fake = await startFakeProviders();
  });

  it('a 200 without a login is malformed', async () => {
    fake.allow('github', { token: GITHUB_TOKEN, login: '', displayName: 'x' });
    expect((await failureOf(check(inputFor('github', GITHUB_TOKEN)))).reason).toBe(CHECK_FAILURE.malformed);
  });
});

describe('failure messages', () => {
  const reasons = Object.values(CHECK_FAILURE);

  it('are plain sentences that never contain the token, the email or the address', () => {
    for (const provider of PROVIDER_IDS) {
      for (const reason of reasons) {
        const message = describeCheckFailure(provider, new TokenCheckError(reason, 502));
        expect(message.length).toBeGreaterThan(20);
        expect(message).not.toMatch(/ghp_|ATATT|@|https?:/);
        expect(message).not.toMatch(/[{}]/);
      }
    }
  });

  it('name the provider for every failure', () => {
    for (const provider of PROVIDER_IDS) {
      for (const reason of reasons) expect(describeCheckFailure(provider, new TokenCheckError(reason, 502)), `${provider} ${reason}`).toContain(PROVIDERS[provider].name);
    }
  });

  it('name the status of an unavailable provider and the wait of a timeout', () => {
    expect(describeCheckFailure('github', new TokenCheckError(CHECK_FAILURE.unavailable, 503))).toContain('503');
    expect(describeCheckFailure('jira', new TokenCheckError(CHECK_FAILURE.timeout), 10_000)).toContain('10 seconds');
  });
});

describe('Jira scoped tokens', () => {
  const SITE_HOST = 'https://acme.atlassian.net';
  const GATEWAY = 'https://gateway.test';
  const CLOUD_ID = 'c0ffee-cloud-id';
  const BASIC = `Basic ${Buffer.from(`me@acme.test:${ATLASSIAN_TOKEN}`).toString('base64')}`;
  const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const ACCOUNT = { accountId: 'acct-1', displayName: 'Me Acme' };
  const SITE_ME = `${SITE_HOST}/rest/api/3/myself`;
  const TENANT = `${SITE_HOST}/_edge/tenant_info`;
  const GATEWAY_ME = `${GATEWAY}/ex/jira/${CLOUD_ID}/rest/api/3/myself`;

  function scripted(answers: Record<string, () => Response>) {
    const calls: { url: string; authorization: string | undefined; redirect: RequestRedirect | undefined }[] = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, authorization: (init.headers as Record<string, string>).Authorization, redirect: init.redirect });
      const answer = answers[url];
      if (!answer) throw new Error('unexpected request');
      return answer();
    }) as unknown as typeof fetch;
    return { calls, run: () => checkToken(inputFor('jira', ATLASSIAN_TOKEN), { gateway: GATEWAY, fetch: send, timeoutMs: 2000 }) };
  }

  it('site 401 + tenant info + gateway 200 is a connected account', async () => {
    const world = scripted({ [SITE_ME]: () => json(401), [TENANT]: () => json(200, { cloudId: CLOUD_ID }), [GATEWAY_ME]: () => json(200, ACCOUNT) });
    expect(await world.run()).toEqual({ login: 'me@acme.test', displayName: 'Me Acme', scopes: [], expiresAt: null });
    expect(world.calls.map((call) => call.url)).toEqual([SITE_ME, TENANT, GATEWAY_ME]);
    expect(world.calls[2].authorization).toBe(BASIC);
    expect(world.calls[1].authorization).toBeUndefined();
    expect(world.calls.every((call) => call.redirect === 'manual')).toBe(true);
  });

  it('site 401 + gateway 401 is unauthorized', async () => {
    const world = scripted({ [SITE_ME]: () => json(401), [TENANT]: () => json(200, { cloudId: CLOUD_ID }), [GATEWAY_ME]: () => json(401) });
    expect((await failureOf(world.run())).reason).toBe(CHECK_FAILURE.unauthorized);
  });

  it('site 200 makes no second call', async () => {
    const world = scripted({ [SITE_ME]: () => json(200, ACCOUNT) });
    await world.run();
    expect(world.calls).toHaveLength(1);
  });

  it('a site answer other than 401 makes no second call', async () => {
    const world = scripted({ [SITE_ME]: () => json(403) });
    expect((await failureOf(world.run())).reason).toBe(CHECK_FAILURE.forbidden);
    expect(world.calls).toHaveLength(1);
  });

  it.each([
    ['an error status', () => json(500)],
    ['no cloud id', () => json(200, {})],
    ['an answer that is not JSON', () => new Response('<html>', { status: 200 })],
  ])('tenant info with %s leaves the check unauthorized', async (_what, tenant) => {
    const world = scripted({ [SITE_ME]: () => json(401), [TENANT]: tenant });
    expect((await failureOf(world.run())).reason).toBe(CHECK_FAILURE.unauthorized);
    expect(world.calls).toHaveLength(2);
  });

  it('a failing tenant lookup is unauthorized, and no error carries the token', async () => {
    const send = (async (url: string) => {
      if (url === SITE_ME) return json(401);
      throw new Error(`boom ${ATLASSIAN_TOKEN}`);
    }) as unknown as typeof fetch;
    const err = await failureOf(checkToken(inputFor('jira', ATLASSIAN_TOKEN), { gateway: GATEWAY, fetch: send }));
    expect(err.reason).toBe(CHECK_FAILURE.unauthorized);
    expect(`${err.message} ${err.stack ?? ''} ${describeCheckFailure('jira', err)}`).not.toContain(ATLASSIAN_TOKEN);
  });

  it('a gateway transport failure never leaks the token either', async () => {
    const send = (async (url: string) => {
      if (url === SITE_ME) return json(401);
      if (url === TENANT) return json(200, { cloudId: CLOUD_ID });
      throw new Error(`boom ${ATLASSIAN_TOKEN}`);
    }) as unknown as typeof fetch;
    const err = await failureOf(checkToken(inputFor('jira', ATLASSIAN_TOKEN), { gateway: GATEWAY, fetch: send }));
    expect(err.reason).toBe(CHECK_FAILURE.network);
    expect(`${err.message} ${err.stack ?? ''}`).not.toContain(ATLASSIAN_TOKEN);
  });
});
