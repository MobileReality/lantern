import fs from 'node:fs';
import net from 'node:net';
import { BINDING_CHOICE, CREDENTIAL_REFUSAL } from '@shared/auth-kinds';
import type { BindingChoice, CredentialRefusal } from '@shared/auth-kinds';
import { msg } from '@shared/lang/messages';
import type { Auth } from './index';
import { CREDENTIAL_VARS } from './env-names';
import { BAD_REQUEST, LIMITS, SOCKET_MODE, parseCredentialRequest, refusal } from './credential-socket';
import type { CredentialReply, CredentialRequest } from './credential-socket';
import type { ProviderId } from './providers';
import { createLog } from './redact';
import type { LogSink } from './redact';

interface CredentialServerDeps {
  socketPath: string;
  auth: Pick<Auth, 'injectionFor' | 'project'>;
  knownProject: (dir: string) => string | null;
  log?: LogSink;
  platform?: NodeJS.Platform;
  limits?: { requestBytes: number; connectionMs: number; connections: number };
}

const REFUSAL_BY_CHOICE: Record<BindingChoice, CredentialRefusal> = {
  [BINDING_CHOICE.bound]: CREDENTIAL_REFUSAL.storeUnavailable,
  [BINDING_CHOICE.default]: CREDENTIAL_REFUSAL.storeUnavailable,
  [BINDING_CHOICE.choose]: CREDENTIAL_REFUSAL.chooseAccount,
  [BINDING_CHOICE.unused]: CREDENTIAL_REFUSAL.chooseAccount,
  [BINDING_CHOICE.none]: CREDENTIAL_REFUSAL.noAccount,
};

const COMMIT_EMAIL_NAME = 'GIT_COMMIT_EMAIL';

const allowedNames = (provider: ProviderId) => new Set([...CREDENTIAL_VARS[provider].required, ...CREDENTIAL_VARS[provider].optional]);

function createCredentialServer({ socketPath, auth, knownProject, log: sink = () => {}, platform = process.platform, limits = LIMITS }: CredentialServerDeps) {
  const log = createLog(sink);
  const isPipe = platform === 'win32';

  async function refusalFor(project: string, provider: ProviderId): Promise<CredentialRefusal> {
    try {
      const slot = (await auth.project(project)).slots.find((candidate) => candidate.provider === provider);
      return slot ? REFUSAL_BY_CHOICE[slot.binding] : CREDENTIAL_REFUSAL.noAccount;
    } catch {
      return CREDENTIAL_REFUSAL.storeUnavailable;
    }
  }

  async function answer({ project: directory, provider }: CredentialRequest): Promise<CredentialReply> {
    const project = knownProject(directory);
    if (project === null) return refusal(CREDENTIAL_REFUSAL.unknownProject);
    const group = await auth.injectionFor(project).then(
      (injection) => injection[provider],
      () => undefined,
    );
    const allowed = allowedNames(provider);
    const env = Object.fromEntries(Object.entries({ ...group?.credentials, ...group?.context }).filter(([name]) => allowed.has(name)));
    const served = group?.commitEmail ? { ...env, [COMMIT_EMAIL_NAME]: group.commitEmail } : env;
    if (group && CREDENTIAL_VARS[provider].required.every((name) => name in env)) {
      log(msg('logs.credentialServed', { provider, project }));
      return { ok: true, env: served };
    }
    return refusal(group ? CREDENTIAL_REFUSAL.storeUnavailable : await refusalFor(project, provider));
  }

  async function reply(line: string): Promise<CredentialReply> {
    const request = parseCredentialRequest(line);
    if (!request) return BAD_REQUEST;
    try {
      const result = await answer(request);
      if (!result.ok) log(msg('logs.credentialRefused', { provider: request.provider, reason: result.reason }));
      return result;
    } catch {
      return refusal(CREDENTIAL_REFUSAL.storeUnavailable);
    }
  }

  const connections = new Set<net.Socket>();

  function onConnection(socket: net.Socket) {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
    let received = '';
    let settled = false;
    const deadline = setTimeout(() => socket.destroy(), limits.connectionMs);
    socket.on('close', () => clearTimeout(deadline));
    const finish = (result: CredentialReply) => {
      socket.pause();
      socket.end(`${JSON.stringify(result)}\n`);
    };
    socket.setEncoding('utf8');
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      if (settled) return;
      received += chunk;
      const end = received.indexOf('\n');
      if (end >= 0 && end <= limits.requestBytes) {
        settled = true;
        void reply(received.slice(0, end)).then(finish);
      } else if (received.length > limits.requestBytes) {
        settled = true;
        finish(refusal(CREDENTIAL_REFUSAL.tooLarge));
      }
    });
  }

  const server = net.createServer(onConnection);
  server.maxConnections = limits.connections;
  server.on('error', () => log(msg('logs.credentialSocketFailed', { path: socketPath })));

  function clearStaleSocket(): boolean {
    if (isPipe) return true;
    try {
      if (!fs.lstatSync(socketPath).isSocket()) {
        log(msg('logs.credentialSocketBusy', { path: socketPath }));
        return false;
      }
      fs.unlinkSync(socketPath);
    } catch {
      return true;
    }
    return true;
  }

  function start(): Promise<boolean> {
    if (!clearStaleSocket()) return Promise.resolve(false);
    return new Promise((resolve) => {
      const failed = () => resolve(false);
      server.once('error', failed);
      server.listen({ path: socketPath, readableAll: false, writableAll: false }, () => {
        server.off('error', failed);
        if (!isPipe) fs.chmodSync(socketPath, SOCKET_MODE);
        log(msg('logs.credentialSocketReady', { path: socketPath }));
        resolve(true);
      });
    });
  }

  function close(): Promise<void> {
    return new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      connections.forEach((socket) => { socket.destroy(); });
      if (!isPipe) fs.rmSync(socketPath, { force: true });
    });
  }

  return { start, close };
}

export { createCredentialServer };
export type { CredentialServerDeps };
