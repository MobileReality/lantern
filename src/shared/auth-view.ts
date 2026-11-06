import type { BindingChoice, CheckFailure, ConnectionState, CredentialKind, CredentialSource, ErrorCodeOf, ExpirySource, Persistence } from './auth-kinds';
import type { CodeHostId, ProviderId, ProviderRole } from './providers';

interface ProfileStatus {
  id: string;
  provider: ProviderId;
  kind: CredentialKind;
  login: string;
  displayName: string;
  nickname: string;
  email: string | null;
  site: string | null;
  createdAt: number;
  expiresAt: number | null;
  expirySource: ExpirySource | null;
  state: ConnectionState;
}

interface ProviderStatus {
  name: string;
  role: ProviderRole;
  profiles: ProfileStatus[];
  bound: string | null;
  binding: BindingChoice;
  state: ConnectionState | null;
}

interface AuthStatusShape {
  persistence: Persistence;
  project: string | null;
  providers: Record<ProviderId, ProviderStatus>;
}

type SecretWord = 'token' | 'secret' | 'password' | 'code' | 'verifier';

type SecretKey<T> = T extends readonly (infer Item)[]
  ? SecretKey<Item>
  : T extends object
    ? { [K in keyof T & string]: (Lowercase<K> extends `${string}${SecretWord}${string}` ? K : never) | SecretKey<T[K]> }[keyof T & string]
    : never;

type Sealed<T> = [SecretKey<T>] extends [never] ? T : never;

type AuthStatus = Sealed<AuthStatusShape>;

interface ProjectSlot {
  provider: ProviderId;
  role: ProviderRole;
  suggested: boolean;
  binding: BindingChoice;
  bound: string | null;
  candidates: ProfileStatus[];
  inEnvironment: string[];
  inProjectFile: string[];
  projectFileComplete: boolean;
  winner: CredentialSource;
}

interface ProjectHost {
  provider: CodeHostId | null;
  owner: string | null;
  repo: string | null;
}

interface ProjectIntegrationsShape {
  project: string;
  host: ProjectHost;
  slots: ProjectSlot[];
}

type ProjectIntegrations = Sealed<ProjectIntegrationsShape>;

type AddTokenError =
  | { ok: false; error: ErrorCodeOf<'invalidRequest'> }
  | { ok: false; error: ErrorCodeOf<'invalidInput'>; field: string; message: string }
  | { ok: false; error: ErrorCodeOf<'checkFailed'>; reason: CheckFailure; message: string }
  | { ok: false; error: ErrorCodeOf<'storageFailed'>; message: string };

type AddTokenResult = { ok: true; profile: ProfileStatus; created: boolean } | AddTokenError;

type EditResult = { ok: true; profile: ProfileStatus } | { ok: false; error: ErrorCodeOf<'invalidRequest' | 'unknownProfile' | 'providerReportsExpiry'> };

type AuthError = ErrorCodeOf<'invalidRequest' | 'unknownProfile' | 'wrongProvider'>;

type AuthReply = { ok: true; status: AuthStatus } | { ok: false; error: AuthError };

type ProjectReply = { ok: true; project: ProjectIntegrations } | { ok: false; error: ErrorCodeOf<'invalidRequest'> };

interface AuthChange {
  provider: ProviderId | null;
}

export type { AddTokenError, AddTokenResult, AuthChange, AuthError, AuthReply, AuthStatus, EditResult, ProfileStatus, ProjectHost, ProjectIntegrations, ProjectReply, ProjectSlot, ProviderStatus, Sealed };
