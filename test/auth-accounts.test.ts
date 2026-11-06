import { AUTH_ERROR, CHECK_FAILURE } from '@shared/auth-kinds';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthWorld } from './helpers/auth-world';
import { startFakeProviders } from './helpers/fake-providers';
import type { FakeProviders } from './helpers/fake-providers';
import { FAKE_ATLASSIAN_TOKEN, FAKE_GITHUB_TOKEN } from './helpers/fake-tokens';

const GITHUB_TOKEN = FAKE_GITHUB_TOKEN;
const ATLASSIAN_TOKEN = FAKE_ATLASSIAN_TOKEN;
const PROJECT = '/work/shop';

let fake: FakeProviders;

beforeEach(async () => {
  fake = await startFakeProviders();
  fake.allow('github', { token: GITHUB_TOKEN, login: 'octo', displayName: 'Octo Cat', scopes: ['repo'], expires: '2026-12-31 10:30:00 UTC' });
  fake.allow('bitbucket', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme' });
  fake.allow('jira', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme' });
});

afterEach(async () => {
  await fake.close();
});

const world = (timeoutMs = 2000) => createAuthWorld({ check: { endpoints: fake.endpoints, timeoutMs } });

const files = (dir: string) => fs.readdirSync(dir).sort();

describe('auth.addToken', () => {
  it('checks a GitHub token, stores it, and replies with the profile only', async () => {
    const { auth, dir, logs } = world();
    const reply = await auth.addToken({ provider: 'github', token: GITHUB_TOKEN });
    expect(reply).toMatchObject({
      ok: true,
      created: true,
      profile: { provider: 'github', kind: 'static', login: 'octo', displayName: 'Octo Cat', nickname: 'octo', expiresAt: Date.UTC(2026, 11, 31, 10, 30, 0), expirySource: 'provider', state: 'connected' },
    });
    expect(JSON.stringify(reply)).not.toContain(GITHUB_TOKEN);
    expect((await auth.credentialFor('github', PROJECT))?.accessToken).toBe(GITHUB_TOKEN);
    expect(fs.readFileSync(path.join(dir, 'auth-secrets.json'), 'utf8')).not.toContain(GITHUB_TOKEN);
    expect(logs.join('\n')).not.toContain(GITHUB_TOKEN);
  });

  it('keeps the email with a Bitbucket account and the email and site with a Jira one', async () => {
    const { auth } = world();
    const bitbucket = await auth.addToken({ provider: 'bitbucket', email: 'me@acme.test', token: ATLASSIAN_TOKEN });
    const jira = await auth.addToken({ provider: 'jira', email: 'me@acme.test', site: 'acme.atlassian.net', token: ATLASSIAN_TOKEN, nickname: 'Acme tickets' });
    expect(bitbucket).toMatchObject({ ok: true, profile: { email: 'me@acme.test', site: null, login: 'meacme', expiresAt: null } });
    expect(jira).toMatchObject({ ok: true, profile: { email: 'me@acme.test', site: 'https://acme.atlassian.net', login: 'me@acme.test', nickname: 'Acme tickets' } });
    expect(await auth.credentialFor('jira', PROJECT)).toMatchObject({ accessToken: ATLASSIAN_TOKEN, email: 'me@acme.test', site: 'https://acme.atlassian.net' });
  });

  it('keeps a manual expiry only when the provider reports none', async () => {
    const { auth } = world();
    const github = await auth.addToken({ provider: 'github', token: GITHUB_TOKEN, expiresOn: '2027-06-30' });
    const bitbucket = await auth.addToken({ provider: 'bitbucket', email: 'me@acme.test', token: ATLASSIAN_TOKEN, expiresOn: '2027-06-30' });
    expect(github).toMatchObject({ ok: true, profile: { expirySource: 'provider', expiresAt: Date.UTC(2026, 11, 31, 10, 30, 0) } });
    expect(bitbucket).toMatchObject({ ok: true, profile: { expirySource: 'manual', expiresAt: Date.UTC(2027, 5, 30, 23, 59, 59, 999) } });
  });

  it('adds the same account again as an update, keeping the id and the nickname', async () => {
    const { auth } = world();
    const first = await auth.addToken({ provider: 'github', token: GITHUB_TOKEN, nickname: 'Work' });
    const second = await auth.addToken({ provider: 'github', token: GITHUB_TOKEN, nickname: 'Other' });
    expect(second).toMatchObject({ ok: true, created: false });
    if (!first.ok || !second.ok) throw new Error('add failed');
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.profile.nickname).toBe('Work');
    expect(auth.status().providers.github.profiles).toHaveLength(1);
  });

  it('tells listeners which provider changed', async () => {
    const { auth } = world();
    const seen: unknown[] = [];
    auth.onChange((provider) => seen.push(provider));
    await auth.addToken({ provider: 'jira', email: 'me@acme.test', site: 'https://acme.atlassian.net', token: ATLASSIAN_TOKEN });
    expect(seen).toContain('jira');
  });

  describe('when the check fails it stores nothing', () => {
    const cases: [string, () => void, string][] = [
      ['a rejected token', () => undefined, CHECK_FAILURE.unauthorized],
      ['a forbidden token', () => fake.mode('github', { kind: 'status', status: 403 }), CHECK_FAILURE.forbidden],
      ['an unavailable provider', () => fake.mode('github', { kind: 'status', status: 502 }), CHECK_FAILURE.unavailable],
      ['an answer that is not JSON', () => fake.mode('github', { kind: 'garbage' }), CHECK_FAILURE.malformed],
      ['a provider that never answers', () => fake.mode('github', { kind: 'hang' }), CHECK_FAILURE.timeout],
    ];

    it.each(cases)('%s', async (_name, arrange, reason) => {
      arrange();
      const { auth, dir, logs } = world(80);
      const token = reason === CHECK_FAILURE.unauthorized ? 'ghp_wrongwrongwrongwrongwrongwrongwrong00' : GITHUB_TOKEN;
      const reply = await auth.addToken({ provider: 'github', token });
      expect(reply).toMatchObject({ ok: false, error: AUTH_ERROR.checkFailed, reason, message: expect.any(String) });
      expect(JSON.stringify(reply)).not.toContain(token);
      expect(logs.join('\n')).not.toContain(token);
      expect(files(dir)).toEqual([]);
      expect(auth.status().providers.github.profiles).toEqual([]);
      expect(await auth.credentialFor('github', PROJECT)).toBeNull();
    });

    it('a Jira site that cannot be reached is a network failure', async () => {
      await fake.close();
      const { auth, dir } = world();
      const reply = await auth.addToken({ provider: 'jira', email: 'me@acme.test', site: 'https://acme.atlassian.net', token: ATLASSIAN_TOKEN });
      expect(reply).toMatchObject({ ok: false, error: AUTH_ERROR.checkFailed, reason: CHECK_FAILURE.network });
      expect(files(dir)).toEqual([]);
      fake = await startFakeProviders();
    });
  });

  it('refuses invalid input before it touches the network', async () => {
    const { auth, dir } = world();
    const replies = await Promise.all([
      auth.addToken({ provider: 'jira', email: 'me@acme.test', site: 'https://evil.test', token: ATLASSIAN_TOKEN }),
      auth.addToken({ provider: 'bitbucket', email: 'not-an-email', token: ATLASSIAN_TOKEN }),
      auth.addToken({ provider: 'github', token: '' }),
    ]);
    expect(replies.map((reply) => (reply.ok ? 'ok' : reply.error === AUTH_ERROR.invalidInput ? reply.field : reply.error))).toEqual(['site', 'email', 'token']);
    expect(fake.requests).toEqual([]);
    expect(files(dir)).toEqual([]);
  });

  it.each([null, 'github', 5, { provider: 'gitlab', token: GITHUB_TOKEN }, { token: GITHUB_TOKEN }, [], { provider: ['github'] }])('rejects the malformed request %j', async (raw) => {
    const { auth } = world();
    expect(await auth.addToken(raw)).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
    expect(fake.requests).toEqual([]);
  });

  it('rolls the profile back and says so when the token cannot be stored', async () => {
    const { auth, cipher, dir, logs } = world();
    cipher.failEncrypt(true);
    const reply = await auth.addToken({ provider: 'github', token: GITHUB_TOKEN });
    expect(reply).toMatchObject({ ok: false, error: AUTH_ERROR.storageFailed });
    expect(auth.status().providers.github.profiles).toEqual([]);
    expect(files(dir)).not.toContain('auth-secrets.json');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'auth-profiles.json'), 'utf8')).profiles).toEqual([]);
    expect(logs.join('\n')).not.toContain(GITHUB_TOKEN);
  });
});

describe('auth.renameProfile', () => {
  it('changes the nickname and nothing else', async () => {
    const { auth } = world();
    const added = await auth.addToken({ provider: 'github', token: GITHUB_TOKEN });
    if (!added.ok) throw new Error('add failed');
    const reply = auth.renameProfile(added.profile.id, '  Work laptop ');
    expect(reply).toMatchObject({ ok: true, profile: { id: added.profile.id, nickname: 'Work laptop', login: 'octo' } });
    expect(auth.status().providers.github.profiles[0].nickname).toBe('Work laptop');
  });

  it('refuses empty and long names and unknown accounts', async () => {
    const { auth } = world();
    const added = await auth.addToken({ provider: 'github', token: GITHUB_TOKEN });
    if (!added.ok) throw new Error('add failed');
    expect(auth.renameProfile(added.profile.id, '   ')).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
    expect(auth.renameProfile(added.profile.id, 'x'.repeat(61))).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
    expect(auth.renameProfile('missing', 'Name')).toEqual({ ok: false, error: AUTH_ERROR.unknownProfile });
    expect(auth.renameProfile(7, 'Name')).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
  });
});

describe('auth.setExpiry', () => {
  async function bitbucketAccount() {
    const w = world();
    const added = await w.auth.addToken({ provider: 'bitbucket', email: 'me@acme.test', token: ATLASSIAN_TOKEN });
    if (!added.ok) throw new Error('add failed');
    return { ...w, id: added.profile.id };
  }

  it('sets, changes and clears a manual expiry', async () => {
    const { auth, id } = await bitbucketAccount();
    expect(auth.setExpiry(id, '2027-01-15')).toMatchObject({ ok: true, profile: { expiresAt: Date.UTC(2027, 0, 15, 23, 59, 59, 999), expirySource: 'manual' } });
    expect(auth.setExpiry(id, '2027-02-15')).toMatchObject({ ok: true, profile: { expiresAt: Date.UTC(2027, 1, 15, 23, 59, 59, 999) } });
    expect(auth.setExpiry(id, null)).toMatchObject({ ok: true, profile: { expiresAt: null, expirySource: null } });
  });

  it('refuses a bad date, an unknown account, and an account whose provider reports the expiry', async () => {
    const { auth, id } = await bitbucketAccount();
    expect(auth.setExpiry(id, '2027-02-30')).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
    expect(auth.setExpiry(id, 20270101)).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
    expect(auth.setExpiry('missing', '2027-01-15')).toEqual({ ok: false, error: AUTH_ERROR.unknownProfile });
    const github = await auth.addToken({ provider: 'github', token: GITHUB_TOKEN });
    if (!github.ok) throw new Error('add failed');
    expect(auth.setExpiry(github.profile.id, '2027-01-15')).toEqual({ ok: false, error: AUTH_ERROR.providerReportsExpiry });
  });
});
