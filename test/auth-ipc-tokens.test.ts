import { AUTH_ERROR, CHECK_FAILURE } from '@shared/auth-kinds';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Auth } from '@main/auth';
import { createAuthHandlers } from '@main/auth/ipc';
import { PROJECT, ipcWorld, keysDeep } from './helpers/auth-ipc-world';
import { startFakeProviders } from './helpers/fake-providers';
import type { FakeProviders } from './helpers/fake-providers';
import { FAKE_ATLASSIAN_TOKEN, FAKE_GITHUB_TOKEN } from './helpers/fake-tokens';

const GITHUB_TOKEN = FAKE_GITHUB_TOKEN;
const ATLASSIAN_TOKEN = FAKE_ATLASSIAN_TOKEN;
const SECRET_KEY = /token|secret|password|code|verifier/i;

let fake: FakeProviders;

beforeEach(async () => {
  fake = await startFakeProviders();
  fake.allow('github', { token: GITHUB_TOKEN, login: 'octo', displayName: 'Octo Cat', expires: '2026-12-31 10:30:00 UTC' });
  fake.allow('jira', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme' });
});

afterEach(async () => {
  await fake.close();
});

const world = () => ipcWorld({ check: { endpoints: fake.endpoints, timeoutMs: 1500 }, host: { provider: 'github', owner: 'acme', repo: 'shop' } });

describe('auth:add-token', () => {
  it('checks, stores and replies with the profile and nothing else', async () => {
    const { call, pushes } = await world();
    pushes.length = 0;
    const reply = await call('auth:add-token', { provider: 'github', token: GITHUB_TOKEN, nickname: 'Octo work' });
    expect(Object.keys(reply).sort()).toEqual(['created', 'ok', 'profile']);
    expect(reply).toMatchObject({ ok: true, created: true, profile: { provider: 'github', login: 'octo', nickname: 'Octo work', kind: 'static' } });
    expect(pushes).toContainEqual({ channel: 'auth:changed', payload: { provider: 'github' } });
  });

  it('is available to the Atlassian providers with their own fields', async () => {
    const { call } = await world();
    const reply = await call('auth:add-token', { provider: 'jira', site: 'acme.atlassian.net', email: 'me@acme.test', token: ATLASSIAN_TOKEN });
    expect(reply).toMatchObject({ ok: true, profile: { provider: 'jira', site: 'https://acme.atlassian.net', email: 'me@acme.test' } });
  });

  it('says what went wrong and stores nothing when the provider says no', async () => {
    const { call, auth } = await world();
    const reply = await call('auth:add-token', { provider: 'github', token: 'ghp_notaknowntokennotaknowntokennotakno' });
    expect(reply).toMatchObject({ ok: false, error: AUTH_ERROR.checkFailed, reason: CHECK_FAILURE.unauthorized, message: expect.stringContaining('GitHub rejected this token') });
    expect(auth.status().providers.github.profiles.map((profile) => profile.login)).toEqual(['work', 'home']);
  });

  it('refuses a request that is not shaped right without calling any provider', async () => {
    const { call } = await world();
    for (const arg of [null, 'token', 12, [], { provider: 'gitlab', token: GITHUB_TOKEN }, { token: GITHUB_TOKEN }]) {
      expect(await call('auth:add-token', arg)).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
    }
    expect(await call('auth:add-token', { provider: 'jira', site: 'https://evil.test', email: 'a@b.test', token: ATLASSIAN_TOKEN })).toMatchObject({ ok: false, error: AUTH_ERROR.invalidInput, field: 'site' });
    expect(fake.requests).toEqual([]);
  });

  it('does nothing for a caller that is not our workspace page', async () => {
    const { call, trustedContents, mainFrame } = await world();
    expect(await call('auth:add-token', { provider: 'github', token: GITHUB_TOKEN }, { sender: {}, senderFrame: mainFrame })).toBeUndefined();
    expect(await call('auth:add-token', { provider: 'github', token: GITHUB_TOKEN }, { sender: trustedContents, senderFrame: { url: mainFrame.url } })).toBeUndefined();
    mainFrame.url = 'https://evil.test/renderer/workspace.html';
    expect(await call('auth:add-token', { provider: 'github', token: GITHUB_TOKEN })).toBeUndefined();
    expect(fake.requests).toEqual([]);
  });

  it('turns an unexpected failure into a fixed sentence that cannot carry the token', async () => {
    const handlers = createAuthHandlers({ addToken: async () => Promise.reject(new Error(`boom with ${GITHUB_TOKEN}`)) } as unknown as Auth);
    const reply = await handlers.addToken({ provider: 'github', token: GITHUB_TOKEN });
    expect(reply).toMatchObject({ ok: false, error: AUTH_ERROR.storageFailed });
    expect(JSON.stringify(reply)).not.toContain(GITHUB_TOKEN);
  });
});

describe('auth:rename-profile and auth:set-expiry', () => {
  it('rename the account and set or clear a manual expiry', async () => {
    const { call, work } = await world();
    expect(await call('auth:rename-profile', { profileId: work.id, nickname: 'Laptop' })).toMatchObject({ ok: true, profile: { id: work.id, nickname: 'Laptop' } });
    expect(await call('auth:set-expiry', { profileId: work.id, expiresOn: '2027-03-01' })).toMatchObject({ ok: true, profile: { expirySource: 'manual' } });
    expect(await call('auth:set-expiry', { profileId: work.id, expiresOn: null })).toMatchObject({ ok: true, profile: { expiresAt: null } });
  });

  it.each([
    ['auth:rename-profile', null],
    ['auth:rename-profile', { profileId: '../x', nickname: 'a' }],
    ['auth:rename-profile', { profileId: { $ne: 1 }, nickname: 'a' }],
    ['auth:set-expiry', 'profile-1'],
    ['auth:set-expiry', { profileId: 'profile-1' }],
    ['auth:set-expiry', { profileId: 'a b', expiresOn: null }],
  ])('rejects malformed input to %s: %j', async (channel, arg) => {
    const { call } = await world();
    expect(await call(channel, arg)).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
  });

  it('answers an unknown account with a code', async () => {
    const { call } = await world();
    expect(await call('auth:rename-profile', { profileId: 'nope', nickname: 'a' })).toEqual({ ok: false, error: AUTH_ERROR.unknownProfile });
    expect(await call('auth:set-expiry', { profileId: 'nope', expiresOn: null })).toEqual({ ok: false, error: AUTH_ERROR.unknownProfile });
  });
});

describe('auth:project', () => {
  it('answers the host, the slots and the candidates of a project', async () => {
    const { call } = await world();
    const reply = await call('auth:project', PROJECT);
    expect(reply).toMatchObject({ ok: true, project: { project: PROJECT, host: { provider: 'github', owner: 'acme', repo: 'shop' } } });
    expect(reply.project.slots.map((slot: { provider: string; binding: string }) => [slot.provider, slot.binding])).toEqual([['github', 'choose'], ['bitbucket', 'none'], ['jira', 'none']]);
  });

  it.each([undefined, null, 5, 'relative/dir', '/work/\0evil', `/${'a'.repeat(5000)}`])('rejects the project %j', async (arg) => {
    const { call } = await world();
    expect(await call('auth:project', arg)).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
  });
});

describe('no reply and no push carries a token', () => {
  it('has no token-like key and none of the pasted values in any reply of any channel', async () => {
    const { call, pushes, work } = await world();
    const replies = [
      await call('auth:add-token', { provider: 'github', token: GITHUB_TOKEN }),
      await call('auth:add-token', { provider: 'jira', site: 'https://acme.atlassian.net', email: 'me@acme.test', token: ATLASSIAN_TOKEN }),
      await call('auth:add-token', { provider: 'github', token: `${GITHUB_TOKEN}-wrong` }),
      await call('auth:add-token', { provider: 'jira', site: 'https://evil.test', email: 'me@acme.test', token: ATLASSIAN_TOKEN }),
      await call('auth:rename-profile', { profileId: work.id, nickname: 'Renamed' }),
      await call('auth:set-expiry', { profileId: work.id, expiresOn: '2027-03-01' }),
      await call('auth:project', PROJECT),
      await call('auth:status', PROJECT),
      await call('auth:status'),
      await call('auth:bind', { provider: 'github', profileId: work.id, project: PROJECT }),
      await call('auth:unbind', { provider: 'github', project: PROJECT }),
    ];
    const everything = JSON.stringify([replies, pushes]);
    for (const secret of [GITHUB_TOKEN, ATLASSIAN_TOKEN, 'github-access-', 'github-refresh-']) expect(everything).not.toContain(secret);
    expect(keysDeep([replies, pushes]).filter((key) => SECRET_KEY.test(key))).toEqual([]);
  });

  it('lists only the names of the credential variables that exist, never their values', async () => {
    const { call } = await ipcWorld({ host: { provider: 'bitbucket', owner: 'acme', repo: 'shop' }, fileNames: ['BITBUCKET_EMAIL'], env: { BITBUCKET_API_TOKEN: 'the-env-value-xyz' } });
    const reply = await call('auth:project', PROJECT);
    expect(reply.project.slots[0]).toMatchObject({ inProjectFile: ['BITBUCKET_EMAIL'], inEnvironment: ['BITBUCKET_API_TOKEN'], winner: 'environment' });
    expect(JSON.stringify(reply)).not.toContain('the-env-value-xyz');
  });
});
