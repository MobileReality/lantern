import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { createCredentialServer } from '../../src/main/auth/credential-server';
import type { CredentialServerDeps } from '../../src/main/auth/credential-server';
import { credentialSocketPath } from '../../src/main/auth/credential-socket';
import type { CredentialReply } from '../../src/main/auth/credential-socket';
import { knownProject } from '../../src/main/auth/known-project';
import type { CodeHost } from '../../src/main/lantern-host-origin';
import { createAuthWorld } from './auth-world';

const GITHUB_HOST: CodeHost = { provider: 'github', owner: 'acme', repo: 'shop' };

const stopWorlds: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stopWorlds.splice(0)) await stop();
});

interface CredentialWorldOptions {
  host?: CodeHost | null;
  authWorld?: Parameters<typeof createAuthWorld>[0];
  opened?: string[];
  auth?: CredentialServerDeps['auth'];
  limits?: CredentialServerDeps['limits'];
}

function exchange(socketPath: string, text: string, waitMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    let received = '';
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => socket.destroy(), waitMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(text));
    socket.on('data', (chunk: string) => (received += chunk));
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(received);
    });
  });
}

async function createCredentialWorld(options: CredentialWorldOptions = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-')));
  const project = path.join(root, 'shop');
  const link = path.join(root, 'shop-link');
  const outside = path.join(root, 'elsewhere');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(outside);
  fs.symlinkSync(project, link);
  const userData = path.join(root, 'ud');
  fs.mkdirSync(userData);
  const world = createAuthWorld({ host: options.host === undefined ? GITHUB_HOST : options.host, ...options.authWorld });
  const opened = options.opened ?? [project];
  const socketPath = credentialSocketPath({ userData, platform: process.platform, username: 'tester', dev: false });
  const server = createCredentialServer({
    socketPath,
    auth: options.auth ?? world.auth,
    knownProject: (dir) => knownProject(dir, opened),
    log: (line) => world.logs.push(line),
    limits: options.limits,
  });
  expectStarted(await server.start());
  stopWorlds.push(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const raw = (text: string, waitMs?: number) => exchange(socketPath, text, waitMs);
  const ask = async (directory: string, provider: string): Promise<CredentialReply> => JSON.parse(await raw(`${JSON.stringify({ project: directory, provider })}\n`));
  return { ...world, root, project, link, outside, userData, socketPath, server, raw, ask };
}

function expectStarted(started: boolean) {
  if (!started) throw new Error('the credential server did not start');
}

export { GITHUB_HOST, createCredentialWorld, exchange };
