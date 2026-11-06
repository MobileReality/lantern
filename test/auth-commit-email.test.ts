import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTH_ERROR } from '@shared/auth-kinds';
import { parseCommitEmail } from '@shared/auth-input';
import { createCredentialWorld } from './helpers/credential-world';
import { startFakeProviders } from './helpers/fake-providers';
import type { FakeProviders } from './helpers/fake-providers';
import { FAKE_ATLASSIAN_TOKEN, FAKE_GITHUB_TOKEN } from './helpers/fake-tokens';

const GITHUB_TOKEN = FAKE_GITHUB_TOKEN;
const ATLASSIAN_TOKEN = FAKE_ATLASSIAN_TOKEN;
const PRIVATE_ACCOUNT = { token: GITHUB_TOKEN, login: 'octo', displayName: 'Octo Cat', scopes: ['repo'] };

let fake: FakeProviders;

beforeEach(async () => {
  fake = await startFakeProviders();
});

afterEach(async () => {
  await fake.close();
});

const world = () => createCredentialWorld({ authWorld: { check: { endpoints: fake.endpoints, timeoutMs: 2000 } } });

describe('a GitHub account the provider reports no public email for', () => {
  it('serves the email set on it as GIT_COMMIT_EMAIL through the credential socket', async () => {
    fake.allow('github', PRIVATE_ACCOUNT);
    const w = await world();
    const added = await w.auth.addToken({ provider: 'github', token: GITHUB_TOKEN });
    if (!added.ok) throw new Error('add failed');
    expect(added.profile.email).toBeNull();
    expect(await w.ask(w.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });

    expect(w.auth.setEmail(added.profile.id, ' work@acme.test ')).toMatchObject({ ok: true, profile: { email: 'work@acme.test' } });
    expect(await w.ask(w.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN, GIT_COMMIT_EMAIL: 'work@acme.test' } });

    expect(w.auth.setEmail(added.profile.id, '')).toMatchObject({ ok: true, profile: { email: null } });
    expect(await w.ask(w.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });

  it('takes the email typed in the add form, and keeps a saved one when the token is added again', async () => {
    fake.allow('github', PRIVATE_ACCOUNT);
    const w = await world();
    const added = await w.auth.addToken({ provider: 'github', token: GITHUB_TOKEN, email: 'typed@acme.test' });
    if (!added.ok) throw new Error('add failed');
    expect(added.profile.email).toBe('typed@acme.test');
    await w.auth.addToken({ provider: 'github', token: GITHUB_TOKEN });
    expect(await w.ask(w.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN, GIT_COMMIT_EMAIL: 'typed@acme.test' } });
  });

  it('refuses a malformed email, in the add form and when editing', async () => {
    fake.allow('github', PRIVATE_ACCOUNT);
    const w = await world();
    expect(await w.auth.addToken({ provider: 'github', token: GITHUB_TOKEN, email: 'not-an-email' })).toMatchObject({ ok: false, error: AUTH_ERROR.invalidInput, field: 'email' });
    const added = await w.auth.addToken({ provider: 'github', token: GITHUB_TOKEN });
    if (!added.ok) throw new Error('add failed');
    expect(w.auth.setEmail(added.profile.id, 'nope')).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
    expect(w.auth.setEmail(added.profile.id, 42)).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
    expect(w.auth.setEmail('missing', 'a@b.test')).toEqual({ ok: false, error: AUTH_ERROR.unknownProfile });
  });

  it('still takes the public email GitHub reports when the form field is left empty', async () => {
    fake.allow('github', { ...PRIVATE_ACCOUNT, email: 'public@acme.test' });
    const w = await world();
    const added = await w.auth.addToken({ provider: 'github', token: GITHUB_TOKEN });
    expect(added).toMatchObject({ ok: true, profile: { email: 'public@acme.test' } });
  });
});

describe('the commit email of providers that ask for it at sign-in', () => {
  it('cannot be edited on a Bitbucket account', async () => {
    fake.allow('bitbucket', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme' });
    const w = await world();
    const added = await w.auth.addToken({ provider: 'bitbucket', email: 'me@acme.test', token: ATLASSIAN_TOKEN });
    if (!added.ok) throw new Error('add failed');
    expect(w.auth.setEmail(added.profile.id, 'other@acme.test')).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
  });
});

describe('parseCommitEmail', () => {
  it('treats nothing and empty as none, trims, and rejects the rest', () => {
    expect(parseCommitEmail(undefined)).toEqual({ ok: true, email: null });
    expect(parseCommitEmail('  ')).toEqual({ ok: true, email: null });
    expect(parseCommitEmail(' a@b.test ')).toEqual({ ok: true, email: 'a@b.test' });
    expect(parseCommitEmail('a@b')).toEqual({ ok: false });
    expect(parseCommitEmail(5)).toEqual({ ok: false });
  });
});
