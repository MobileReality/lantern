import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DriverError } from '../src/main/auth/errors';
import { HOUR_MS, createAuthWorld, listFiles } from './helpers/auth-world';

const PROJECT = '/work/shop';
const SECRETS_FILE = 'auth-secrets.json';

async function connectedWorld() {
  const world = createAuthWorld();
  const { profile, grant, driver } = await world.signIn('github');
  return { ...world, profile, grant, driver };
}

function ageTokenBy(world: { clock: { advance(ms: number): void } }, fraction: number) {
  world.clock.advance(HOUR_MS * fraction);
}

describe('refresh token storage', () => {
  it('survives a restart through the encrypted file, which holds neither the token nor its base64', async () => {
    const first = await connectedWorld();
    const onDisk = fs.readFileSync(path.join(first.dir, SECRETS_FILE), 'utf8');
    expect(onDisk).not.toContain(first.grant.refreshToken);
    expect(onDisk).not.toContain(Buffer.from(first.grant.refreshToken).toString('base64'));

    const restarted = createAuthWorld({ dir: first.dir, cipher: first.cipher, clock: first.clock, drivers: first.drivers });
    const credential = await restarted.auth.credentialFor('github', PROJECT);
    expect(credential?.login).toBe('github-user');
    expect(first.driver.refreshCalls).toEqual([first.grant.refreshToken]);
  });

  it('keeps the file private to the user', async () => {
    const { dir } = await connectedWorld();
    if (process.platform === 'win32') return;
    expect(fs.statSync(path.join(dir, SECRETS_FILE)).mode & 0o777).toBe(0o600);
  });
});

describe('getting an access token', () => {
  it('hands out the cached token without calling the provider while it is fresh', async () => {
    const { auth, grant, driver } = await connectedWorld();
    const credential = await auth.credentialFor('github', PROJECT);
    expect(credential).toEqual({ accessToken: grant.accessToken, expiresAt: grant.expiresAt, login: 'github-user' });
    expect(driver.refreshCalls).toEqual([]);
  });

  it('shares one refresh between five concurrent calls', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 0.9);
    const release = world.driver.holdRefresh();
    const calls = Array.from({ length: 5 }, () => world.auth.credentialFor('github', PROJECT));
    await Promise.resolve();
    release();
    const results = await Promise.all(calls);
    expect(world.driver.refreshCalls).toHaveLength(1);
    expect(new Set(results.map((credential) => credential?.accessToken)).size).toBe(1);
    expect(results[0]?.accessToken).not.toBe(world.grant.accessToken);
  });

  it('refreshes at about 80 percent of the lifetime, not before', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 0.75);
    await world.auth.credentialFor('github', PROJECT);
    expect(world.driver.refreshCalls).toHaveLength(0);
    ageTokenBy(world, 0.1);
    await world.auth.credentialFor('github', PROJECT);
    expect(world.driver.refreshCalls).toHaveLength(1);
  });

  it('refreshes once after an explicit invalidate of the rejected token only', async () => {
    const world = await connectedWorld();
    world.auth.invalidate('github', PROJECT, 'some-other-token');
    await world.auth.credentialFor('github', PROJECT);
    expect(world.driver.refreshCalls).toHaveLength(0);

    world.auth.invalidate('github', PROJECT, world.grant.accessToken);
    const [first, second] = await Promise.all([world.auth.credentialFor('github', PROJECT), world.auth.credentialFor('github', PROJECT)]);
    expect(world.driver.refreshCalls).toHaveLength(1);
    expect(first?.accessToken).toBe(second?.accessToken);
    expect(first?.accessToken).not.toBe(world.grant.accessToken);
  });

  it('uses the rotated refresh token on the next refresh, so it was persisted', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 0.9);
    await world.auth.credentialFor('github', PROJECT);
    ageTokenBy(world, 0.9);
    const credential = await world.auth.credentialFor('github', PROJECT);
    expect(credential).not.toBeNull();
    expect(world.driver.refreshCalls).toEqual([world.grant.refreshToken, 'github-refresh-2']);
  });
});

describe('a failed persist of the rotated refresh token', () => {
  it('does not return the new access token', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 0.9);
    world.cipher.failEncrypt(true);
    const credential = await world.auth.credentialFor('github', PROJECT);
    expect(credential).toBeNull();
    expect(world.driver.refreshCalls).toHaveLength(1);
  });

  it('recovers on the next try from the rotated token held in memory, never the burnt one', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 0.9);
    world.cipher.failEncrypt(true);
    await world.auth.credentialFor('github', PROJECT);
    world.cipher.failEncrypt(false);
    world.clock.advance(60_000);
    const credential = await world.auth.credentialFor('github', PROJECT);
    expect(credential).not.toBeNull();
    expect(world.driver.refreshCalls[1]).toBe('github-refresh-2');
    expect(world.auth.status(PROJECT).providers.github.state).toBe('connected');
  });
});

describe('failures from the provider', () => {
  it('keeps every token on a network error and reports connected-offline', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 1.1);
    world.driver.failNext(new DriverError('network'));
    expect(await world.auth.credentialFor('github', PROJECT)).toBeNull();
    expect(world.auth.status(PROJECT).providers.github.state).toBe('connected-offline');
    expect(fs.readFileSync(path.join(world.dir, SECRETS_FILE), 'utf8')).toContain(world.profile.id);

    world.clock.advance(31_000);
    expect(await world.auth.credentialFor('github', PROJECT)).not.toBeNull();
    expect(world.auth.status(PROJECT).providers.github.state).toBe('connected');
  });

  it('still hands out the old token when only the early refresh fails offline', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 0.9);
    world.driver.failNext(new DriverError('network'));
    const credential = await world.auth.credentialFor('github', PROJECT);
    expect(credential?.accessToken).toBe(world.grant.accessToken);
  });

  it('removes the tokens on invalid_grant and reports expired', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 1.1);
    world.driver.failNext(new DriverError('invalid_grant'));
    expect(await world.auth.credentialFor('github', PROJECT)).toBeNull();
    expect(world.auth.status(PROJECT).providers.github.state).toBe('expired');
    expect(fs.readFileSync(path.join(world.dir, SECRETS_FILE), 'utf8')).not.toContain(world.profile.id);

    world.clock.advance(HOUR_MS);
    expect(await world.auth.credentialFor('github', PROJECT)).toBeNull();
    expect(world.driver.refreshCalls).toHaveLength(1);
  });

  it('backs off on a provider 5xx instead of retrying every call', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 1.1);
    world.driver.failNext(new DriverError('unavailable'));
    expect(await world.auth.credentialFor('github', PROJECT)).toBeNull();
    expect(world.auth.status(PROJECT).providers.github.state).toBe('unavailable');
    await world.auth.credentialFor('github', PROJECT);
    expect(world.driver.refreshCalls).toHaveLength(1);

    world.clock.advance(31_000);
    expect(await world.auth.credentialFor('github', PROJECT)).not.toBeNull();
    expect(world.driver.refreshCalls).toHaveLength(2);
  });

  it('never deletes anything for an unexpected driver error', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 1.1);
    world.driver.failNext(new TypeError('boom'));
    expect(await world.auth.credentialFor('github', PROJECT)).toBeNull();
    expect(fs.readFileSync(path.join(world.dir, SECRETS_FILE), 'utf8')).toContain(world.profile.id);
  });

  it('never logs a token that a driver error message carried', async () => {
    const world = await connectedWorld();
    ageTokenBy(world, 1.1);
    world.driver.failNext(new DriverError('network', `POST failed: refresh_token=${world.grant.refreshToken}&client_secret=s3cret`));
    await world.auth.credentialFor('github', PROJECT);
    const logged = world.logs.join('\n');
    expect(logged).toContain('refresh failed');
    expect(logged).not.toContain(world.grant.refreshToken);
    expect(logged).not.toContain('s3cret');
  });
});

describe('when the OS cannot encrypt', () => {
  it('writes nothing to userData and keeps the session in memory', async () => {
    const world = createAuthWorld();
    world.cipher.setAvailable(false);
    const { profile } = await world.signIn('github');
    world.auth.bind('github', profile.id, PROJECT);
    expect(listFiles(world.dir)).toEqual([]);
    expect(world.auth.status(PROJECT).persistence).toBe('memory-only');
    expect(await world.auth.credentialFor('github', PROJECT)).not.toBeNull();

    ageTokenBy(world, 0.9);
    expect(await world.auth.credentialFor('github', PROJECT)).not.toBeNull();
    expect(listFiles(world.dir)).toEqual([]);
  });

  it('loses the sign-in on restart instead of storing it in clear', async () => {
    const world = createAuthWorld();
    world.cipher.setAvailable(false);
    await world.signIn('github');
    const restarted = createAuthWorld({ dir: world.dir, cipher: world.cipher, clock: world.clock, drivers: world.drivers });
    expect(restarted.auth.status(PROJECT).providers.github.profiles).toEqual([]);
  });
});
