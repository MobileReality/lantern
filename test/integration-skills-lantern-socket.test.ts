import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_REFUSAL } from '@shared/auth-kinds';
import { credentialSocketPath } from '@main/auth/credential-socket';
import { createRouter, fakeFetch } from './helpers/fake-host';
import type { Route } from './helpers/fake-host';
import { shortFolder, startFakeLantern } from './helpers/fake-lantern';
import { SKILLS_ROOT, runSkill } from './helpers/skill-runner';

const SITE = 'https://example.atlassian.net';
const SECRET = 'lantern-granted-secret-4f9a1c';
const NO_PRS = { body: [] };

interface Case {
  skill: string;
  provider: string;
  argv: string[];
  granted: Record<string, string>;
  routes: Route[];
  expected: string;
  missing: string;
  authorization: string;
}

const CASES: Case[] = [
  {
    skill: 'lantern-github',
    provider: 'github',
    argv: ['list'],
    granted: { GITHUB_TOKEN: SECRET },
    routes: [{ method: 'GET', url: 'https://api.github.com/repos/example-owner/shop/pulls?state=open', reply: NO_PRS }],
    expected: 'No open pull requests.',
    missing: 'Missing GITHUB_TOKEN.',
    authorization: `Bearer ${SECRET}`,
  },
  {
    skill: 'lantern-bitbucket',
    provider: 'bitbucket',
    argv: ['list'],
    granted: { BITBUCKET_EMAIL: 'dev@example.com', BITBUCKET_API_TOKEN: SECRET },
    routes: [{ method: 'GET', url: 'https://api.bitbucket.org/2.0/repositories/example-workspace/shop/pullrequests?state=OPEN', reply: { body: { values: [] } } }],
    expected: 'No open pull requests.',
    missing: 'Missing BITBUCKET_EMAIL, BITBUCKET_API_TOKEN.',
    authorization: `Basic ${Buffer.from(`dev@example.com:${SECRET}`).toString('base64')}`,
  },
  {
    skill: 'lantern-jira',
    provider: 'jira',
    argv: ['get', 'PROJ-1'],
    granted: { ATLASSIAN_EMAIL: 'dev@example.com', GLOBAL_ATLASSIAN_TOKEN: SECRET, ATLASSIAN_BASE_URL: SITE },
    routes: [{ method: 'GET', url: `${SITE}/rest/api/3/issue/PROJ-1?`, reply: { body: { key: 'PROJ-1', fields: { summary: 'Fix the login redirect', status: { name: 'To Do' } } } } }],
    expected: 'PROJ-1: Fix the login redirect',
    missing: 'Missing ATLASSIAN_EMAIL, GLOBAL_ATLASSIAN_TOKEN, ATLASSIAN_BASE_URL.',
    authorization: `Basic ${Buffer.from(`dev@example.com:${SECRET}`).toString('base64')}`,
  },
];

const REMOTES: Record<string, string> = { 'lantern-github': 'git@github.com:example-owner/shop.git', 'lantern-bitbucket': 'git@bitbucket.org:example-workspace/shop.git' };
const fakeGit = (skill: string) => (...args: string[]) => (args[0] === 'remote' && args.length === 1 ? 'origin' : args[0] === 'remote' ? REMOTES[skill] : '');

const REASON_TEXT = [
  [CREDENTIAL_REFUSAL.noAccount, 'account yet: add one in Lantern (command palette, Integrations), then choose an account for this project in Integrations.'],
  [CREDENTIAL_REFUSAL.chooseAccount, 'is chosen for this project: choose an account for this project in Integrations (command palette, Integrations).'],
  [CREDENTIAL_REFUSAL.storeUnavailable, 'its secret store is locked or unavailable'],
  [CREDENTIAL_REFUSAL.unknownProject, 'This folder is not a project opened in Lantern'],
  [CREDENTIAL_REFUSAL.badRequest, 'Lantern refused the request.'],
  [CREDENTIAL_REFUSAL.tooLarge, 'Lantern refused the request.'],
] as const;

const NOT_RUNNING_TEXT = 'Lantern is not running or does not answer; start it.';

it('covers every refusal the server can send', () => {
  expect(REASON_TEXT.map(([reason]) => reason).sort()).toEqual(Object.values(CREDENTIAL_REFUSAL).sort());
});

async function runCase(entry: Case, deps: Parameters<typeof runSkill>[2]) {
  const router = createRouter(entry.routes);
  const result = await runSkill(entry.skill, entry.argv, { git: fakeGit(entry.skill), ...deps, fetch: fakeFetch(router) });
  return { ...result, router };
}

describe.each(CASES)('$skill asks Lantern when its variables are missing', (entry) => {
  it('uses the environment and never contacts the socket when the variables are set', async () => {
    const folder = shortFolder();
    const socket = path.join(folder, 'lantern.sock');
    const lantern = await startFakeLantern(socket, { ok: true, env: { ...entry.granted, [Object.keys(entry.granted)[0]]: 'from-the-socket' } });
    const result = await runCase(entry, { env: entry.granted, cwd: folder, lantern: { paths: [socket] } });
    expect(result.code).toBe(0);
    expect(lantern.requests).toEqual([]);
    expect(result.router.calls.filter((call) => !call.url.includes('/_edge/'))[0].headers.authorization).toBe(entry.authorization);
  });

  it('uses the answer of the socket in memory when the environment has none', async () => {
    const folder = shortFolder();
    const socket = path.join(folder, 'lantern.sock');
    const lantern = await startFakeLantern(socket, { ok: true, env: entry.granted });
    const result = await runCase(entry, { env: {}, cwd: folder, lantern: { paths: [socket] } });
    expect(result.code).toBe(0);
    expect(result.out).toContain(entry.expected);
    expect(lantern.requests).toEqual([{ project: folder, provider: entry.provider }]);
    expect(result.router.calls.length).toBeGreaterThan(0);
    for (const call of result.router.calls.filter((sent) => !sent.url.includes('/_edge/'))) expect(call.headers.authorization).toBe(entry.authorization);
    expect(`${result.out}${result.err}`).not.toContain(SECRET);
    expect(process.env[Object.keys(entry.granted)[0]]).toBeUndefined();
  });

  it('prints the existing message and the reason when nothing listens', async () => {
    const folder = shortFolder();
    const result = await runCase(entry, { env: {}, cwd: folder, lantern: { paths: [path.join(folder, 'absent.sock')] } });
    expect(result.code).toBe(1);
    expect(result.out).toBe('');
    expect(result.err.trim().split('\n')).toHaveLength(1);
    expect(result.err).toContain(entry.missing);
    expect(result.err).toContain('command palette, Integrations');
    expect(result.err).toContain(NOT_RUNNING_TEXT);
    expect(result.router.calls).toEqual([]);
  });

  it.each(REASON_TEXT)('prints the reason for the refusal %s', async (reason, text) => {
    const folder = shortFolder();
    const socket = path.join(folder, 'lantern.sock');
    await startFakeLantern(socket, { ok: false, reason });
    const result = await runCase(entry, { env: {}, cwd: folder, lantern: { paths: [socket] } });
    expect(result.code).toBe(1);
    expect(result.err.trim().split('\n')).toHaveLength(1);
    expect(result.err).toContain(entry.missing);
    expect(result.err).toContain(text);
    expect(result.err).not.toContain(NOT_RUNNING_TEXT);
    expect(result.router.calls).toEqual([]);
  });

  it.each([CREDENTIAL_REFUSAL.noAccount, CREDENTIAL_REFUSAL.chooseAccount])('names the fix when no account resolves for the project (%s), and never asks for a token', async (reason) => {
    const folder = shortFolder();
    const socket = path.join(folder, 'lantern.sock');
    await startFakeLantern(socket, { ok: false, reason });
    const result = await runCase(entry, { env: {}, cwd: folder, lantern: { paths: [socket] } });
    expect(result.code).toBe(1);
    expect(result.err).toContain('choose an account for this project in Integrations');
    expect(result.err).not.toMatch(/paste|send (me|us) the token|enter (your|the) token/i);
  });

  it('treats an answer that is not a reply as a refusal and an unknown reason as a generic one', async () => {
    const folder = shortFolder();
    const garbage = path.join(folder, 'a.sock');
    const unknown = path.join(folder, 'b.sock');
    await startFakeLantern(garbage, { hello: 'world' });
    await startFakeLantern(unknown, { ok: false, reason: 'something-new' });
    for (const socket of [garbage, unknown]) {
      const result = await runCase(entry, { env: {}, cwd: folder, lantern: { paths: [socket] } });
      expect(result.code).toBe(1);
      expect(result.err).toContain('Lantern refused the request.');
    }
  });

  it('does not mix an account of Lantern into a partly set environment', async () => {
    const folder = shortFolder();
    const socket = path.join(folder, 'lantern.sock');
    const lantern = await startFakeLantern(socket, { ok: true, env: entry.granted });
    const [first, ...others] = Object.keys(entry.granted).filter((name) => !name.endsWith('BASE_URL'));
    const result = await runCase(entry, { env: { [first]: 'set-by-hand' }, cwd: folder, lantern: { paths: [socket] } });
    expect(lantern.requests).toEqual([]);
    if (others.length) expect(result.err).toContain(`Missing ${others[0]}`);
  });

  it('keeps only the variables of its own provider from an answer', async () => {
    const folder = shortFolder();
    const socket = path.join(folder, 'lantern.sock');
    await startFakeLantern(socket, { ok: true, env: { ...entry.granted, NODE_OPTIONS: '--require=/tmp/evil.js', PATH: '/evil' } });
    const { askLantern } = await import(pathToFileURL(path.join(SKILLS_ROOT, entry.skill, 'scripts', 'lantern-socket.mjs')).href);
    const reply = await askLantern({ provider: entry.provider, names: Object.keys(entry.granted), cwd: folder, paths: [socket] });
    expect(reply).toEqual({ ok: true, env: entry.granted });
  });
});

describe('where a skill looks for the socket', () => {
  const entry = CASES[0];

  it('takes the documented environment variable over everything else', async () => {
    const folder = shortFolder();
    const socket = path.join(folder, 'chosen.sock');
    const lantern = await startFakeLantern(socket, { ok: true, env: entry.granted });
    const result = await runCase(entry, { env: { LANTERN_CREDENTIAL_SOCKET: socket }, cwd: folder, lantern: { home: folder } });
    expect(result.code).toBe(0);
    expect(lantern.requests).toHaveLength(1);
  });

  it('finds the default profile of the platform user-data folder, then the dev profile', async () => {
    const home = shortFolder();
    const dev = path.join(home, '.config', 'Lantern-dev', 'lantern.sock');
    const devServer = await startFakeLantern(dev, { ok: true, env: entry.granted });
    const onlyDev = await runCase(entry, { env: {}, cwd: home, lantern: { home, platform: 'linux' } });
    expect(onlyDev.code).toBe(0);
    expect(devServer.requests).toHaveLength(1);
    const installed = path.join(home, '.config', 'Lantern', 'lantern.sock');
    const installedServer = await startFakeLantern(installed, { ok: true, env: entry.granted });
    const both = await runCase(entry, { env: {}, cwd: home, lantern: { home, platform: 'linux' } });
    expect(both.code).toBe(0);
    expect(installedServer.requests).toHaveLength(1);
    expect(devServer.requests).toHaveLength(1);
  });

  it('asks the dev profile first when the run says it is the dev profile', async () => {
    const home = shortFolder();
    const installedServer = await startFakeLantern(path.join(home, '.config', 'Lantern', 'lantern.sock'), { ok: true, env: entry.granted });
    const devServer = await startFakeLantern(path.join(home, '.config', 'Lantern-dev', 'lantern.sock'), { ok: true, env: entry.granted });
    await runCase(entry, { env: { LANTERN_PROFILE: 'dev' }, cwd: home, lantern: { home, platform: 'linux' } });
    expect(devServer.requests).toHaveLength(1);
    expect(installedServer.requests).toEqual([]);
  });

  it('falls through a stale socket file to the next place', async () => {
    const home = shortFolder();
    const stale = path.join(home, '.config', 'Lantern', 'lantern.sock');
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, '');
    const devServer = await startFakeLantern(path.join(home, '.config', 'Lantern-dev', 'lantern.sock'), { ok: true, env: entry.granted });
    const result = await runCase(entry, { env: {}, cwd: home, lantern: { home, platform: 'linux' } });
    expect(result.code).toBe(0);
    expect(devServer.requests).toHaveLength(1);
  });

  it('does not wait forever for a server that never answers', async () => {
    const folder = shortFolder();
    const socket = path.join(folder, 'silent.sock');
    const net = await import('node:net');
    const server = net.createServer(() => {});
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    const started = Date.now();
    const result = await runCase(entry, { env: {}, cwd: folder, lantern: { paths: [socket], timeoutMs: 80 } });
    server.close();
    expect(result.code).toBe(1);
    expect(result.err).toContain(NOT_RUNNING_TEXT);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('the well-known location is the one the app derives', () => {
  const socketPaths = async () => (await import(pathToFileURL(path.join(SKILLS_ROOT, 'lantern-github', 'scripts', 'lantern-socket.mjs')).href)).socketPaths;
  const USER_DATA = {
    darwin: (home: string) => path.join(home, 'Library', 'Application Support'),
    linux: (home: string) => path.join(home, '.config'),
  } as const;

  it.each(['darwin', 'linux'] as const)('on %s, for the installed and the dev profile', async (platform) => {
    const home = path.join(path.sep, 'home', 'ada');
    const [installed, dev] = (await socketPaths())({ env: {}, platform, home, username: 'ada' });
    expect(installed).toBe(credentialSocketPath({ userData: path.join(USER_DATA[platform](home), 'Lantern'), platform, username: 'ada', dev: false }));
    expect(dev).toBe(credentialSocketPath({ userData: path.join(USER_DATA[platform](home), 'Lantern-dev'), platform, username: 'ada', dev: true }));
  });

  it('on windows, as the named pipe of the user', async () => {
    const [installed, dev] = (await socketPaths())({ env: {}, platform: 'win32', home: 'C:\\Users\\ada', username: 'ada' });
    expect(installed).toBe(credentialSocketPath({ userData: '', platform: 'win32', username: 'ada', dev: false }));
    expect(dev).toBe(credentialSocketPath({ userData: '', platform: 'win32', username: 'ada', dev: true }));
  });

  it('honours the folders a platform lets the user move', async () => {
    const [installed] = (await socketPaths())({ env: { XDG_CONFIG_HOME: '/cfg' }, platform: 'linux', home: '/home/ada', username: 'ada' });
    expect(installed).toBe('/cfg/Lantern/lantern.sock');
  });
});

describe('a token received over the socket is never printed and never stored', () => {
  const SCRIPTS = CASES.flatMap((entry) => fs.readdirSync(path.join(SKILLS_ROOT, entry.skill, 'scripts')).filter((file) => file.endsWith('.mjs') && file !== 'conventions.mjs').map((file) => path.join(SKILLS_ROOT, entry.skill, 'scripts', file)));
  const WRITES = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|rename|mkdtemp|process\.env\s*(\.\w+|\[[^\]]*\])\s*=[^=]|Object\.assign\(\s*process\.env)/;

  it.each(CASES)('$skill leaves no copy of the token in the project, its home or its output', async (entry) => {
    const folder = shortFolder();
    const socket = path.join(folder, 'lantern.sock');
    await startFakeLantern(socket, { ok: true, env: entry.granted });
    const before = new Set(fs.readdirSync(folder));
    const bodies = [
      { env: {}, cwd: folder, lantern: { paths: [socket] } },
      { env: { HOME: folder }, cwd: folder, lantern: { paths: [socket] } },
    ];
    for (const deps of bodies) {
      const result = await runCase(entry, deps);
      expect(`${result.out}${result.err}`).not.toContain(SECRET);
      expect(`${result.out}${result.err}`).not.toContain(Buffer.from(`dev@example.com:${SECRET}`).toString('base64'));
    }
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => (item.isDirectory() ? files(path.join(dir, item.name)) : item.isFile() ? [path.join(dir, item.name)] : []));
    expect(fs.readdirSync(folder).filter((name) => !before.has(name))).toEqual([]);
    for (const file of files(folder)) expect(fs.readFileSync(file, 'utf8')).not.toContain(SECRET);
  });

  it.each(CASES)('$skill still redacts the token if an API echoes it back', async (entry) => {
    const folder = shortFolder();
    const socket = path.join(folder, 'lantern.sock');
    await startFakeLantern(socket, { ok: true, env: entry.granted });
    const echo: Route[] = [{ method: 'GET', url: 'https://', reply: { status: 500, body: { echoed: SECRET } } }];
    const router = createRouter(echo);
    const result = await runSkill(entry.skill, entry.argv, { env: {}, cwd: folder, git: fakeGit(entry.skill), lantern: { paths: [socket] }, fetch: fakeFetch(router) });
    expect(result.code).toBe(1);
    expect(`${result.out}${result.err}`).not.toContain(SECRET);
  });

  it('holds no call that writes a file or sets a variable in any of the three skills', () => {
    const offenders = SCRIPTS.filter((file) => WRITES.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(SKILLS_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it.each(CASES)('$skill keeps its one file writer, the template store, apart from credentials and the socket', (entry) => {
    const text = fs.readFileSync(path.join(SKILLS_ROOT, entry.skill, 'scripts', 'conventions.mjs'), 'utf8');
    expect(text.match(/writeFileSync/g)).toHaveLength(2);
    expect(text).not.toMatch(/credentials|lantern-socket|process\.env|\.env\b|fetch/);
  });

  it('would catch a script that persisted the answer', () => {
    expect(WRITES.test("writeFileSync('.env', token)")).toBe(true);
    expect(WRITES.test('process.env.GITHUB_TOKEN = granted.token;')).toBe(true);
    expect(WRITES.test("process.env['X'] = granted")).toBe(true);
    expect(WRITES.test('Object.assign(process.env, granted)')).toBe(true);
    expect(WRITES.test('const merged = { ...env, ...granted }')).toBe(false);
  });

  it('keeps the client to the network, the platform folders and the messages', () => {
    const source = fs.readFileSync(path.join(SKILLS_ROOT, 'lantern-github', 'scripts', 'lantern-socket.mjs'), 'utf8');
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(([, specifier]) => specifier).sort();
    expect(imports).toEqual(['./messages.mjs', 'node:net', 'node:os', 'node:path']);
  });
});
