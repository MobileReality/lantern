import path from 'node:path';
import { CREDENTIAL_KIND, PERSISTENCE } from '@shared/auth-kinds';
import { msg } from '@shared/lang/messages';
import { createBindings } from './bindings';
import { createLog } from './redact';
import type { LogSink } from './redact';
import { createProfileStore } from './profiles';
import type { Profile } from './profiles';
import { createAccounts } from './accounts';
import type { StaticGrant } from './accounts';
import { createSecretStore } from './secret-store';
import type { Cipher } from './secret-store';
import { projectIntegrations } from './project-view';
import type { ProjectViewDeps } from './project-view';
import { injectionOf } from './spawn-env';
import type { CredentialInjection, InjectedCredential } from './spawn-env';
import { authStatus } from './status';
import { createTokenManager } from './token-manager';
import type { CheckDeps } from './token-check';
import type { ProviderDrivers, ProviderId } from './providers';

interface AuthDeps {
  dir: string;
  cipher: Cipher;
  drivers: ProviderDrivers;
  resolveProject: (project: string) => string;
  now?: () => number;
  newId?: () => string;
  log?: LogSink;
  check?: CheckDeps;
  detectHost?: ProjectViewDeps['detectHost'];
  readFileNames?: ProjectViewDeps['readFileNames'];
  env?: ProjectViewDeps['env'];
}

interface Grant {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  scopes: string[];
}

interface Credential {
  accessToken: string;
  expiresAt: number;
  login: string;
  email?: string;
  site?: string;
}

type ChangeListener = (provider: ProviderId | null) => void;

const SECRETS_FILE = 'auth-secrets.json';
const PROFILES_FILE = 'auth-profiles.json';
const BINDINGS_FILE = 'auth-bindings.json';

const noHost = async () => null;
const noNames = async () => new Set<string>();

function createAuth({
  dir,
  cipher,
  drivers,
  resolveProject,
  now = Date.now,
  newId,
  log: sink = () => {},
  check,
  detectHost = noHost,
  readFileNames = noNames,
  env = () => process.env,
}: AuthDeps) {
  const log = createLog(sink);
  const listeners = new Set<ChangeListener>();
  const emit = (provider: ProviderId | null) => listeners.forEach((listener) => { listener(provider); });

  const secrets = createSecretStore(path.join(dir, SECRETS_FILE), cipher);
  const canPersist = () => secrets.persistence() === PERSISTENCE.secure;
  const profiles = createProfileStore({ file: path.join(dir, PROFILES_FILE), canPersist, now, newId });
  const bindings = createBindings({ file: path.join(dir, BINDINGS_FILE), profiles, resolveProject, canPersist });
  const tokens = createTokenManager({ secrets, profiles, drivers, now, log, onState: (id) => emit(profiles.get(id)?.provider ?? null) });

  const status = (project?: string) => authStatus({ profiles, bindings, stateOf: tokens.stateOf, persistence: secrets.persistence }, project);

  function bind(provider: ProviderId, profileId: string, project: string) {
    bindings.set(provider, profileId, project);
    emit(provider);
  }

  function unbind(provider: ProviderId, project: string) {
    bindings.clear(provider, project);
    emit(provider);
  }

  function removeProfile(profileId: string) {
    const gone = profiles.remove(profileId);
    if (!gone) return false;
    bindings.forgetProfile(profileId);
    tokens.forget(profileId);
    emit(gone.provider);
    return true;
  }

  async function connect(provider: ProviderId, grant: Grant): Promise<Profile> {
    const driver = drivers[provider];
    if (!driver) throw new Error(`no sign-in driver for ${provider}`);
    const account = await driver.profile(grant.accessToken);
    const { profile, created } = profiles.create({ provider, login: account.login, displayName: account.displayName, scopes: grant.scopes });
    try {
      secrets.set(profile.id, grant.refreshToken);
    } catch (err) {
      if (created) profiles.remove(profile.id);
      throw err;
    }
    tokens.adopt(profile.id, { accessToken: grant.accessToken, expiresAt: grant.expiresAt });
    emit(provider);
    return profile;
  }

  function connectStatic(grant: StaticGrant): { profile: Profile; created: boolean } {
    const { profile, created } = profiles.create({
      provider: grant.provider,
      kind: CREDENTIAL_KIND.static,
      login: grant.login,
      displayName: grant.displayName,
      scopes: grant.scopes,
      email: grant.email,
      site: grant.site,
      expiresAt: grant.expiresAt,
      expirySource: grant.expirySource,
    });
    try {
      secrets.set(profile.id, grant.token);
    } catch (err) {
      if (created) profiles.remove(profile.id);
      throw err;
    }
    tokens.reset(profile.id);
    emit(grant.provider);
    return { profile, created };
  }

  const accounts = createAccounts({ profiles, connectStatic, stateOf: tokens.stateOf, emit, check, log });
  const project = (path: string) => projectIntegrations({ profiles, bindings, stateOf: tokens.stateOf, resolveProject, detectHost, readFileNames, env }, path);

  async function credentialFor(provider: ProviderId, project: string): Promise<Credential | null> {
    const { profileId } = bindings.resolve(provider, project);
    const profile = profileId === null ? undefined : profiles.get(profileId);
    if (!profile) return null;
    try {
      const { accessToken, expiresAt } = await tokens.getAccessToken(profile.id);
      return { accessToken, expiresAt, login: profile.login, ...(profile.email ? { email: profile.email } : {}), ...(profile.site ? { site: profile.site } : {}) };
    } catch (err) {
      log(msg('logs.noCredential', { provider, login: profile.login }), err);
      return null;
    }
  }

  async function injectionFor(path: string): Promise<CredentialInjection> {
    const view = await project(path);
    const entries: Partial<Record<ProviderId, InjectedCredential>> = {};
    for (const slot of view.slots) {
      const credential = slot.bound === null ? null : await credentialFor(slot.provider, path);
      if (credential) entries[slot.provider] = { secret: credential.accessToken, login: credential.login, email: credential.email, site: credential.site };
    }
    const injection = injectionOf(entries);
    for (const provider of Object.keys(injection)) log(msg('logs.runCanUse', { project: path, provider, login: entries[provider as ProviderId]?.login ?? '' }));
    return injection;
  }

  function invalidate(provider: ProviderId, project: string, rejectedToken?: string) {
    const { profileId } = bindings.resolve(provider, project);
    if (profileId !== null) tokens.invalidate(profileId, rejectedToken);
  }

  function onChange(listener: ChangeListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    status,
    project,
    bind,
    unbind,
    removeProfile,
    connect,
    connectStatic,
    addToken: accounts.addToken,
    renameProfile: accounts.rename,
    setExpiry: accounts.setExpiry,
    setEmail: accounts.setEmail,
    credentialFor,
    injectionFor,
    invalidate,
    onChange,
  };
}

type Auth = ReturnType<typeof createAuth>;

export { createAuth };
export type { Auth, AuthDeps, Grant, StaticGrant, Credential };
