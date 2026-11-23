import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PERSISTENCE } from '@shared/auth-kinds';
import { createAuth } from '@main/auth';
import { vaultCipher } from '@main/auth/electron-cipher';
import type { SafeStorageLike } from '@main/auth/electron-cipher';
import { createSecretStore } from '@main/auth/secret-store';
import { callArguments, occurrences } from './helpers/source-blocks';
import { GITHUB_HOST, createCredentialWorld } from './helpers/credential-world';
import { listFiles, makeTempDir } from './helpers/auth-world';

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
const TOKEN = 'ghp_dev_session_token_value';

function spyStorage() {
  const storage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((plain: string) => Buffer.from(plain, 'utf8').reverse()),
    decryptString: vi.fn((data: Buffer) => Buffer.from(data).reverse().toString('utf8')),
  } satisfies SafeStorageLike;
  const calls = () => storage.isEncryptionAvailable.mock.calls.length + storage.encryptString.mock.calls.length + storage.decryptString.mock.calls.length;
  return { storage, calls };
}

function authWith(dir: string, cipher: ReturnType<typeof vaultCipher>) {
  return createAuth({ dir, cipher, drivers: {}, resolveProject: (project) => project, detectHost: async () => GITHUB_HOST });
}

describe('the protected vault in a dev build', () => {
  it('is never asked about, so no keychain prompt, when the dev profile has not opted in', () => {
    const { storage, calls } = spyStorage();
    const cipher = vaultCipher(storage, { dev: true, optIn: false });
    expect(cipher.available()).toBe(false);
    expect(() => cipher.encrypt(TOKEN)).toThrow();
    expect(() => cipher.decrypt(Buffer.from('x'))).toThrow();
    const store = createSecretStore(path.join(makeTempDir(), 'secrets.json'), cipher);
    store.set('p1', TOKEN);
    expect(store.get('p1')).toBe(TOKEN);
    expect(store.persistence()).toBe(PERSISTENCE.memoryOnly);
    expect(calls()).toBe(0);
  });

  it('is used when the dev profile opts in', () => {
    const { storage, calls } = spyStorage();
    const cipher = vaultCipher(storage, { dev: true, optIn: true });
    expect(cipher.available()).toBe(true);
    expect(cipher.decrypt(cipher.encrypt('abc'))).toBe('abc');
    expect(storage.isEncryptionAvailable).toHaveBeenCalled();
    expect(storage.encryptString).toHaveBeenCalled();
    expect(calls()).toBeGreaterThan(0);
  });

  it('is used by a production build, as before, whatever the opt-in says', () => {
    for (const optIn of [false, true]) {
      const { storage } = spyStorage();
      const cipher = vaultCipher(storage, { dev: false, optIn });
      expect(cipher.available()).toBe(true);
      expect(cipher.decrypt(cipher.encrypt('abc'))).toBe('abc');
      expect(storage.isEncryptionAvailable).toHaveBeenCalled();
      expect(storage.encryptString).toHaveBeenCalledWith('abc');
    }
  });

  it('keeps the production rule that the Linux basic_text backend is no vault', () => {
    const { storage } = spyStorage();
    const weak = { ...storage, getSelectedStorageBackend: () => 'basic_text' };
    expect(vaultCipher(weak, { dev: false, optIn: false }, 'linux').available()).toBe(false);
  });

  it('writes nothing to disk for an account added in a dev session, and serves it over the socket', async () => {
    const { storage, calls } = spyStorage();
    const dir = makeTempDir();
    const auth = authWith(dir, vaultCipher(storage, { dev: true, optIn: false }));
    const world = await createCredentialWorld({ auth });
    auth.connectStatic({ provider: 'github', token: TOKEN, login: 'me', displayName: 'Me', scopes: [] });

    expect(await world.ask(world.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN: TOKEN } });
    expect(calls()).toBe(0);
    expect(listFiles(dir)).toEqual([]);
    for (const file of fs.readdirSync(world.root, { recursive: true, encoding: 'utf8' })) {
      const full = path.join(world.root, file);
      if (fs.statSync(full).isFile()) expect(fs.readFileSync(full, 'utf8')).not.toContain(TOKEN);
    }
  });

  it('is wired in main.ts from the dev profile and the opt-in, never straight from safeStorage', () => {
    const args = callArguments(MAIN, 'createAuth').text;
    expect(args).toMatch(/cipher:\s*vaultCipher\(\s*electron\.safeStorage,\s*\{\s*dev:\s*DEV_PROFILE,\s*optIn:\s*DEV_VAULT\s*\}\s*\)/);
    expect(occurrences(MAIN, /\belectronCipher\(/)).toEqual([]);
  });
});
