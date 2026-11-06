import { PERSISTENCE } from '@shared/auth-kinds';
import type { Persistence } from '@shared/auth-kinds';
import { isRecord, readJson, writePrivateJson } from './private-file';

interface Cipher {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

interface SecretStore {
  persistence(): Persistence;
  get(id: string): string | null;
  has(id: string): boolean;
  readable(id: string): boolean;
  set(id: string, secret: string): void;
  delete(id: string): void;
}

const FILE_VERSION = 1;

function readEntries(file: string): Record<string, string> {
  const stored = readJson(file);
  if (!isRecord(stored) || !isRecord(stored.entries)) return {};
  return Object.fromEntries(Object.entries(stored.entries).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function createSecretStore(file: string, cipher: Cipher): SecretStore {
  const session = new Map<string, string>();

  const persistence = (): Persistence => (cipher.available() ? PERSISTENCE.secure : PERSISTENCE.memoryOnly);
  const writeEntries = (entries: Record<string, string>) => writePrivateJson(file, { version: FILE_VERSION, entries });

  function get(id: string) {
    const live = session.get(id);
    if (live !== undefined) return live;
    const entries = readEntries(file);
    const sealed = Object.hasOwn(entries, id) ? entries[id] : undefined;
    if (sealed === undefined) return null;
    if (!cipher.available()) throw new Error('secret store is locked');
    return cipher.decrypt(Buffer.from(sealed, 'base64'));
  }

  function set(id: string, secret: string) {
    if (!cipher.available()) {
      session.set(id, secret);
      return;
    }
    writeEntries({ ...readEntries(file), [id]: cipher.encrypt(secret).toString('base64') });
    session.delete(id);
  }

  function remove(id: string) {
    session.delete(id);
    const { [id]: gone, ...rest } = readEntries(file);
    if (gone !== undefined) writeEntries(rest);
  }

  const has = (id: string) => session.has(id) || Object.hasOwn(readEntries(file), id);
  const readable = (id: string) => session.has(id) || (cipher.available() && Object.hasOwn(readEntries(file), id));

  return { persistence, get, has, readable, set, delete: remove };
}

export { createSecretStore };
export type { Cipher, Persistence, SecretStore };
