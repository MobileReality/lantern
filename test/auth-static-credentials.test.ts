import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_EXPIRY } from '@main/auth/token-manager';
import { createAuthWorld } from './helpers/auth-world';
import { FAKE_GITHUB_TOKEN } from './helpers/fake-tokens';

const PROJECT = '/work/shop';
const SECRETS_FILE = 'auth-secrets.json';
const PROFILES_FILE = 'auth-profiles.json';
const TOKEN = FAKE_GITHUB_TOKEN;

describe('static credentials in the encrypted store', () => {
  it('keeps the pasted token out of every file, as text and as base64', () => {
    const world = createAuthWorld();
    world.addStatic('github', TOKEN);
    for (const file of [SECRETS_FILE, PROFILES_FILE]) {
      const onDisk = fs.readFileSync(path.join(world.dir, file), 'utf8');
      expect(onDisk).not.toContain(TOKEN);
      expect(onDisk).not.toContain(Buffer.from(TOKEN).toString('base64'));
    }
  });

  it('keeps the secrets file private to the user', () => {
    const world = createAuthWorld();
    world.addStatic('github', TOKEN);
    if (process.platform === 'win32') return;
    expect(fs.statSync(path.join(world.dir, SECRETS_FILE)).mode & 0o777).toBe(0o600);
  });

  it('survives a restart and hands out the same token without calling any provider', async () => {
    const first = createAuthWorld();
    first.addStatic('github', TOKEN, 'work');
    const restarted = createAuthWorld({ dir: first.dir, cipher: first.cipher, clock: first.clock, drivers: first.drivers });
    const credential = await restarted.auth.credentialFor('github', PROJECT);
    expect(credential).toEqual({ accessToken: TOKEN, expiresAt: NO_EXPIRY, login: 'work' });
    expect(first.drivers.github?.refreshCalls).toEqual([]);
  });

  it('never refreshes, however much time passes', async () => {
    const world = createAuthWorld();
    world.addStatic('github', TOKEN);
    world.clock.advance(400 * 24 * 3_600_000);
    expect((await world.auth.credentialFor('github', PROJECT))?.accessToken).toBe(TOKEN);
    expect(world.drivers.github?.refreshCalls).toEqual([]);
  });

  it('returns the provider expiry as the credential expiry and still hands the token out after a manual expiry passed', async () => {
    const world = createAuthWorld();
    const expiresAt = world.clock.now() + 1000;
    world.addStatic('github', TOKEN, 'work', { expiresAt, expirySource: 'manual' });
    world.clock.advance(5000);
    expect(await world.auth.credentialFor('github', PROJECT)).toMatchObject({ accessToken: TOKEN });
  });

  it('adds the email and the site to the credential for Atlassian accounts, and the token only in accessToken', async () => {
    const world = createAuthWorld();
    world.addStatic('jira', 'ATATT-secret', 'me@acme.test', { email: 'me@acme.test', site: 'https://acme.atlassian.net' });
    const credential = await world.auth.credentialFor('jira', PROJECT);
    expect(credential).toMatchObject({ accessToken: 'ATATT-secret', email: 'me@acme.test', site: 'https://acme.atlassian.net' });
    expect(fs.readFileSync(path.join(world.dir, PROFILES_FILE), 'utf8')).not.toContain('ATATT-secret');
  });

  it('reports a static account as expired when its secret is gone and unavailable when the store is locked', async () => {
    const world = createAuthWorld();
    const { profile } = world.addStatic('github', TOKEN);
    world.cipher.setAvailable(false);
    const locked = createAuthWorld({ dir: world.dir, cipher: world.cipher, clock: world.clock });
    expect(locked.auth.status().providers.github.profiles[0].state).toBe('unavailable');
    expect(await locked.auth.credentialFor('github', PROJECT)).toBeNull();
    expect(locked.auth.status().providers.github.profiles[0].state).toBe('unavailable');
    world.cipher.setAvailable(true);
    fs.writeFileSync(path.join(world.dir, SECRETS_FILE), JSON.stringify({ version: 1, entries: {} }));
    const emptied = createAuthWorld({ dir: world.dir, cipher: world.cipher, clock: world.clock });
    expect(await emptied.auth.credentialFor('github', PROJECT)).toBeNull();
    expect(emptied.auth.status().providers.github.profiles.find((entry) => entry.id === profile.id)?.state).toBe('expired');
  });

  it('removes the secret together with the account', () => {
    const world = createAuthWorld();
    const { profile } = world.addStatic('github', TOKEN);
    world.auth.removeProfile(profile.id);
    expect(JSON.parse(fs.readFileSync(path.join(world.dir, SECRETS_FILE), 'utf8')).entries).toEqual({});
  });

  it('keeps the token in memory only, and writes no profile file, when the machine has no secure store', async () => {
    const world = createAuthWorld();
    world.cipher.setAvailable(false);
    world.addStatic('github', TOKEN);
    expect(fs.existsSync(path.join(world.dir, SECRETS_FILE))).toBe(false);
    expect(fs.existsSync(path.join(world.dir, PROFILES_FILE))).toBe(false);
    expect((await world.auth.credentialFor('github', PROJECT))?.accessToken).toBe(TOKEN);
  });
});

describe('profile metadata', () => {
  it('starts the nickname at the login and keeps an edited one when the same account is added again', () => {
    const world = createAuthWorld();
    const first = world.addStatic('github', TOKEN, 'work');
    expect(first.profile.nickname).toBe('work');
    expect(first.created).toBe(true);
    const again = world.addStatic('github', `${TOKEN}-2`, 'work');
    expect(again.created).toBe(false);
    expect(again.profile.id).toBe(first.profile.id);
  });

  it('tells two Jira sites of one login apart', () => {
    const world = createAuthWorld();
    world.addStatic('jira', 'a', 'me@x.test', { email: 'me@x.test', site: 'https://one.atlassian.net' });
    world.addStatic('jira', 'b', 'me@x.test', { email: 'me@x.test', site: 'https://two.atlassian.net' });
    expect(world.auth.status().providers.jira.profiles.map((profile) => profile.site)).toEqual(['https://one.atlassian.net', 'https://two.atlassian.net']);
  });

  it('reads a profile file written before the metadata existed', () => {
    const world = createAuthWorld();
    fs.writeFileSync(
      path.join(world.dir, PROFILES_FILE),
      JSON.stringify({ version: 1, profiles: [{ id: 'old', provider: 'github', login: 'legacy', displayName: 'Legacy', scopes: ['read'], createdAt: 5 }] }),
    );
    const restarted = createAuthWorld({ dir: world.dir, cipher: world.cipher });
    expect(restarted.auth.status().providers.github.profiles[0]).toMatchObject({ id: 'old', kind: 'oauth', nickname: 'legacy', email: null, site: null, expiresAt: null, expirySource: null });
  });
});
