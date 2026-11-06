import { describe, expect, it } from 'vitest';
import * as kinds from '@shared/auth-kinds';

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const SETS = {
  AUTH_ERROR: kinds.AUTH_ERROR,
  BINDING_CHOICE: kinds.BINDING_CHOICE,
  CHECK_FAILURE: kinds.CHECK_FAILURE,
  CONNECTION_STATE: kinds.CONNECTION_STATE,
  CREDENTIAL_KIND: kinds.CREDENTIAL_KIND,
  CREDENTIAL_REFUSAL: kinds.CREDENTIAL_REFUSAL,
  CREDENTIAL_SOURCE: kinds.CREDENTIAL_SOURCE,
  EXPIRY_LEVEL: kinds.EXPIRY_LEVEL,
  EXPIRY_SOURCE: kinds.EXPIRY_SOURCE,
  PERSISTENCE: kinds.PERSISTENCE,
};

describe('the auth kind sets', () => {
  it.each(Object.entries(SETS))('%s names each value after its key, in kebab case', (_name, set) => {
    for (const [key, value] of Object.entries(set)) expect(value).toBe(kebab(key));
  });

  it.each(Object.entries(SETS))('%s has no value twice', (_name, set) => {
    const values = Object.values(set);
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps the strings the stored files and the IPC replies already use', () => {
    expect(Object.values(kinds.AUTH_ERROR).sort()).toEqual(['check-failed', 'invalid-input', 'invalid-request', 'provider-reports-expiry', 'storage-failed', 'unknown-profile', 'wrong-provider']);
    expect(Object.values(kinds.CONNECTION_STATE).sort()).toEqual(['connected', 'connected-offline', 'expired', 'unavailable']);
    expect(Object.values(kinds.CREDENTIAL_KIND).sort()).toEqual(['oauth', 'static']);
    expect(Object.values(kinds.EXPIRY_SOURCE).sort()).toEqual(['manual', 'provider']);
  });
});
