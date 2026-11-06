import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountLookup } from '../src/main/lantern-host-account';
import { HOST_TTL_MS, createHostStatus } from '../src/main/lantern-host-status';
import type { HostStatusOptions } from '../src/main/lantern-host-status';
import { fetchPrs, loadPrs, loadPrsDetailed } from '../src/main/lantern-prs';
import { createAuthWorld } from './helpers/auth-world';
import { startFakeBitbucket } from './helpers/fake-bitbucket';
import { startFakeGithub } from './helpers/fake-github';
import type { FakeGithub } from './helpers/fake-github';
import { branchOff, commitFile, commitRecord, git, makeWorld, mergeNoFf, squashMerge } from './helpers/git-repo';
import type { World } from './helpers/git-repo';
import { BITBUCKET_ORIGIN, GITHUB_ORIGIN, makeHostWorld } from './helpers/host-world';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const TOKEN = `ghp_${randomBytes(20).toString('hex')}`;
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
const FAILED_NOTE = /Host status unavailable: the request to GitHub failed, so a merged or declined pull request may still show as open\./;
const NO_ACCOUNT_NOTE = /Host status unavailable, so a merged or declined pull request may still show as open: add your GitHub account in Lantern \(command palette, Integrations\)\./;

let fake: FakeGithub;
let world: World;
let savedSshCommand: string | undefined;
let logged: unknown[][];
let clock: number;

beforeEach(async () => {
  fake = await startFakeGithub();
  clock = 1_000_000;
  savedSshCommand = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = 'false';
  logged = [];
  for (const method of CONSOLE_METHODS) vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (savedSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
  else process.env.GIT_SSH_COMMAND = savedSshCommand;
  await fake.close();
  if (world) fs.rmSync(world.dir, { recursive: true, force: true });
});

function accounts(addToken: string | null = TOKEN) {
  const surroundings = createAuthWorld({ host: { provider: 'github', owner: 'acme', repo: 'shop' } });
  if (addToken) surroundings.addStatic('github', addToken, 'dev');
  return surroundings;
}

function service(extra: HostStatusOptions = {}) {
  return createHostStatus({ baseUrl: fake.baseUrl, env: {}, timeoutMs: 1000, now: () => clock, account: accountLookup(accounts().auth), ...extra });
}

async function load(host: ReturnType<typeof service>, force = false) {
  await fetchPrs(world.project, force, host);
  return loadPrsDetailed(world.project, new Set(), host);
}

const statesOf = (prs: { id: string; state: string }[]) => Object.fromEntries(prs.map((p) => [p.id, p.state]));

describe('GitHub pull request state', () => {
  it.each([
    ['open', 'open'],
    ['merged', 'merged'],
    ['declined', 'declined'],
  ] as const)('maps a %s answer to %s', async (answer, expected) => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.state(126, answer);
    const { prs, warnings } = await load(service());
    expect(statesOf(prs)).toEqual({ 126: expected });
    expect(warnings).toEqual([]);
  });

  it('asks the single pull request endpoint with the bearer token and the versioned JSON headers', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.state(126, 'open');
    await load(service());
    expect(fake.requests).toEqual([{ url: '/repos/acme/shop/pulls/126', authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', apiVersion: '2022-11-28' }]);
  });

  it('reads a closed pull request with only merged_at set as merged', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.reply(126, { body: JSON.stringify({ state: 'closed', merged_at: '2026-10-01T10:00:00Z' }) });
    expect(statesOf((await load(service())).prs)).toEqual({ 126: 'merged' });
  });

  it('carries the base branch the host reports onto an open pull request and nothing else', async () => {
    world = makeHostWorld([126, 127], GITHUB_ORIGIN);
    fake.state(126, 'open', { base: { ref: 'develop' }, title: 'host title', user: { login: 'someone' }, head: { ref: 'other' } });
    fake.state(127, 'open', { base: { ref: 'bad\nname' } });
    const { prs } = await load(service());
    const byId = Object.fromEntries(prs.map((p) => [p.id, p]));
    expect(byId['126']).toMatchObject({ state: 'open', hostBase: 'develop', title: 'pr 126', branch: 'feat/pr-126' });
    expect(byId['127']).not.toHaveProperty('hostBase');
  });

  it('shows a squash-merged pull request as merged only through the host answer', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    squashMerge(world.project, 'feat/pr-126', 126);
    fake.state(126, 'merged');
    const host = service();
    expect(statesOf((await loadPrsDetailed(world.project, new Set(), host)).prs)).toEqual({ 126: 'open' });
    expect(fake.requests).toHaveLength(0);
    expect(statesOf((await load(host)).prs)).toEqual({ 126: 'merged' });
  });

  it('shows a squash-merged pull request whose branch is gone as merged, not closed', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    squashMerge(world.project, 'feat/pr-126', 126);
    git(world.project, ['update-ref', '-d', 'refs/remotes/origin/feat/pr-126']);
    fake.state(126, 'merged');
    const host = service();
    expect(statesOf((await loadPrsDetailed(world.project, new Set(), host)).prs)).toEqual({ 126: 'closed' });
    expect(statesOf((await load(host)).prs)).toEqual({ 126: 'merged' });
  });

  it('shows a pull request git calls open as declined when the host says closed without a merge', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.state(126, 'declined');
    expect(statesOf((await load(service())).prs)).toEqual({ 126: 'declined' });
  });

  it('prefers the host over a commit message that says merged', async () => {
    world = makeHostWorld([40], GITHUB_ORIGIN);
    mergeNoFf(world.project, 'feat/pr-40', 40);
    const host = service();
    expect(statesOf((await loadPrsDetailed(world.project, new Set(), host)).prs)).toEqual({ 40: 'merged' });
    fake.state(40, 'open');
    const { prs } = await load(host);
    expect(prs[0]).toMatchObject({ id: '40', state: 'open' });
    expect(prs[0]).not.toHaveProperty('mergedAt');
  });

  it('keeps the commit scan state when the host answer failed', async () => {
    world = makeHostWorld([40], GITHUB_ORIGIN);
    mergeNoFf(world.project, 'feat/pr-40', 40);
    fake.reply(40, { status: 500 });
    const { prs, warnings } = await load(service());
    expect(statesOf(prs)).toEqual({ 40: 'merged' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(FAILED_NOTE);
  });

  it('sorts a declined pull request after the open and merged ones', async () => {
    world = makeHostWorld([126, 127, 128], GITHUB_ORIGIN);
    fake.state(126, 'declined');
    fake.state(127, 'open');
    fake.state(128, 'merged');
    const { prs } = await load(service());
    expect(prs.map((p) => `${p.id}:${p.state}`)).toEqual(['127:open', '128:merged', '126:declined']);
  });

  it('asks about each pull request once, in parallel but capped', async () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    world = makeHostWorld(ids, GITHUB_ORIGIN);
    for (const id of ids) fake.reply(id, { body: JSON.stringify({ state: id % 2 ? 'closed' : 'open', merged: false }), delayMs: 40 });
    const { prs } = await load(service());
    expect(fake.requests).toHaveLength(ids.length);
    expect(fake.peak()).toBeGreaterThan(1);
    expect(fake.peak()).toBeLessThanOrEqual(4);
    expect(statesOf(prs)).toMatchObject({ 1: 'declined', 2: 'open', 7: 'declined', 8: 'open' });
  });
});

describe('GitHub lookup failures', () => {
  const failures: [string, () => void][] = [
    ['a 404', () => fake.reply(126, { status: 404, body: '{"message":"Not Found"}' })],
    ['a 401', () => fake.reply(126, { status: 401, body: '{"message":"Bad credentials"}' })],
    ['a 403 with requests left', () => fake.reply(126, { status: 403, headers: { 'x-ratelimit-remaining': '4000' }, body: '{"message":"Resource not accessible"}' })],
    ['a 500', () => fake.reply(126, { status: 500 })],
    ['a timeout', () => fake.reply(126, { delayMs: 5000, body: '{"state":"open"}' })],
    ['malformed JSON', () => fake.reply(126, { body: '{"state": "clo' })],
    ['an unknown state', () => fake.reply(126, { body: '{"state":"weird"}' })],
    ['a redirect to another host', () => fake.reply(126, { status: 302, headers: { Location: 'http://localhost:9/steal' } })],
  ];

  it.each(failures)('keeps the git state and says so once after %s', async (_name, arrange) => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    arrange();
    const { prs, warnings } = await load(service({ timeoutMs: 150 }));
    expect(statesOf(prs)).toEqual({ 126: 'open' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(FAILED_NOTE);
    expect(warnings[0]).not.toContain('\n');
  });

  it('keeps the git state and says so once after a network error', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    const gone = await startFakeGithub();
    const { baseUrl } = gone;
    await gone.close();
    const { prs, warnings } = await load(service({ baseUrl }));
    expect(statesOf(prs)).toEqual({ 126: 'open' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(FAILED_NOTE);
  });

  it('retries a failed lookup on the next refresh', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.reply(126, { status: 403, headers: { 'x-ratelimit-remaining': '4000' } });
    const host = service();
    expect(statesOf((await load(host)).prs)).toEqual({ 126: 'open' });
    fake.state(126, 'declined');
    const second = await load(host);
    expect(statesOf(second.prs)).toEqual({ 126: 'declined' });
    expect(second.warnings).toEqual([]);
  });

  it('never sends the token to another origin on a cross-host redirect', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    const other = await startFakeGithub();
    try {
      fake.reply(126, { status: 302, headers: { Location: `${other.baseUrl}/repos/acme/shop/pulls/126` } });
      other.state(126, 'declined');
      expect(statesOf((await load(service())).prs)).toEqual({ 126: 'open' });
      expect(other.requests).toHaveLength(0);
    } finally {
      await other.close();
    }
  });
});

describe('GitHub rate limit', () => {
  const limited = { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }, body: '{"message":"API rate limit exceeded"}' };

  it('notes the failure and stops asking until the cache window has passed', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.reply(126, limited);
    const host = service();
    const first = await load(host);
    expect(statesOf(first.prs)).toEqual({ 126: 'open' });
    expect(first.warnings).toHaveLength(1);
    expect(first.warnings[0]).toMatch(FAILED_NOTE);
    expect(fake.requests).toHaveLength(1);
    clock += HOST_TTL_MS - 1000;
    await load(host);
    await load(host, true);
    expect(fake.requests).toHaveLength(1);
    fake.state(126, 'declined');
    clock += 2000;
    expect(statesOf((await load(host)).prs)).toEqual({ 126: 'declined' });
    expect(fake.requests).toHaveLength(2);
  });

  it('treats a 429 and a 403 with Retry-After the same way', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.reply(126, { status: 429 });
    const host = service();
    await load(host);
    await load(host);
    expect(fake.requests).toHaveLength(1);
    fake.reply(126, { status: 403, headers: { 'retry-after': '60' } });
    clock += HOST_TTL_MS + 1;
    await load(host);
    await load(host);
    expect(fake.requests).toHaveLength(2);
  });

  it('sends no further request of the same refresh once one was limited', async () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    world = makeHostWorld(ids, GITHUB_ORIGIN);
    for (const id of ids) fake.reply(id, limited);
    const { warnings } = await load(service());
    expect(fake.requests).toHaveLength(4);
    expect(warnings).toHaveLength(1);
  });

  it('is kept per project', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.reply(126, limited);
    const host = service();
    await load(host);
    const other = makeHostWorld([126], GITHUB_ORIGIN);
    try {
      fake.state(126, 'declined');
      await fetchPrs(other.project, false, host);
      expect(statesOf((await loadPrsDetailed(other.project, new Set(), host)).prs)).toEqual({ 126: 'declined' });
    } finally {
      fs.rmSync(other.dir, { recursive: true, force: true });
    }
  });
});

describe('GitHub answer cache', () => {
  it('answers from the cache inside the TTL, asks again after it and drops it on a forced refresh', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.state(126, 'declined');
    const host = service();
    await load(host);
    clock += HOST_TTL_MS - 1000;
    await load(host);
    expect(fake.requests).toHaveLength(1);
    fake.state(126, 'merged');
    await load(host, true);
    expect(fake.requests).toHaveLength(2);
    clock += HOST_TTL_MS + 1;
    fake.state(126, 'open');
    expect(statesOf((await load(host)).prs)).toEqual({ 126: 'open' });
    expect(fake.requests).toHaveLength(3);
  });
});

function worldWithRecords(origin: string, records: [id: number, url: string][]): World {
  const created = makeWorld();
  for (const [id, url] of records) {
    const branch = `feat/pr-${id}`;
    branchOff(created.project, branch);
    const head = commitFile(created.project, `src/${id}.ts`, `export const n = ${id};\n`, `work ${id}`);
    commitRecord(created.project, { id, branch, head, url });
    git(created.project, ['push', '-q', 'origin', branch]);
    git(created.project, ['checkout', '-q', 'main']);
  }
  git(created.project, ['remote', 'set-url', 'origin', origin]);
  return created;
}

describe('which pull requests are asked on which host', () => {
  it('does not ask GitHub about a record whose URL is on Bitbucket', async () => {
    world = worldWithRecords(GITHUB_ORIGIN, [
      [126, 'https://github.com/acme/shop/pull/126'],
      [127, 'https://bitbucket.org/acme/shop/pull-requests/127'],
    ]);
    fake.state(126, 'declined');
    fake.state(127, 'declined');
    const { prs } = await load(service());
    expect(fake.requests.map((r) => r.url)).toEqual(['/repos/acme/shop/pulls/126']);
    expect(statesOf(prs)).toEqual({ 126: 'declined', 127: 'open' });
  });

  it('does not ask Bitbucket about a record whose URL is on GitHub', async () => {
    const bitbucket = await startFakeBitbucket();
    world = worldWithRecords(BITBUCKET_ORIGIN, [[126, 'https://github.com/acme/shop/pull/126']]);
    bitbucket.state(126, 'DECLINED');
    try {
      const host = createHostStatus({ baseUrl: bitbucket.baseUrl, env: { BITBUCKET_EMAIL: 'dev@example.com', BITBUCKET_API_TOKEN: 'ATATT-x' }, timeoutMs: 1000 });
      await fetchPrs(world.project, true, host);
      expect(bitbucket.requests).toHaveLength(0);
      expect(statesOf((await loadPrsDetailed(world.project, new Set(), host)).prs)).toEqual({ 126: 'open' });
    } finally {
      await bitbucket.close();
    }
  });

  it('asks nobody about a project whose origin is on another host', async () => {
    world = makeHostWorld([126], 'git@gitlab.com:acme/shop.git');
    fake.state(126, 'declined');
    const { prs, warnings } = await load(service());
    expect(statesOf(prs)).toEqual({ 126: 'open' });
    expect(warnings).toEqual([]);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('where the GitHub origin is read from', () => {
  it.each([
    ['git@github.com:acme/shop.git', undefined],
    ['https://github.com/acme/shop', undefined],
    ['https://dev:secret@github.com/acme/shop.git', undefined],
    ['ssh://git@github.com/acme/shop.git', undefined],
    ['ssh://git@ssh.github.com:443/acme/shop.git', undefined],
    ['git@ssh.github.com:acme/shop.git', undefined],
    ['git@work-gh:acme/shop.git', 'github.com'],
    ['git@gh-443:acme/shop.git', 'ssh.github.com'],
  ])('asks GitHub for the origin %s', async (origin, resolved) => {
    world = makeHostWorld([126], origin);
    fake.state(126, 'declined');
    const resolveHostname = vi.fn().mockResolvedValue(resolved ?? null);
    const { prs } = await load(service({ resolveHostname }));
    expect(statesOf(prs)).toEqual({ 126: 'declined' });
    expect(fake.requests.map((r) => r.url)).toEqual(['/repos/acme/shop/pulls/126']);
  });

  it('refuses an owner or repository with unsafe characters', async () => {
    world = makeHostWorld([126], 'https://github.com/acme/sh$op.git');
    await load(service());
    expect(fake.requests).toHaveLength(0);
  });
});

describe('the GitHub account a project uses', () => {
  const authorization = () => fake.requests.map((r) => r.authorization);

  it('uses the only account by default', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.state(126, 'declined');
    const { prs, warnings } = await load(service());
    expect(statesOf(prs)).toEqual({ 126: 'declined' });
    expect(warnings).toEqual([]);
    expect(authorization()).toEqual([`Bearer ${TOKEN}`]);
  });

  it('uses the account chosen for the project, whatever other accounts exist', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.state(126, 'declined');
    const surroundings = accounts(null);
    surroundings.addStatic('github', `ghp_${randomBytes(20).toString('hex')}`, 'first');
    const chosenToken = `ghp_${randomBytes(20).toString('hex')}`;
    const chosen = surroundings.addStatic('github', chosenToken, 'chosen').profile;
    surroundings.auth.bind('github', chosen.id, world.project);
    await load(service({ account: accountLookup(surroundings.auth) }));
    expect(authorization()).toEqual([`Bearer ${chosenToken}`]);
  });

  it('asks for a choice instead of guessing between several accounts', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    const surroundings = accounts(null);
    surroundings.addStatic('github', `ghp_${randomBytes(20).toString('hex')}`, 'first');
    surroundings.addStatic('github', `ghp_${randomBytes(20).toString('hex')}`, 'second');
    const { prs, warnings } = await load(service({ account: accountLookup(surroundings.auth) }));
    expect(statesOf(prs)).toEqual({ 126: 'open' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(NO_ACCOUNT_NOTE);
    expect(fake.requests).toHaveLength(0);
  });

  it('notes the missing account once, makes no request and keeps the git state', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.state(126, 'declined');
    const { prs, warnings } = await load(service({ account: accountLookup(accounts(null).auth) }));
    expect(statesOf(prs)).toEqual({ 126: 'open' });
    expect(fake.requests).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(NO_ACCOUNT_NOTE);
    expect(warnings[0]).not.toMatch(/GITHUB_TOKEN|\.env/);
  });

  it('notes the missing account when nothing was wired at all, and ignores the process environment', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.state(126, 'declined');
    const host = createHostStatus({ baseUrl: fake.baseUrl, env: { GITHUB_TOKEN: TOKEN }, timeoutMs: 1000 });
    const { warnings } = await load(host);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(NO_ACCOUNT_NOTE);
    expect(fake.requests).toHaveLength(0);
  });

  it('does not use a Bitbucket account for a GitHub project', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    const surroundings = accounts(null);
    surroundings.addStatic('bitbucket', 'ATATT-account-token', 'dev', { email: 'dev@example.com' });
    const { warnings } = await load(service({ account: accountLookup(surroundings.auth) }));
    expect(warnings).toHaveLength(1);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('the token stays out of everything the app returns', () => {
  const everythingReturned = async (host: ReturnType<typeof service>) => {
    const fetched = await fetchPrs(world.project, true, host);
    const loaded = await loadPrs(world.project, new Set(), host);
    return JSON.stringify({ fetched, loaded, logged });
  };

  it('on a lookup that echoes the token back in a refusal', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.reply(126, { status: 401, body: JSON.stringify({ message: `Bad credentials Bearer ${TOKEN}` }), headers: { 'x-echo': TOKEN } });
    const text = await everythingReturned(service());
    expect(text).toContain('Host status unavailable');
    expect(text).not.toContain(TOKEN);
  });

  it('on a successful lookup, a rate limit, a timeout and a redirect', async () => {
    world = makeHostWorld([126], GITHUB_ORIGIN);
    fake.state(126, 'declined');
    expect(await everythingReturned(service())).not.toContain(TOKEN);
    fake.reply(126, { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: `denied for ${TOKEN}` });
    expect(await everythingReturned(service())).not.toContain(TOKEN);
    fake.reply(126, { delayMs: 3000 });
    expect(await everythingReturned(service({ timeoutMs: 100 }))).not.toContain(TOKEN);
    fake.reply(126, { status: 302, headers: { Location: `http://127.0.0.1:9/?t=${TOKEN}` } });
    expect(await everythingReturned(service())).not.toContain(TOKEN);
    for (const request of fake.requests) expect(request.url).not.toContain(TOKEN);
  });
});
