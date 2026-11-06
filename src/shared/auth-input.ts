import { parseExpiryDate } from './auth-expiry';
import { hasControlCharacter } from './control-characters';
import { msg } from './lang/messages';
import type { MessageKey } from './lang/messages';
import { PROVIDERS, TOKEN_FIELD } from './providers';
import type { ProviderId } from './providers';

const MIN_TOKEN_LENGTH = 8;
const MAX_TOKEN_LENGTH = 512;
const MAX_EMAIL_LENGTH = 254;
const MAX_NICKNAME_LENGTH = 60;
const PRINTABLE = /^[\x21-\x7e]+$/;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const SITE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/;

const INPUT_FIELD = { ...TOKEN_FIELD, nickname: 'nickname', expiresOn: 'expiresOn' } as const;

type InputField = (typeof INPUT_FIELD)[keyof typeof INPUT_FIELD];

interface TokenInput {
  provider: ProviderId;
  token: string;
  email: string | null;
  site: string | null;
  nickname: string | null;
  expiresAt: number | null;
}

type InputIssue = { field: InputField; message: string };

type ParsedInput = { ok: true; input: TokenInput } | { ok: false; issue: InputIssue };

const fail = (field: InputField, key: MessageKey = `auth.input.${field}`): ParsedInput => ({ ok: false, issue: { field, message: msg(key, { max: MAX_NICKNAME_LENGTH }) } });

const isText = (value: unknown): value is string => typeof value === 'string';

function normalizeSite(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text || hasControlCharacter(text) || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }
  const bare = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password && !url.port;
  return url.protocol === 'https:' && bare && SITE_HOST.test(url.hostname) ? `https://${url.hostname}` : null;
}

function parseTokenInput(provider: ProviderId, raw: Record<string, unknown>): ParsedInput {
  const token = isText(raw.token) ? raw.token.trim() : '';
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH || !PRINTABLE.test(token)) return fail(INPUT_FIELD.token);

  const needs = PROVIDERS[provider].tokenFields;
  let email: string | null = null;
  if (needs.includes(TOKEN_FIELD.email)) {
    email = isText(raw.email) ? raw.email.trim() : '';
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) return fail(INPUT_FIELD.email);
  }

  if (PROVIDERS[provider].optionalEmail) {
    const parsedEmail = parseCommitEmail(raw.email);
    if (!parsedEmail.ok) return fail(INPUT_FIELD.email, 'auth.input.commitEmail');
    email = parsedEmail.email;
  }

  let site: string | null = null;
  if (needs.includes(TOKEN_FIELD.site)) {
    site = isText(raw.site) ? normalizeSite(raw.site) : null;
    if (!site) return fail(INPUT_FIELD.site);
  }

  let nickname: string | null = null;
  if (raw.nickname !== undefined && raw.nickname !== null && raw.nickname !== '') {
    nickname = isText(raw.nickname) ? raw.nickname.trim() : '';
    if (!nickname || nickname.length > MAX_NICKNAME_LENGTH || hasControlCharacter(nickname)) return fail(INPUT_FIELD.nickname);
  }

  let expiresAt: number | null = null;
  if (raw.expiresOn !== undefined && raw.expiresOn !== null && raw.expiresOn !== '') {
    expiresAt = isText(raw.expiresOn) ? parseExpiryDate(raw.expiresOn) : null;
    if (expiresAt === null) return fail(INPUT_FIELD.expiresOn);
  }

  return { ok: true, input: { provider, token, email, site, nickname, expiresAt } };
}

function parseCommitEmail(raw: unknown): { ok: true; email: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, email: null };
  const email = isText(raw) ? raw.trim() : null;
  if (email === null) return { ok: false };
  if (email === '') return { ok: true, email: null };
  return email.length <= MAX_EMAIL_LENGTH && EMAIL.test(email) ? { ok: true, email } : { ok: false };
}

function parseNickname(raw: unknown): string | null {
  const nickname = isText(raw) ? raw.trim() : '';
  return nickname && nickname.length <= MAX_NICKNAME_LENGTH && !hasControlCharacter(nickname) ? nickname : null;
}

export { INPUT_FIELD, MAX_NICKNAME_LENGTH, normalizeSite, parseCommitEmail, parseTokenInput, parseNickname };
export type { InputField, TokenInput, InputIssue, ParsedInput };
