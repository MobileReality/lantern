import { message } from './messages.mjs';
import { SkillError } from './http.mjs';
import { basicSecrets } from './redact.mjs';

export const ENV_NAMES = Object.freeze({ email: 'ATLASSIAN_EMAIL', token: 'GLOBAL_ATLASSIAN_TOKEN', site: 'ATLASSIAN_BASE_URL' });

export const LANTERN_ACCESS = Object.freeze({ provider: 'jira', required: [ENV_NAMES.email, ENV_NAMES.token], optional: [ENV_NAMES.site] });

const present = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '';

export const missingNames = (env) => Object.values(ENV_NAMES).filter((name) => !present(env, name));

export const secretsOf = (env) => basicSecrets(env[ENV_NAMES.email]?.trim(), env[ENV_NAMES.token]?.trim());

export function normalizeSite(raw) {
  try {
    const url = new URL(raw.trim());
    if (url.protocol === 'https:' && !url.username && !url.password) return url.origin;
  } catch {
    return null;
  }
  return null;
}

export function readCredentials(env) {
  const site = normalizeSite(env[ENV_NAMES.site]);
  if (!site) throw new SkillError(message('credentials.badSite', { name: ENV_NAMES.site }));
  return { site, email: env[ENV_NAMES.email].trim(), token: env[ENV_NAMES.token].trim() };
}
