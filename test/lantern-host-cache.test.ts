import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_TTL_MS, createHostStatus } from '../src/main/lantern-host-status';
import { fetchPrs, loadPrsDetailed } from '../src/main/lantern-prs';
import { startFakeBitbucket } from './helpers/fake-bitbucket';
import type { FakeBitbucket } from './helpers/fake-bitbucket';
import type { World } from './helpers/git-repo';
import { ENV, makeHostWorld } from './helpers/host-world';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let fake: FakeBitbucket;
let world: World;
let clock: number;
let savedSshCommand: string | undefined;

beforeEach(async () => {
  fake = await startFakeBitbucket();
  clock = 1_000_000;
  savedSshCommand = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = 'false';
  world = makeHostWorld([126]);
});

afterEach(async () => {
  if (savedSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
  else process.env.GIT_SSH_COMMAND = savedSshCommand;
  await fake.close();
  fs.rmSync(world.dir, { recursive: true, force: true });
});

const service = () => createHostStatus({ baseUrl: fake.baseUrl, env: ENV, timeoutMs: 1000, now: () => clock });
const stateNow = async (host: ReturnType<typeof service>) => (await loadPrsDetailed(world.project, new Set(), host)).prs[0].state;

describe('host answer cache', () => {
  it('answers from the cache inside the TTL without another request', async () => {
    fake.state(126, 'DECLINED');
    const host = service();
    await fetchPrs(world.project, false, host);
    clock += HOST_TTL_MS - 1000;
    await fetchPrs(world.project, false, host);
    expect(fake.requests).toHaveLength(1);
    expect(await stateNow(host)).toBe('declined');
  });

  it('asks again once the TTL has passed and picks up the change', async () => {
    fake.state(126, 'DECLINED');
    const host = service();
    await fetchPrs(world.project, false, host);
    fake.state(126, 'OPEN');
    clock += HOST_TTL_MS + 1;
    await fetchPrs(world.project, false, host);
    expect(fake.requests).toHaveLength(2);
    expect(await stateNow(host)).toBe('open');
  });

  it('keeps showing the last answer while it is stale', async () => {
    fake.state(126, 'DECLINED');
    const host = service();
    await fetchPrs(world.project, false, host);
    clock += HOST_TTL_MS * 3;
    expect(await stateNow(host)).toBe('declined');
    expect(fake.requests).toHaveLength(1);
  });

  it('is dropped by the refresh button even inside the TTL', async () => {
    fake.state(126, 'DECLINED');
    const host = service();
    await fetchPrs(world.project, false, host);
    fake.state(126, 'MERGED');
    await fetchPrs(world.project, true, host);
    expect(fake.requests).toHaveLength(2);
    expect(await stateNow(host)).toBe('merged');
  });

  it('is kept per project', async () => {
    fake.state(126, 'DECLINED');
    const host = service();
    await fetchPrs(world.project, false, host);
    const other = makeHostWorld([126]);
    try {
      const load = await loadPrsDetailed(other.project, new Set(), host);
      expect(load.prs[0].state).toBe('open');
    } finally {
      fs.rmSync(other.dir, { recursive: true, force: true });
    }
  });
});

describe('change signal for the strip refresh', () => {
  it('changes the project stamp when a host answer lands, so the strip reloads', async () => {
    fake.state(126, 'DECLINED');
    const host = service();
    expect(host.version(world.project)).toBe(0);
    await fetchPrs(world.project, false, host);
    expect(host.version(world.project)).toBe(1);
    await fetchPrs(world.project, true, host);
    expect(host.version(world.project)).toBe(1);
  });
});
