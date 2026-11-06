import type { ConnectionState, Persistence } from '@shared/auth-kinds';
import type { AuthStatus, ProfileStatus, ProviderStatus, Sealed } from '@shared/auth-view';
import type { Bindings } from './bindings';
import { PROVIDER_IDS, PROVIDERS } from './providers';
import type { ProviderId } from './providers';
import type { Profile, ProfileStore } from './profiles';

interface StatusDeps {
  profiles: ProfileStore;
  bindings: Bindings;
  stateOf: (profileId: string) => ConnectionState;
  persistence: () => Persistence;
}

function profileStatus(stateOf: StatusDeps['stateOf'], profile: Profile): ProfileStatus {
  const { id, provider, kind, login, displayName, nickname, email, site, createdAt, expiresAt, expirySource } = profile;
  return { id, provider, kind, login, displayName, nickname, email, site, createdAt, expiresAt, expirySource, state: stateOf(id) };
}

function providerStatus(deps: StatusDeps, provider: ProviderId, project?: string): ProviderStatus {
  const { choice, profileId } = deps.bindings.resolve(provider, project);
  return {
    name: PROVIDERS[provider].name,
    role: PROVIDERS[provider].role,
    profiles: deps.profiles.list(provider).map((profile) => profileStatus(deps.stateOf, profile)),
    bound: profileId,
    binding: choice,
    state: profileId === null ? null : deps.stateOf(profileId),
  };
}

function authStatus(deps: StatusDeps, project?: string): AuthStatus {
  const providers = Object.fromEntries(PROVIDER_IDS.map((provider) => [provider, providerStatus(deps, provider, project)])) as Record<ProviderId, ProviderStatus>;
  return { persistence: deps.persistence(), project: project ?? null, providers };
}

export { authStatus, profileStatus };
export type { AuthStatus, ProviderStatus, ProfileStatus, StatusDeps, Sealed };
