import path from 'node:path';
import { CREDENTIAL_REFUSAL } from '@shared/auth-kinds';
import type { CredentialRefusal } from '@shared/auth-kinds';
import { isProviderId } from './providers';
import type { ProviderId } from './providers';

const SOCKET_ENV = 'LANTERN_CREDENTIAL_SOCKET';
const SOCKET_FILE = 'lantern.sock';
const PIPE_PREFIX = '\\\\.\\pipe\\';
const PIPE_NAME = 'lantern-credentials';
const DEV_SUFFIX = '-dev';
const SOCKET_MODE = 0o600;

const LIMITS = { requestBytes: 4096, connectionMs: 5000, connections: 16 } as const;

interface SocketLocation {
  userData: string;
  platform: NodeJS.Platform;
  username: string;
  dev: boolean;
}

interface CredentialRequest {
  project: string;
  provider: ProviderId;
}

interface CredentialGranted {
  ok: true;
  env: Record<string, string>;
}

interface CredentialRefused {
  ok: false;
  reason: CredentialRefusal;
}

type CredentialReply = CredentialGranted | CredentialRefused;

function credentialSocketPath({ userData, platform, username, dev }: SocketLocation): string {
  if (platform === 'win32') return `${PIPE_PREFIX}${PIPE_NAME}-${username}${dev ? DEV_SUFFIX : ''}`;
  return path.join(userData, SOCKET_FILE);
}

function parseCredentialRequest(line: string): CredentialRequest | null {
  try {
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null) return null;
    const { project, provider } = request as Record<string, unknown>;
    return typeof project === 'string' && project !== '' && isProviderId(provider) ? { project, provider } : null;
  } catch {
    return null;
  }
}

const refusal = (reason: CredentialRefusal): CredentialRefused => ({ ok: false, reason });

const BAD_REQUEST = refusal(CREDENTIAL_REFUSAL.badRequest);

export { BAD_REQUEST, LIMITS, SOCKET_ENV, SOCKET_FILE, SOCKET_MODE, credentialSocketPath, parseCredentialRequest, refusal };
export type { CredentialGranted, CredentialRefused, CredentialReply, CredentialRequest, SocketLocation };
