import { randomUUID } from 'node:crypto';
import { CREDENTIAL_KIND, EXPIRY_SOURCE } from '@shared/auth-kinds';
import type { CredentialKind, ExpirySource } from '@shared/auth-kinds';
import { isProviderId } from './providers';
import type { ProviderId } from './providers';
import { isRecord, readJson, writePrivateJson } from './private-file';

interface Profile {
  id: string;
  provider: ProviderId;
  kind: CredentialKind;
  login: string;
  displayName: string;
  nickname: string;
  email: string | null;
  site: string | null;
  scopes: string[];
  createdAt: number;
  expiresAt: number | null;
  expirySource: ExpirySource | null;
}

type NewProfile = Pick<Profile, 'provider' | 'login' | 'displayName' | 'scopes'> & Partial<Pick<Profile, 'kind' | 'email' | 'site' | 'expiresAt' | 'expirySource'>>;

type ProfilePatch = Partial<Pick<Profile, 'nickname' | 'email' | 'expiresAt' | 'expirySource'>>;

interface ProfileStoreDeps {
  file: string;
  canPersist: () => boolean;
  now?: () => number;
  newId?: () => string;
}

interface ProfileStore {
  list(provider?: ProviderId): Profile[];
  get(id: string): Profile | undefined;
  create(input: NewProfile): { profile: Profile; created: boolean };
  update(id: string, patch: ProfilePatch): Profile | undefined;
  remove(id: string): Profile | undefined;
}

const FILE_VERSION = 1;

const isNullableString = (value: unknown): value is string | null | undefined => value === undefined || value === null || typeof value === 'string';
const isNullableNumber = (value: unknown): value is number | null | undefined => value === undefined || value === null || typeof value === 'number';

function readProfile(value: unknown): Profile | undefined {
  if (!isRecord(value)) return undefined;
  const { id, provider, login, displayName, scopes, createdAt } = value;
  if (typeof id !== 'string' || !isProviderId(provider) || typeof login !== 'string' || typeof displayName !== 'string') return undefined;
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string') || typeof createdAt !== 'number') return undefined;
  if (!isNullableString(value.nickname) || !isNullableString(value.email) || !isNullableString(value.site) || !isNullableNumber(value.expiresAt)) return undefined;
  const expiresAt = value.expiresAt ?? null;
  return {
    id,
    provider,
    kind: value.kind === CREDENTIAL_KIND.static ? CREDENTIAL_KIND.static : CREDENTIAL_KIND.oauth,
    login,
    displayName,
    nickname: value.nickname || login,
    email: value.email ?? null,
    site: value.site ?? null,
    scopes: [...scopes],
    createdAt,
    expiresAt,
    expirySource: expiresAt === null ? null : value.expirySource === EXPIRY_SOURCE.manual ? EXPIRY_SOURCE.manual : EXPIRY_SOURCE.provider,
  };
}

function loadProfiles(file: string): Profile[] {
  const stored = readJson(file);
  if (!isRecord(stored) || !Array.isArray(stored.profiles)) return [];
  return stored.profiles.map(readProfile).filter((profile): profile is Profile => profile !== undefined);
}

const copy = (profile: Profile): Profile => ({ ...profile, scopes: [...profile.scopes] });

function createProfileStore({ file, canPersist, now = Date.now, newId = randomUUID }: ProfileStoreDeps): ProfileStore {
  let profiles = loadProfiles(file);

  function commit(next: Profile[]) {
    if (canPersist()) writePrivateJson(file, { version: FILE_VERSION, profiles: next });
    profiles = next;
  }

  const list = (provider?: ProviderId) => profiles.filter((profile) => provider === undefined || profile.provider === provider).map(copy);
  const get = (id: string) => list().find((profile) => profile.id === id);

  function create(input: NewProfile) {
    const site = input.site ?? null;
    const existing = profiles.find((profile) => profile.provider === input.provider && profile.login === input.login && profile.site === site);
    const profile: Profile = {
      id: existing?.id ?? newId(),
      provider: input.provider,
      kind: input.kind ?? CREDENTIAL_KIND.oauth,
      login: input.login,
      displayName: input.displayName,
      nickname: existing?.nickname ?? input.login,
      email: input.email ?? existing?.email ?? null,
      site,
      scopes: [...input.scopes],
      createdAt: existing?.createdAt ?? now(),
      expiresAt: input.expiresAt ?? null,
      expirySource: input.expiresAt == null ? null : (input.expirySource ?? EXPIRY_SOURCE.provider),
    };
    commit(existing ? profiles.map((entry) => (entry === existing ? profile : entry)) : [...profiles, profile]);
    return { profile: copy(profile), created: !existing };
  }

  function update(id: string, patch: ProfilePatch) {
    const current = profiles.find((profile) => profile.id === id);
    if (!current) return undefined;
    const next: Profile = { ...current, ...patch };
    commit(profiles.map((entry) => (entry === current ? next : entry)));
    return copy(next);
  }

  function remove(id: string) {
    const gone = get(id);
    if (gone) commit(profiles.filter((profile) => profile.id !== id));
    return gone;
  }

  return { list, get, create, update, remove };
}

export { createProfileStore };
export type { CredentialKind, ExpirySource, Profile, NewProfile, ProfilePatch, ProfileStore };
