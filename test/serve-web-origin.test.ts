import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchServerPage } from '../src/main/serveweb-probe';
import { chooseServerCommand, directServerArgs, serveWebArgs, type ServerCommandRequest } from '../src/main/serveweb-launch';

const TOKEN = 'f3a9c1d27b4e4a0f9d6c5b81e2a7f034';
const WITHOUT_TOKEN_FLAG = '--without-connection-token';
const TOKEN_FLAG = '--connection-token';
const DIRS = { data: '/d', extensions: '/e', user: '/u' };
const SRC = path.resolve(__dirname, '../src');

function tokenAfterFlag(args: string[]) {
  const at = args.indexOf(TOKEN_FLAG);
  return at === -1 ? undefined : args[at + 1];
}

function request(extra: Partial<ServerCommandRequest>): ServerCommandRequest {
  return {
    codeBin: '/app/bin/code',
    port: 9888,
    token: TOKEN,
    home: '/home',
    platform: 'darwin',
    dirs: DIRS,
    fs: { realpath: (f) => f, readText: () => null, isExecutable: () => false },
    reclaimIdleHosts: false,
    directLaunchFailed: false,
    ...extra,
  };
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|mjs|sh|ps1)$/.test(e.name) ? [full] : [];
  });
}

describe('Lantern starts the embedded editor server with a connection token, so a foreign origin has none to present', () => {
  it('starts serve-web with the token and never without one', () => {
    const args = serveWebArgs(9888, TOKEN);
    expect(args).not.toContain(WITHOUT_TOKEN_FLAG);
    expect(tokenAfterFlag(args)).toBe(TOKEN);
  });

  it('starts the directly launched server with the token and never without one', () => {
    const args = directServerArgs(9888, TOKEN, DIRS);
    expect(args).not.toContain(WITHOUT_TOKEN_FLAG);
    expect(tokenAfterFlag(args)).toBe(TOKEN);
  });

  it.each([
    ['serve-web', request({})],
    ['direct launch', request({ reclaimIdleHosts: true, fs: { realpath: (f) => f, readText: () => JSON.stringify({ commit: 'a'.repeat(40), dataFolderName: '.vscode' }), isExecutable: () => true } })],
  ])('chooses a %s command that carries the token', (_kind, req) => {
    const command = chooseServerCommand(req);
    expect(command.args).not.toContain(WITHOUT_TOKEN_FLAG);
    expect(tokenAfterFlag(command.args)).toBe(TOKEN);
  });

  it('binds the directly launched server to loopback only', () => {
    const args = directServerArgs(9888, TOKEN, DIRS);
    expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1');
  });

  it('has no launch path anywhere in the app that turns the token off', () => {
    const offenders = sourceFiles(SRC).filter((file) => fs.readFileSync(file, 'utf8').includes(WITHOUT_TOKEN_FLAG));
    expect(offenders).toEqual([]);
  });
});

describe('the readiness probe presents the connection token (fake server that refuses requests without it)', () => {
  let server: http.Server | undefined;

  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  function listen(): Promise<number> {
    server = http.createServer((req, res) => {
      const presented = String(req.headers.cookie ?? '').includes(`vscode-tkn=${TOKEN}`);
      res.statusCode = presented ? 200 : 403;
      res.end(presented ? '<html>workbench</html>' : 'Forbidden');
    });
    return new Promise((resolve) => server!.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port)));
  }

  const probe = (port: number, token: string) => new Promise((resolve) => fetchServerPage(port, 2000, token, resolve));

  it('sees the editor with the right token', async () => {
    expect(await probe(await listen(), TOKEN)).toBe('workbench');
  });

  it('does not see the editor with another token', async () => {
    expect(await probe(await listen(), 'someone-elses')).toBe('other');
  });
});
