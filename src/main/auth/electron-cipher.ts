import type { Cipher } from './secret-store';

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
  getSelectedStorageBackend?(): string;
}

const WEAK_BACKEND = 'basic_text';

function electronCipher(storage: SafeStorageLike, platform: NodeJS.Platform = process.platform): Cipher {
  const isWeakBackend = () => platform === 'linux' && storage.getSelectedStorageBackend?.() === WEAK_BACKEND;
  return {
    available: () => storage.isEncryptionAvailable() && !isWeakBackend(),
    encrypt: (plain) => storage.encryptString(plain),
    decrypt: (data) => storage.decryptString(data),
  };
}

export { electronCipher };
export type { SafeStorageLike };
