import { CREDENTIAL_VARS, isSet } from './env-names';
import { CODE_HOST_IDS } from '@shared/providers';
import { PROVIDER_IDS, PROVIDERS, TOKEN_FIELD } from './providers';
import type { ProviderId } from './providers';

const SOURCE_VAR = 'LANTERN_CREDENTIAL_SOURCE';
const PROVIDERS_VAR = 'LANTERN_CREDENTIAL_PROVIDERS';
const SOURCE_VALUE = 'lantern';

interface InjectedCredential {
  secret: string;
  login: string;
  email?: string;
  site?: string;
}

interface VarGroup {
  credentials: Record<string, string>;
  context: Record<string, string>;
  commitEmail?: string;
}

type CredentialInjection = Partial<Record<ProviderId, VarGroup>>;

function valuesFor(needsEmail: boolean, credential: InjectedCredential): string[] | null {
  if (!needsEmail) return [credential.secret];
  return credential.email ? [credential.email, credential.secret] : null;
}

function groupFor(provider: ProviderId, credential: InjectedCredential): VarGroup | null {
  const { required, optional } = CREDENTIAL_VARS[provider];
  const values = valuesFor(PROVIDERS[provider].tokenFields.includes(TOKEN_FIELD.email), credential);
  if (!values) return null;
  const { site, email } = credential;
  const commitEmail = email && CODE_HOST_IDS.some((id) => id === provider) ? email : undefined;
  return {
    credentials: Object.fromEntries(required.map((name, index) => [name, values[index]])),
    context: site ? Object.fromEntries(optional.map((name) => [name, site])) : {},
    ...(commitEmail ? { commitEmail } : {}),
  };
}

function injectionOf(entries: Partial<Record<ProviderId, InjectedCredential>>): CredentialInjection {
  const injection: CredentialInjection = {};
  for (const provider of PROVIDER_IDS) {
    const credential = entries[provider];
    const group = credential ? groupFor(provider, credential) : null;
    if (group) injection[provider] = group;
  }
  return injection;
}

function applyInjection(base: NodeJS.ProcessEnv, injection: CredentialInjection = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  const injected: ProviderId[] = [];
  for (const provider of PROVIDER_IDS) {
    const group = injection[provider];
    if (!group || Object.keys(group.credentials).some((name) => isSet(base[name]))) continue;
    Object.assign(env, group.credentials);
    for (const [name, value] of Object.entries(group.context)) if (!isSet(base[name])) env[name] = value;
    injected.push(provider);
  }
  if (injected.length) {
    env[SOURCE_VAR] = SOURCE_VALUE;
    env[PROVIDERS_VAR] = injected.join(',');
  } else {
    delete env[SOURCE_VAR];
    delete env[PROVIDERS_VAR];
  }
  return env;
}

export { applyInjection, injectionOf, SOURCE_VAR, PROVIDERS_VAR, SOURCE_VALUE };
export type { CredentialInjection, InjectedCredential, VarGroup };
