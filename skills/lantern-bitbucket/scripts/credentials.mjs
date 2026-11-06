import { basicSecrets } from './redact.mjs';

export const ENV_NAMES = Object.freeze({ email: 'BITBUCKET_EMAIL', token: 'BITBUCKET_API_TOKEN' });

export const LANTERN_ACCESS = Object.freeze({ provider: 'bitbucket', required: [ENV_NAMES.email, ENV_NAMES.token], optional: [] });

export const SOURCE = Object.freeze({ environment: 'environment', lantern: 'lantern', socket: 'socket' });

export const SOURCE_MESSAGE = Object.freeze({ [SOURCE.environment]: 'check.source.environment', [SOURCE.lantern]: 'check.source.lantern', [SOURCE.socket]: 'check.source.socket' });

const INJECTION_MARK = Object.freeze({ variable: 'LANTERN_CREDENTIAL_SOURCE', value: 'lantern', providers: 'LANTERN_CREDENTIAL_PROVIDERS' });

const present = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '';

const injectedByLantern = (env) => {
  if (env[INJECTION_MARK.variable] !== INJECTION_MARK.value) return false;
  const listed = (env[INJECTION_MARK.providers] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  return listed.length === 0 || listed.includes(LANTERN_ACCESS.provider);
};

export const missingNames = (env) => Object.values(ENV_NAMES).filter((name) => !present(env, name));

export const secretsOf = (env) => basicSecrets(env[ENV_NAMES.email]?.trim(), env[ENV_NAMES.token]?.trim());

export const readCredentials = (env) => ({ email: env[ENV_NAMES.email].trim(), token: env[ENV_NAMES.token].trim() });

export function sourceOf(env, completed) {
  if (completed !== env) return SOURCE.socket;
  return injectedByLantern(env) ? SOURCE.lantern : SOURCE.environment;
}
