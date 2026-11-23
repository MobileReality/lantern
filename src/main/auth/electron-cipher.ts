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

const sessionOnlyCipher: Cipher = {
  available: () => false,
  encrypt: () => {
    throw new Error('the protected vault is off for this run');
  },
  decrypt: () => {
    throw new Error('the protected vault is off for this run');
  },
};

interface VaultChoice {
  dev: boolean;
  optIn: boolean;
}

// Asking safeStorage whether encryption is available is what makes macOS ask for the login password,
// so a dev run that did not opt in must never reach it.
function vaultCipher(storage: SafeStorageLike, { dev, optIn }: VaultChoice, platform: NodeJS.Platform = process.platform): Cipher {
  return dev && !optIn ? sessionOnlyCipher : electronCipher(storage, platform);
}

export { electronCipher, vaultCipher };
export type { SafeStorageLike, VaultChoice };
