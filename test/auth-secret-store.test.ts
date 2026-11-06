import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { electronCipher } from '../src/main/auth/electron-cipher';
import type { SafeStorageLike } from '../src/main/auth/electron-cipher';
import { createSecretStore } from '../src/main/auth/secret-store';
import { createFakeCipher, listFiles, makeTempDir } from './helpers/auth-world';

const TOKEN = 'rt_9f8e7d6c5b4a39281706';

function storeIn(dir: string, cipher = createFakeCipher()) {
  return { cipher, file: path.join(dir, 'secrets.json'), store: createSecretStore(path.join(dir, 'secrets.json'), cipher) };
}

describe('secret store', () => {
  it('round-trips a secret through the file, which holds neither it nor its base64', () => {
    const dir = makeTempDir();
    const { store, file, cipher } = storeIn(dir);
    store.set('p1', TOKEN);

    const onDisk = fs.readFileSync(file, 'utf8');
    expect(onDisk).not.toContain(TOKEN);
    expect(onDisk).not.toContain(Buffer.from(TOKEN).toString('base64'));
    expect(onDisk).not.toContain(Buffer.from(TOKEN).toString('hex'));

    expect(createSecretStore(file, cipher).get('p1')).toBe(TOKEN);
  });

  it('writes the file readable by the owner only', () => {
    const dir = makeTempDir();
    const { store, file } = storeIn(dir);
    store.set('p1', TOKEN);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('tightens a file that already exists with looser permissions', () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir();
    const { store, file } = storeIn(dir);
    fs.writeFileSync(file, '{}', { mode: 0o644 });
    store.set('p1', TOKEN);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('leaves no temp files behind', () => {
    const dir = makeTempDir();
    storeIn(dir).store.set('p1', TOKEN);
    expect(listFiles(dir)).toEqual(['secrets.json']);
  });

  it('keeps entries independent', () => {
    const dir = makeTempDir();
    const { store } = storeIn(dir);
    store.set('a', 'one');
    store.set('b', 'two');
    store.delete('a');
    expect(store.get('a')).toBeNull();
    expect(store.get('b')).toBe('two');
    expect(store.has('a')).toBe(false);
  });

  it('writes nothing and keeps the secret in memory when encryption is unavailable', () => {
    const dir = makeTempDir();
    const { store, cipher } = storeIn(dir);
    cipher.setAvailable(false);
    store.set('p1', TOKEN);
    expect(listFiles(dir)).toEqual([]);
    expect(store.persistence()).toBe('memory-only');
    expect(store.get('p1')).toBe(TOKEN);
  });

  it('never decrypts when locked: an existing entry becomes unreadable, not plain', () => {
    const dir = makeTempDir();
    const { store, cipher } = storeIn(dir);
    store.set('p1', TOKEN);
    cipher.setAvailable(false);
    expect(() => store.get('p1')).toThrow('locked');
  });

  it('does not mistake an object prototype key for a stored entry', () => {
    const { store } = storeIn(makeTempDir());
    expect(store.has('constructor')).toBe(false);
    expect(store.get('toString')).toBeNull();
  });

  it('survives a damaged file', () => {
    const dir = makeTempDir();
    const { store, file } = storeIn(dir);
    fs.writeFileSync(file, 'garbage');
    expect(store.get('p1')).toBeNull();
    store.set('p1', TOKEN);
    expect(store.get('p1')).toBe(TOKEN);
  });
});

describe('electron cipher', () => {
  function storage(over: Partial<SafeStorageLike> = {}): SafeStorageLike {
    return {
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(plain).reverse(),
      decryptString: (data) => Buffer.from(data).reverse().toString(),
      ...over,
    };
  }

  it('uses the sync safeStorage API the pinned Electron has', () => {
    const cipher = electronCipher(storage());
    expect(cipher.available()).toBe(true);
    expect(cipher.decrypt(cipher.encrypt('abc'))).toBe('abc');
  });

  it('is unavailable when the OS keychain is', () => {
    expect(electronCipher(storage({ isEncryptionAvailable: () => false })).available()).toBe(false);
  });

  it('treats the Linux basic_text backend as no secure store', () => {
    const weak = storage({ getSelectedStorageBackend: () => 'basic_text' });
    expect(electronCipher(weak, 'linux').available()).toBe(false);
    expect(electronCipher(storage({ getSelectedStorageBackend: () => 'gnome_libsecret' }), 'linux').available()).toBe(true);
    expect(electronCipher(weak, 'darwin').available()).toBe(true);
  });
});
