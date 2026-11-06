import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRouter, fakeFetch } from './helpers/fake-host';
import type { Route } from './helpers/fake-host';
import { shortFolder, startFakeLantern } from './helpers/fake-lantern';
import { git, makeHostedRepo, runSkill } from './helpers/skill-runner';
import type { HostedRepo } from './helpers/skill-runner';

const SECRET = 'granted-secret-7d1e90';
const BLOCK_FILE = 'block.md';
const NAME = 'delegate:cost';
const BEGIN = `<!-- ${NAME} -->`;
const END = `<!-- /${NAME} -->`;

interface Host {
  skill: string;
  origin: string;
  env: Record<string, string>;
  provider: string;
  granted: Record<string, string>;
  pr: string;
  readPr: (description: string) => Route;
  writeMethod: string;
  written: (body: unknown) => string;
  check: Route[];
  checkReply: string;
  unauthorized: Route[];
  noScope?: Route[];
  lookup: Route;
  create: Route;
  createdBody: (source: string) => unknown;
}

const BB_REPO = 'https://api.bitbucket.org/2.0/repositories/example-workspace/shop';
const GH_REPO = 'https://api.github.com/repos/example-owner/shop';
const SCOPES = { 'x-oauth-scopes': 'read:repository:bitbucket, write:pullrequest:bitbucket' };

const HOSTS: Host[] = [
  {
    skill: 'lantern-bitbucket',
    origin: 'git@bitbucket.org:example-workspace/shop.git',
    env: { BITBUCKET_EMAIL: 'dev@example.com', BITBUCKET_API_TOKEN: SECRET },
    provider: 'bitbucket',
    granted: { BITBUCKET_EMAIL: 'dev@example.com', BITBUCKET_API_TOKEN: SECRET },
    pr: `${BB_REPO}/pullrequests/12`,
    readPr: (description) => ({ method: 'GET', url: `${BB_REPO}/pullrequests/12`, reply: { body: { id: 12, title: 'Add retry', description, links: { html: { href: 'https://bitbucket.org/example-workspace/shop/pull-requests/12' } } } } }),
    writeMethod: 'PUT',
    written: (body) => (body as { description: string }).description,
    check: [{ method: 'GET', url: BB_REPO, reply: { body: {}, headers: SCOPES } }],
    checkReply: 'write:pullrequest is granted on example-workspace/shop.',
    unauthorized: [{ method: 'GET', url: BB_REPO, reply: { status: 401, body: {} } }],
    noScope: [{ method: 'GET', url: BB_REPO, reply: { body: {}, headers: { 'x-oauth-scopes': 'read:repository:bitbucket' } } }],
    lookup: { method: 'GET', url: `${BB_REPO}/pullrequests?q=`, reply: { body: { values: [] } } },
    create: { method: 'POST', url: `${BB_REPO}/pullrequests`, reply: { status: 201, body: { id: 7, links: { html: { href: 'https://bitbucket.org/example-workspace/shop/pull-requests/7' } } } } },
    createdBody: (source) => expect.objectContaining({ source: { branch: { name: source } } }),
  },
  {
    skill: 'lantern-github',
    origin: 'git@github.com:example-owner/shop.git',
    env: { GITHUB_TOKEN: SECRET },
    provider: 'github',
    granted: { GITHUB_TOKEN: SECRET },
    pr: `${GH_REPO}/pulls/12`,
    readPr: (description) => ({ method: 'GET', url: `${GH_REPO}/pulls/12`, reply: { body: { number: 12, title: 'Add retry', body: description, html_url: 'https://github.com/example-owner/shop/pull/12' } } }),
    writeMethod: 'PATCH',
    written: (body) => (body as { body: string }).body,
    check: [
      { method: 'GET', url: 'https://api.github.com/user', reply: { body: { login: 'ada' } } },
      { method: 'GET', url: GH_REPO, reply: { body: {} } },
    ],
    checkReply: 'Authenticated as ada; example-owner/shop is visible to that token.',
    unauthorized: [{ method: 'GET', url: 'https://api.github.com/user', reply: { status: 401, body: {} } }],
    lookup: { method: 'GET', url: `${GH_REPO}/pulls?head=`, reply: { body: [] } },
    create: { method: 'POST', url: `${GH_REPO}/pulls`, reply: { status: 201, body: { number: 9, html_url: 'https://github.com/example-owner/shop/pull/9' } } },
    createdBody: (source) => expect.objectContaining({ head: source }),
  },
];

let repo: HostedRepo;
let folder: string;

beforeEach(() => {
  folder = shortFolder('lpc-');
});

afterEach(() => {
  if (repo) fs.rmSync(repo.dir, { recursive: true, force: true });
});

async function skill(host: Host, routes: Route[], argv: string[], deps: { env?: Record<string, string>; lantern?: { paths: string[] } } = {}) {
  repo = makeHostedRepo(host.origin);
  const router = createRouter(routes);
  const result = await runSkill(host.skill, argv, { env: host.env, cwd: repo.project, ...deps, fetch: fakeFetch(router) });
  return { ...result, router };
}

const prRoutes = (host: Host, description: string): Route[] => [host.readPr(description), { method: host.writeMethod, url: host.pr, reply: { body: {} } }];

const writeBlockFile = (text: string) => {
  const file = path.join(folder, BLOCK_FILE);
  fs.writeFileSync(file, text);
  return file;
};

describe.each(HOSTS)('$skill check', (host) => {
  it('confirms the account against the host and says where it came from, printing no token', async () => {
    const { code, out, err } = await skill(host, host.check, ['check']);
    expect(code).toBe(0);
    expect(out).toContain('(from the environment).');
    expect(out).toContain(host.checkReply);
    expect(`${out}${err}`).not.toContain(SECRET);
  });

  it('prints machine-readable output with --json', async () => {
    const { code, out } = await skill(host, host.check, ['check', '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ source: 'environment', repository: expect.stringMatching(/^example-/) });
    expect(out).not.toContain(SECRET);
  });

  it('does not call the host with --offline', async () => {
    const { code, out, router } = await skill(host, [], ['check', '--offline']);
    expect(code).toBe(0);
    expect(out).toContain('(--offline)');
    expect(router.calls).toEqual([]);
  });

  it('fails with the host hint when the account is not accepted', async () => {
    const { code, err } = await skill(host, host.unauthorized, ['check']);
    expect(code).toBe(1);
    expect(err).toContain('(401)');
    expect(err).not.toContain(SECRET);
  });

  it('names what is missing and sends nothing when no credential resolves', async () => {
    const { code, err, router } = await skill(host, host.check, ['check'], { env: {} });
    expect(code).toBe(1);
    expect(err).toContain('Missing');
    expect(err).toContain('Lantern is not running or does not answer; start it.');
    expect(router.calls).toEqual([]);
  });

  it('takes the account from the Lantern socket when the environment has none and says so', async () => {
    const socket = path.join(folder, 'l.sock');
    const lantern = await startFakeLantern(socket, { ok: true, env: host.granted });
    const { code, out, err, router } = await skill(host, host.check, ['check', '--json'], { env: {}, lantern: { paths: [socket] } });
    expect(code).toBe(0);
    expect(JSON.parse(out).source).toBe('socket');
    expect(lantern.requests).toHaveLength(1);
    expect(lantern.requests[0].provider).toBe(host.provider);
    expect(router.calls.length).toBeGreaterThan(0);
    expect(`${out}${err}`).not.toContain(SECRET);
  });
});

describe('lantern-bitbucket check scope', () => {
  it('fails when the token cannot write pull requests, naming what it has', async () => {
    const host = HOSTS[0];
    const { code, err } = await skill(host, host.noScope ?? [], ['check']);
    expect(code).toBe(1);
    expect(err).toContain('no write:pullrequest');
    expect(err).toContain('read:repository:bitbucket');
  });
});

describe.each(HOSTS)('$skill description-block', (host) => {
  it('appends a marked block to a description that has none', async () => {
    const file = writeBlockFile('## Run cost\n\n| a | b |\n');
    const { code, out, router } = await skill(host, prRoutes(host, 'Existing text.'), ['description-block', '12', '--name', NAME, '--file', file]);
    expect(code).toBe(0);
    expect(out).toContain(`Wrote the ${NAME} block of pull request #12.`);
    const write = router.calls.find((call) => call.method === host.writeMethod);
    expect(host.written(write?.body)).toBe(`Existing text.\n\n${BEGIN}\n\n## Run cost\n\n| a | b |\n\n${END}\n`);
  });

  it('replaces the block of that name instead of stacking a second one, keeping the text around it', async () => {
    const file = writeBlockFile('new table $1');
    const description = `before\n\n${BEGIN}\n\nold\n\n${END}\n\nafter`;
    const { router } = await skill(host, prRoutes(host, description), ['description-block', '12', '--name', NAME, '--file', file]);
    const text = host.written(router.calls.find((call) => call.method === host.writeMethod)?.body);
    expect(text).toBe(`before\n\n${BEGIN}\n\nnew table $1\n\n${END}\n\nafter`);
    expect(text.split(BEGIN)).toHaveLength(2);
  });

  it('replaces only a begin and end pair in order, never swallowing text after an orphaned begin marker', async () => {
    const file = writeBlockFile('new');
    const description = `before ${BEGIN} orphan\n\nkeep this\n\n${BEGIN}\n\nold\n\n${END}\n\nafter`;
    const { router } = await skill(host, prRoutes(host, description), ['description-block', '12', '--name', NAME, '--file', file]);
    const text = host.written(router.calls.find((call) => call.method === host.writeMethod)?.body);
    expect(text).toBe(`before ${BEGIN} orphan\n\nkeep this\n\n${BEGIN}\n\nnew\n\n${END}\n\nafter`);
  });

  it('writes the same text on a second run', async () => {
    const file = writeBlockFile('table');
    const first = await skill(host, prRoutes(host, 'Body.'), ['description-block', '12', '--name', NAME, '--file', file]);
    const once = host.written(first.router.calls.find((call) => call.method === host.writeMethod)?.body);
    const second = await skill(host, prRoutes(host, once), ['description-block', '12', '--name', NAME, '--file', file]);
    expect(host.written(second.router.calls.find((call) => call.method === host.writeMethod)?.body)).toBe(once);
  });

  it('treats an empty description as no description', async () => {
    const file = writeBlockFile('table');
    const { router } = await skill(host, prRoutes(host, ''), ['description-block', '12', '--name', NAME, '--file', file]);
    expect(host.written(router.calls.find((call) => call.method === host.writeMethod)?.body)).toBe(`\n\n${BEGIN}\n\ntable\n\n${END}\n`);
  });

  it.each([
    ['a name that is not a marker', ['--name', 'Bad Name!', '--file', 'x.md'], 'is not a marker name'],
    ['a missing file option', ['--name', NAME], 'Give the block with --name'],
  ])('refuses %s before any request', async (_label, extra, said) => {
    const { code, err, router } = await skill(host, prRoutes(host, 'x'), ['description-block', '12', ...extra]);
    expect(code).toBe(1);
    expect(err).toContain(said);
    expect(router.calls).toEqual([]);
  });

  it('refuses an empty or unreadable block file and a pull request id that is not a number', async () => {
    const empty = await skill(host, prRoutes(host, 'x'), ['description-block', '12', '--name', NAME, '--file', writeBlockFile('  \n')]);
    expect(empty.err).toContain('The block text is empty.');
    const missing = await skill(host, prRoutes(host, 'x'), ['description-block', '12', '--name', NAME, '--file', path.join(folder, 'nope.md')]);
    expect(missing.err).toContain('Could not read the block text');
    const badId = await skill(host, [], ['description-block', '12/../x', '--name', NAME, '--file', writeBlockFile('t')]);
    expect(badId.err).toContain('is not a pull request number');
    expect(badId.router.calls).toEqual([]);
  });

  it('never prints a token even when the host echoes it back', async () => {
    const file = writeBlockFile('table');
    const { out, err } = await skill(host, prRoutes(host, `leaked ${SECRET}`), ['description-block', '12', '--name', NAME, '--file', file]);
    expect(`${out}${err}`).not.toContain(SECRET);
  });
});

describe.each(HOSTS)('$skill create --branch', (host) => {
  it('pushes HEAD to the named branch and opens the pull request from it', async () => {
    const { code, router } = await skill(host, [host.lookup, host.create], ['create', '--title', 'T', '--target', 'main', '--branch', 'feat/named']);
    expect(code).toBe(0);
    expect(router.calls.at(-1)?.body).toEqual(host.createdBody('feat/named'));
    expect(git(repo.bare, 'branch', '--list', 'feat/named')).toContain('feat/named');
    expect(git(repo.bare, 'branch', '--list', 'feat/work')).toBe('');
  });

  it('does not accept the target as the branch', async () => {
    const { code, err, router } = await skill(host, [host.lookup, host.create], ['create', '--title', 'T', '--target', 'main', '--branch', 'main']);
    expect(code).toBe(1);
    expect(err).toContain('there is nothing to review');
    expect(router.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });
});
