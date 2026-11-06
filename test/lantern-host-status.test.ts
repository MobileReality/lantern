import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostStatus } from '../src/main/lantern-host-status';
import type { HostStatusOptions } from '../src/main/lantern-host-status';
import { fetchPrs, loadPrsDetailed } from '../src/main/lantern-prs';
import { startFakeBitbucket } from './helpers/fake-bitbucket';
import type { FakeBitbucket } from './helpers/fake-bitbucket';
import { commitRecord, git, write } from './helpers/git-repo';
import type { World } from './helpers/git-repo';
import { createAuthWorld } from './helpers/auth-world';
import { accountLookup } from '../src/main/lantern-host-account';
import { ENV, makeHostWorld } from './helpers/host-world';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let fake: FakeBitbucket;
let world: World;
let savedSshCommand: string | undefined;

beforeEach(async () => {
  fake = await startFakeBitbucket();
  savedSshCommand = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = 'false';
});

afterEach(async () => {
  if (savedSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
  else process.env.GIT_SSH_COMMAND = savedSshCommand;
  await fake.close();
  if (world) fs.rmSync(world.dir, { recursive: true, force: true });
});

function service(extra: HostStatusOptions = {}) {
  return createHostStatus({ baseUrl: fake.baseUrl, env: ENV, timeoutMs: 1000, ...extra });
}

async function stateOf(host: ReturnType<typeof service>, ids: number[], force = false) {
  world = makeHostWorld(ids);
  await fetchPrs(world.project, force, host);
  const load = await loadPrsDetailed(world.project, new Set(), host);
  return { load, byId: Object.fromEntries(load.prs.map((p) => [p.id, p.state])) };
}

describe('host state mapping', () => {
  it.each([
    ['OPEN', 'open'],
    ['DECLINED', 'declined'],
    ['SUPERSEDED', 'declined'],
    ['MERGED', 'merged'],
  ])('maps the host state %s to %s', async (hostState, expected) => {
    fake.state(126, hostState);
    const { byId } = await stateOf(service(), [126]);
    expect(byId).toEqual({ 126: expected });
    expect(fake.requests.map((r) => r.url)).toEqual(['/2.0/repositories/acme/shop/pullrequests/126']);
  });

  it('keeps a DECLINED answer from leaving the pull request open', async () => {
    fake.state(126, 'DECLINED');
    const { byId, load } = await stateOf(service(), [126]);
    expect(byId[126]).not.toBe('open');
    expect(byId[126]).toBe('declined');
    expect(load.warnings).toEqual([]);
  });

  it('carries the destination branch the host reports onto an open pull request', async () => {
    fake.reply(126, { body: JSON.stringify({ state: 'OPEN', destination: { branch: { name: 'develop' } } }) });
    const { load } = await stateOf(service(), [126]);
    expect(load.prs).toMatchObject([{ id: '126', state: 'open', hostBase: 'develop' }]);
  });

  it('leaves the host base off when the host names none or a malformed one', async () => {
    fake.reply(126, { body: JSON.stringify({ state: 'OPEN' }) });
    fake.reply(127, { body: JSON.stringify({ state: 'OPEN', destination: { branch: { name: 'bad\nname' } } }) });
    const { load } = await stateOf(service(), [126, 127]);
    expect(load.prs).toHaveLength(2);
    for (const p of load.prs) expect(p).not.toHaveProperty('hostBase');
  });

  it('asks about each git-open pull request once, in parallel but capped', async () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const id of ids) fake.reply(id, { body: JSON.stringify({ state: id % 2 ? 'DECLINED' : 'OPEN' }), delayMs: 40 });
    const { byId } = await stateOf(service(), ids);
    expect(fake.requests).toHaveLength(ids.length);
    expect(fake.peak()).toBeGreaterThan(1);
    expect(fake.peak()).toBeLessThanOrEqual(4);
    expect(byId).toMatchObject({ 1: 'declined', 2: 'open', 7: 'declined', 8: 'open' });
  });

  it('sorts a declined pull request after the open ones and the merged ones', async () => {
    fake.state(126, 'DECLINED');
    fake.state(127, 'OPEN');
    fake.state(128, 'MERGED');
    const { load } = await stateOf(service(), [126, 127, 128]);
    expect(load.prs.map((p) => `${p.id}:${p.state}`)).toEqual(['127:open', '128:merged', '126:declined']);
  });

  it('shows the git state first: a plain load never calls the host', async () => {
    fake.state(126, 'DECLINED');
    world = makeHostWorld([126]);
    const load = await loadPrsDetailed(world.project, new Set(), service());
    expect(load.prs.map((p) => p.state)).toEqual(['open']);
    expect(fake.requests).toHaveLength(0);
  });

  it('does not call the host for pull requests git already calls merged or closed', async () => {
    world = makeHostWorld([40]);
    git(world.project, ['merge', '-q', '--no-ff', '-m', 'Merged in feat/pr-40 (pull request #40)', 'feat/pr-40']);
    commitRecord(world.project, { id: 41, branch: 'feat/gone', base: 'main', head: 'd'.repeat(40) });
    fake.state(40, 'DECLINED');
    fake.state(41, 'OPEN');
    const host = service();
    await fetchPrs(world.project, true, host);
    const load = await loadPrsDetailed(world.project, new Set(), host);
    expect(Object.fromEntries(load.prs.map((p) => [p.id, p.state]))).toEqual({ 40: 'merged', 41: 'closed' });
    expect(fake.requests).toHaveLength(0);
    expect(load.warnings).toEqual([]);
  });
});

describe('host lookup failures', () => {
  const failures: [string, () => void][] = [
    ['a 401', () => fake.reply(126, { status: 401, body: '{"error":"no"}' })],
    ['a 403', () => fake.reply(126, { status: 403, body: '{"error":"no"}' })],
    ['a 404', () => fake.reply(126, { status: 404, body: '{}' })],
    ['a timeout', () => fake.reply(126, { delayMs: 5000, body: '{"state":"DECLINED"}' })],
    ['malformed JSON', () => fake.reply(126, { body: '{"state": "DECLI' })],
    ['an unknown state', () => fake.reply(126, { body: '{"state":"WEIRD"}' })],
    ['a redirect to another host', () => fake.reply(126, { status: 302, location: 'http://localhost:9/steal' })],
  ];

  it.each(failures)('keeps the git state and says so once after %s', async (_name, arrange) => {
    arrange();
    const { byId, load } = await stateOf(service({ timeoutMs: 150 }), [126]);
    expect(byId).toEqual({ 126: 'open' });
    expect(load.warnings).toHaveLength(1);
    expect(load.warnings[0]).toMatch(/Host status unavailable: the request to Bitbucket failed/);
    expect(load.warnings[0]).not.toContain('\n');
  });

  it('never sends the credentials to another origin on a cross-host redirect', async () => {
    const other = await startFakeBitbucket();
    try {
      fake.reply(126, { status: 302, location: `${other.origin}/2.0/repositories/acme/shop/pullrequests/126` });
      other.state(126, 'DECLINED');
      const { byId } = await stateOf(service(), [126]);
      expect(byId).toEqual({ 126: 'open' });
      expect(other.requests).toHaveLength(0);
    } finally {
      await other.close();
    }
  });

  it('follows a redirect that stays on the same origin', async () => {
    fake.reply(126, { status: 301, location: '/2.0/repositories/acme/shop/pullrequests/7' });
    fake.state(7, 'DECLINED');
    const { byId } = await stateOf(service(), [126]);
    expect(byId).toEqual({ 126: 'declined' });
  });

  it('retries a failed lookup on the next refresh', async () => {
    fake.reply(126, { status: 500 });
    const host = service();
    const first = await stateOf(host, [126]);
    expect(first.byId).toEqual({ 126: 'open' });
    fake.state(126, 'DECLINED');
    await fetchPrs(world.project, false, host);
    const second = await loadPrsDetailed(world.project, new Set(), host);
    expect(second.prs[0].state).toBe('declined');
    expect(second.warnings).toEqual([]);
  });
});

describe('where the host is read from', () => {
  it('skips the lookup silently for a host other than Bitbucket', async () => {
    fake.state(126, 'DECLINED');
    world = makeHostWorld([126], 'git@github.com:acme/shop.git');
    const host = service();
    await fetchPrs(world.project, true, host);
    const load = await loadPrsDetailed(world.project, new Set(), host);
    expect(load.prs.map((p) => p.state)).toEqual(['open']);
    expect(load.warnings).toEqual([]);
    expect(fake.requests).toHaveLength(0);
  });

  it('resolves an SSH alias the way the delegate scripts do', async () => {
    fake.state(126, 'DECLINED');
    world = makeHostWorld([126], 'git@bb-work:acme/shop.git');
    const resolveHostname = vi.fn().mockResolvedValue('bitbucket.org');
    const host = service({ resolveHostname });
    await fetchPrs(world.project, true, host);
    const load = await loadPrsDetailed(world.project, new Set(), host);
    expect(resolveHostname).toHaveBeenCalledWith('bb-work');
    expect(load.prs.map((p) => p.state)).toEqual(['declined']);
  });

  it('skips an alias that resolves to another host', async () => {
    world = makeHostWorld([126], 'git@gh-work:acme/shop.git');
    const host = service({ resolveHostname: async () => 'github.com' });
    await fetchPrs(world.project, true, host);
    expect(fake.requests).toHaveLength(0);
  });

  it('uses the https origin form too', async () => {
    fake.state(126, 'DECLINED');
    world = makeHostWorld([126], 'https://dev@bitbucket.org/acme/shop.git');
    const host = service();
    await fetchPrs(world.project, true, host);
    expect((await loadPrsDetailed(world.project, new Set(), host)).prs[0].state).toBe('declined');
  });
});

describe('credentials sources', () => {
  const basic = (email: string, token: string) => `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

  it('sends Basic auth from the process environment', async () => {
    fake.state(126, 'OPEN');
    await stateOf(service(), [126]);
    expect(fake.requests[0].authorization).toBe(basic(ENV.BITBUCKET_EMAIL, ENV.BITBUCKET_API_TOKEN));
  });

  it('falls back to the project .ai/.env when the environment has nothing', async () => {
    fake.state(126, 'DECLINED');
    world = makeHostWorld([126]);
    write(world.project, '.ai/.env', 'BITBUCKET_EMAIL=file@example.com\nBITBUCKET_API_TOKEN="file-token-1"\n');
    const host = service({ env: {} });
    await fetchPrs(world.project, true, host);
    expect(fake.requests[0].authorization).toBe(basic('file@example.com', 'file-token-1'));
    expect((await loadPrsDetailed(world.project, new Set(), host)).prs[0].state).toBe('declined');
  });

  it('prefers the environment over the file', async () => {
    fake.state(126, 'OPEN');
    world = makeHostWorld([126]);
    write(world.project, '.ai/.env', 'BITBUCKET_EMAIL=file@example.com\nBITBUCKET_API_TOKEN=file-token-1\n');
    await fetchPrs(world.project, true, service());
    expect(fake.requests[0].authorization).toBe(basic(ENV.BITBUCKET_EMAIL, ENV.BITBUCKET_API_TOKEN));
  });

  it('notes the missing credentials once, makes no request and keeps the git state', async () => {
    fake.state(126, 'DECLINED');
    const host = service({ env: {} });
    const { byId, load } = await stateOf(host, [126]);
    expect(byId).toEqual({ 126: 'open' });
    expect(fake.requests).toHaveLength(0);
    expect(load.warnings).toHaveLength(1);
    expect(load.warnings[0]).toMatch(/Host status unavailable, so a declined pull request may still show as open: add your Bitbucket account in Lantern \(command palette, Integrations\)/);
    expect(load.warnings[0]).not.toMatch(/BITBUCKET_|\.env/);
  });

  it('uses the Bitbucket account added in Lantern with no environment and no .ai/.env', async () => {
    fake.state(126, 'DECLINED');
    const accounts = createAuthWorld({ host: { provider: 'bitbucket', owner: 'acme', repo: 'shop' } });
    accounts.addStatic('bitbucket', 'ATATT-account-token', 'dev', { email: 'dev@example.com' });
    const host = service({ env: {}, account: accountLookup(accounts.auth) });
    const { byId, load } = await stateOf(host, [126]);
    expect(byId).toEqual({ 126: 'declined' });
    expect(load.warnings).toEqual([]);
    expect(fake.requests[0].authorization).toBe(basic('dev@example.com', 'ATATT-account-token'));
  });

  it('falls back to the environment when no account resolves', async () => {
    fake.state(126, 'DECLINED');
    const accounts = createAuthWorld({ host: { provider: 'bitbucket', owner: 'acme', repo: 'shop' } });
    const host = service({ account: accountLookup(accounts.auth) });
    const { byId } = await stateOf(host, [126]);
    expect(byId).toEqual({ 126: 'declined' });
  });

  it('gives no note when no pull request is open by git', async () => {
    world = makeHostWorld([]);
    const host = service({ env: {} });
    await fetchPrs(world.project, true, host);
    expect((await loadPrsDetailed(world.project, new Set(), host)).warnings).toEqual([]);
  });

  it('skips a symlinked .ai/.env', async () => {
    world = makeHostWorld([126]);
    write(world.dir, 'elsewhere.env', 'BITBUCKET_EMAIL=file@example.com\nBITBUCKET_API_TOKEN=file-token-1\n');
    fs.mkdirSync(path.join(world.project, '.ai'), { recursive: true });
    fs.symlinkSync(path.join(world.dir, 'elsewhere.env'), path.join(world.project, '.ai/.env'));
    await fetchPrs(world.project, true, service({ env: {} }));
    expect(fake.requests).toHaveLength(0);
  });
});
