import fs from 'node:fs';
import path from 'node:path';

const EMAIL_KEY = 'BITBUCKET_EMAIL';
const TOKEN_KEY = 'BITBUCKET_API_TOKEN';
const MAX_ENV_BYTES = 16 * 1024;
const MAX_VALUE_LENGTH = 512;
const PRINTABLE = /^[\x21-\x7e]+$/;
const ENV_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;
const QUOTES = ['"', "'"];

interface HostCredentials {
  email: string;
  token: string;
}

type CredentialKey = typeof EMAIL_KEY | typeof TOKEN_KEY;
type CredentialValues = Partial<Record<CredentialKey, string>>;

function isCredentialKey(name: string): name is CredentialKey {
  return name === EMAIL_KEY || name === TOKEN_KEY;
}

function cleanValue(raw: string): string | null {
  const quote = raw[0];
  const quoted = raw.length >= 2 && QUOTES.includes(quote) && raw.endsWith(quote);
  const value = quoted ? raw.slice(1, -1) : raw.replace(/\s+#.*$/, '');
  return value.length <= MAX_VALUE_LENGTH && PRINTABLE.test(value) ? value : null;
}

function parseCredentialLines(text: string): CredentialValues {
  const found: CredentialValues = {};
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_LINE.exec(line);
    if (!match || !isCredentialKey(match[1]) || found[match[1]] !== undefined) continue;
    const value = cleanValue(match[2]);
    if (value) found[match[1]] = value;
  }
  return found;
}

async function readBoundedFile(file: string): Promise<string | null> {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_ENV_BYTES) return null;
    const buffer = Buffer.alloc(MAX_ENV_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead > MAX_ENV_BYTES ? null : buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readProjectEnv(root: string): Promise<CredentialValues> {
  const dir = path.join(root, '.ai');
  const file = path.join(dir, '.env');
  try {
    if ((await fs.promises.lstat(dir)).isSymbolicLink()) return {};
    const meta = await fs.promises.lstat(file);
    if (!meta.isFile() || meta.size > MAX_ENV_BYTES) return {};
    const text = await readBoundedFile(file);
    return text === null ? {} : parseCredentialLines(text);
  } catch {
    return {};
  }
}

function fromEnvironment(env: NodeJS.ProcessEnv, key: CredentialKey) {
  return cleanValue((env[key] ?? '').trim());
}

async function readHostCredentials(root: string, env: NodeJS.ProcessEnv = process.env): Promise<HostCredentials | null> {
  let email = fromEnvironment(env, EMAIL_KEY);
  let token = fromEnvironment(env, TOKEN_KEY);
  if (!email || !token) {
    const file = await readProjectEnv(root);
    email ||= file[EMAIL_KEY] ?? null;
    token ||= file[TOKEN_KEY] ?? null;
  }
  return email && token ? { email, token } : null;
}

export { readHostCredentials, parseCredentialLines, readBoundedFile, cleanValue, ENV_LINE, MAX_ENV_BYTES };
export type { HostCredentials };
