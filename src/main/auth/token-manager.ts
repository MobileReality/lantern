import { CONNECTION_STATE, CREDENTIAL_KIND } from '@shared/auth-kinds';
import type { ConnectionState } from '@shared/auth-kinds';
import { msg } from '@shared/lang/messages';
import { DriverError, TokenError } from './errors';
import type { TokenFailure } from './errors';
import type { Profile, ProfileStore } from './profiles';
import type { ProviderDrivers, ProviderId } from './providers';
import type { SecretStore } from './secret-store';

interface AccessToken {
  accessToken: string;
  expiresAt: number;
}

interface TokenManagerDeps {
  secrets: SecretStore;
  profiles: ProfileStore;
  drivers: ProviderDrivers;
  now: () => number;
  log: (message: string, err?: unknown) => void;
  onState: (profileId: string) => void;
}

interface TokenManager {
  getAccessToken(profileId: string): Promise<AccessToken>;
  invalidate(profileId: string, rejectedToken?: string): void;
  adopt(profileId: string, access: AccessToken): void;
  reset(profileId: string): void;
  forget(profileId: string): void;
  stateOf(profileId: string): ConnectionState;
}

interface Held extends AccessToken {
  refreshAt: number;
}

interface Entry {
  access?: Held;
  state: ConnectionState;
  failures: number;
  retryAt: number;
  unsaved?: string;
  inflight?: Promise<Held>;
}

const REFRESH_AT_FRACTION = 0.8;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 600_000;
const FALLBACK_REASONS: TokenFailure[] = ['offline', 'unavailable'];
const NO_EXPIRY = Number.MAX_SAFE_INTEGER;

function createTokenManager({ secrets, profiles, drivers, now, log, onState }: TokenManagerDeps): TokenManager {
  const entries = new Map<string, Entry>();

  function entryOf(profileId: string): Entry {
    let entry = entries.get(profileId);
    if (!entry) {
      entry = { state: secrets.has(profileId) ? CONNECTION_STATE.connected : CONNECTION_STATE.expired, failures: 0, retryAt: 0 };
      entries.set(profileId, entry);
    }
    return entry;
  }

  function setState(profileId: string, entry: Entry, state: ConnectionState) {
    if (entry.state === state) return;
    entry.state = state;
    log(msg('logs.stateChanged', { profileId, state }));
    onState(profileId);
  }

  function hold(access: AccessToken): Held {
    const received = now();
    return { ...access, refreshAt: received + (access.expiresAt - received) * REFRESH_AT_FRACTION };
  }

  function failure(profileId: string, entry: Entry, reason: TokenFailure, state: ConnectionState, backoff: boolean) {
    if (backoff) {
      entry.failures += 1;
      entry.retryAt = now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (entry.failures - 1));
    }
    setState(profileId, entry, state);
    return new TokenError(reason);
  }

  function dropSecret(profileId: string) {
    try {
      secrets.delete(profileId);
    } catch (err) {
      log(msg('logs.signInNotDeleted', { profileId }), err);
    }
  }

  function expire(profileId: string, entry: Entry) {
    entry.access = undefined;
    entry.unsaved = undefined;
    return failure(profileId, entry, 'expired', CONNECTION_STATE.expired, false);
  }

  async function exchange(profileId: string, provider: ProviderId, entry: Entry, refreshToken: string) {
    const driver = drivers[provider];
    if (!driver) throw failure(profileId, entry, 'unavailable', CONNECTION_STATE.unavailable, false);
    try {
      return await driver.refresh(refreshToken);
    } catch (err) {
      log(msg('logs.refreshFailed', { profileId }), err);
      if (err instanceof DriverError && err.kind === 'invalid_grant') {
        dropSecret(profileId);
        throw expire(profileId, entry);
      }
      const offline = err instanceof DriverError && err.kind === 'network';
      throw failure(profileId, entry, offline ? 'offline' : 'unavailable', offline ? CONNECTION_STATE.connectedOffline : CONNECTION_STATE.unavailable, true);
    }
  }

  function readRefreshToken(profileId: string, entry: Entry): string {
    if (entry.unsaved !== undefined) return entry.unsaved;
    let stored: string | null;
    try {
      stored = secrets.get(profileId);
    } catch (err) {
      log(msg('logs.signInUnreadable', { profileId }), err);
      throw failure(profileId, entry, 'unavailable', CONNECTION_STATE.unavailable, true);
    }
    if (stored === null) throw expire(profileId, entry);
    return stored;
  }

  async function refresh(profileId: string, provider: ProviderId, entry: Entry): Promise<Held> {
    const current = readRefreshToken(profileId, entry);
    const result = await exchange(profileId, provider, entry, current);
    if (!profiles.get(profileId)) throw new TokenError('not-found');
    const next = result.refreshToken ?? current;
    if (entry.unsaved !== undefined || next !== current) {
      try {
        secrets.set(profileId, next);
        entry.unsaved = undefined;
      } catch (err) {
        log(msg('logs.rotatedNotStored', { profileId }), err);
        entry.unsaved = next;
        entry.access = undefined;
        throw failure(profileId, entry, 'persist-failed', CONNECTION_STATE.unavailable, true);
      }
    }
    entry.access = hold(result);
    entry.failures = 0;
    entry.retryAt = 0;
    setState(profileId, entry, CONNECTION_STATE.connected);
    return entry.access;
  }

  const stillUsable = (entry: Entry) => (entry.access && now() < entry.access.expiresAt ? entry.access : undefined);

  function readStatic(profile: Profile, entry: Entry): AccessToken {
    let stored: string | null;
    try {
      stored = secrets.get(profile.id);
    } catch (err) {
      log(msg('logs.tokenUnreadable', { profileId: profile.id }), err);
      setState(profile.id, entry, CONNECTION_STATE.unavailable);
      throw new TokenError('unavailable');
    }
    if (stored === null) {
      setState(profile.id, entry, CONNECTION_STATE.expired);
      throw new TokenError('expired');
    }
    setState(profile.id, entry, CONNECTION_STATE.connected);
    return { accessToken: stored, expiresAt: NO_EXPIRY };
  }

  async function getAccessToken(profileId: string): Promise<AccessToken> {
    const profile = profiles.get(profileId);
    if (!profile) throw new TokenError('not-found');
    const entry = entryOf(profileId);
    if (profile.kind === CREDENTIAL_KIND.static) return readStatic(profile, entry);
    if (entry.access && now() < entry.access.refreshAt) return entry.access;
    if (!entry.inflight && now() < entry.retryAt) {
      const usable = stillUsable(entry);
      if (usable) return usable;
      throw new TokenError(entry.state === CONNECTION_STATE.unavailable ? 'unavailable' : 'offline');
    }
    entry.inflight ??= refresh(profileId, profile.provider, entry).finally(() => {
      entry.inflight = undefined;
    });
    try {
      return await entry.inflight;
    } catch (err) {
      const usable = err instanceof TokenError && FALLBACK_REASONS.includes(err.reason) ? stillUsable(entry) : undefined;
      if (usable) return usable;
      throw err;
    }
  }

  function invalidate(profileId: string, rejectedToken?: string) {
    const entry = entries.get(profileId);
    if (!entry?.access || (rejectedToken !== undefined && entry.access.accessToken !== rejectedToken)) return;
    entry.access = undefined;
    entry.retryAt = 0;
  }

  function adopt(profileId: string, access: AccessToken) {
    const entry = entryOf(profileId);
    entry.access = hold(access);
    entry.unsaved = undefined;
    entry.failures = 0;
    entry.retryAt = 0;
    setState(profileId, entry, CONNECTION_STATE.connected);
  }

  function reset(profileId: string) {
    entries.delete(profileId);
    entryOf(profileId);
  }

  function forget(profileId: string) {
    entries.delete(profileId);
    dropSecret(profileId);
  }

  function stateOf(profileId: string): ConnectionState {
    if (profiles.get(profileId)?.kind !== CREDENTIAL_KIND.static) return entryOf(profileId).state;
    if (!secrets.has(profileId)) return CONNECTION_STATE.expired;
    return secrets.readable(profileId) ? CONNECTION_STATE.connected : CONNECTION_STATE.unavailable;
  }

  return { getAccessToken, invalidate, adopt, reset, forget, stateOf };
}

export { createTokenManager, NO_EXPIRY };
export type { TokenManager, ConnectionState, AccessToken };
