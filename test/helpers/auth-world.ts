import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { createAuth } from '../../src/main/auth';
import type { StaticGrant } from '../../src/main/auth';
import { DriverError } from '../../src/main/auth/errors';
import type { ProviderDriver, ProviderDrivers, ProviderId } from '../../src/main/auth/providers';
import type { Cipher } from '../../src/main/auth/secret-store';
import type { CheckDeps } from '../../src/main/auth/token-check';
import type { CodeHost } from '../../src/main/lantern-host-origin';

const HOUR_MS = 3_600_000;

interface FakeClock {
  now(): number;
  advance(ms: number): void;
}

function createClock(start = 1_700_000_000_000): FakeClock {
  let current = start;
  return { now: () => current, advance: (ms) => {
    current += ms;
  } };
}

interface FakeCipher extends Cipher {
  setAvailable(on: boolean): void;
  failEncrypt(on: boolean): void;
}

function createFakeCipher(): FakeCipher {
  const key = randomBytes(32);
  let available = true;
  let failing = false;
  return {
    setAvailable: (on) => {
      available = on;
    },
    failEncrypt: (on) => {
      failing = on;
    },
    available: () => available,
    encrypt(plain) {
      if (failing) throw new Error('disk full');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), sealed]);
    },
    decrypt(data) {
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

interface FakeDriver extends ProviderDriver {
  refreshCalls: string[];
  lastRefreshToken(): string;
  issue(): { accessToken: string; refreshToken: string; expiresAt: number };
  failNext(error: unknown): void;
  holdRefresh(): () => void;
  lifetimeMs: number;
  account: { login: string; displayName: string };
}

function createFakeDriver(clock: FakeClock, label: string, account = { login: `${label}-user`, displayName: `${label} User` }): FakeDriver {
  let issued = 0;
  const validRefresh = new Set<string>();
  let lastRefresh = '';
  let failure: unknown;
  let gate: Promise<void> | undefined;
  const driver: FakeDriver = {
    refreshCalls: [],
    lifetimeMs: HOUR_MS,
    account,
    lastRefreshToken: () => lastRefresh,
    issue() {
      issued += 1;
      lastRefresh = `${label}-refresh-${issued}`;
      validRefresh.add(lastRefresh);
      return { accessToken: `${label}-access-${issued}`, refreshToken: lastRefresh, expiresAt: clock.now() + driver.lifetimeMs };
    },
    failNext: (error) => {
      failure = error;
    },
    holdRefresh() {
      let release = () => {};
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async refresh(refreshToken) {
      driver.refreshCalls.push(refreshToken);
      await gate;
      if (failure) {
        const error = failure;
        failure = undefined;
        throw error;
      }
      if (!validRefresh.delete(refreshToken)) throw new DriverError('invalid_grant', 'refresh token already used');
      return driver.issue();
    },
    profile: async () => driver.account,
  };
  return driver;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(prefix = 'lantern-auth-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

interface WorldOptions {
  dir?: string;
  cipher?: FakeCipher;
  clock?: FakeClock;
  providers?: ProviderId[];
  check?: CheckDeps;
  host?: CodeHost | null;
  fileNames?: string[];
  env?: NodeJS.ProcessEnv;
  drivers?: Partial<Record<ProviderId, FakeDriver>>;
}

function createAuthWorld(options: WorldOptions = {}) {
  const dir = options.dir ?? makeTempDir();
  const clock = options.clock ?? createClock();
  const cipher = options.cipher ?? createFakeCipher();
  const logs: string[] = [];
  const drivers: Partial<Record<ProviderId, FakeDriver>> = { ...options.drivers };
  for (const provider of options.providers ?? ['github', 'jira', 'bitbucket']) drivers[provider] ??= createFakeDriver(clock, provider);
  let nextId = 0;
  const surroundings = { host: options.host ?? null, fileNames: options.fileNames ?? [], env: options.env ?? {} };
  const auth = createAuth({
    dir,
    cipher,
    drivers: drivers as ProviderDrivers,
    resolveProject: (project) => project.replace(/\/+$/, ''),
    now: clock.now,
    newId: () => {
      nextId += 1;
      return `profile-${nextId}`;
    },
    log: (line) => logs.push(line),
    check: options.check,
    detectHost: async () => surroundings.host,
    readFileNames: async () => new Set(surroundings.fileNames),
    env: () => surroundings.env,
  });

  async function signIn(provider: ProviderId, account?: { login: string; displayName: string }) {
    const driver = drivers[provider] as FakeDriver;
    const grant = driver.issue();
    if (account) driver.account = account;
    const profile = await auth.connect(provider, { ...grant, scopes: ['read'] });
    return { profile, grant, driver };
  }

  function addStatic(provider: ProviderId, token: string, login = `${provider}-static`, extra: Partial<StaticGrant> = {}) {
    return auth.connectStatic({ provider, token, login, displayName: `${login} Name`, scopes: [], ...extra });
  }

  return { auth, dir, clock, cipher, drivers, logs, signIn, addStatic, surroundings };
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir).sort();
}

export { HOUR_MS, createAuthWorld, createClock, createFakeCipher, createFakeDriver, listFiles, makeTempDir };
export type { FakeClock, FakeCipher, FakeDriver };
