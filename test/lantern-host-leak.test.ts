import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostStatus } from '../src/main/lantern-host-status';
import { fetchPrs, loadPrs } from '../src/main/lantern-prs';
import { startFakeBitbucket } from './helpers/fake-bitbucket';
import type { FakeBitbucket } from './helpers/fake-bitbucket';
import { write } from './helpers/git-repo';
import type { World } from './helpers/git-repo';
import { EMAIL, TOKEN, makeHostWorld } from './helpers/host-world';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const BASIC = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

let fake: FakeBitbucket;
let world: World;
let savedSshCommand: string | undefined;
let logged: unknown[][];

beforeEach(async () => {
  fake = await startFakeBitbucket();
  savedSshCommand = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = 'false';
  logged = [];
  for (const method of CONSOLE_METHODS) vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
  world = makeHostWorld([126]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (savedSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
  else process.env.GIT_SSH_COMMAND = savedSshCommand;
  await fake.close();
  fs.rmSync(world.dir, { recursive: true, force: true });
});

async function everythingReturned(host: ReturnType<typeof createHostStatus>) {
  const fetched = await fetchPrs(world.project, true, host);
  const loaded = await loadPrs(world.project, new Set(), host);
  return JSON.stringify({ fetched, loaded, logged });
}

function expectNoSecret(text: string) {
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(BASIC);
}

describe('credentials stay out of everything the app returns', () => {
  it('keeps the token out of the warning when the host refuses it and echoes the header back', async () => {
    fake.reply(126, { status: 401, body: JSON.stringify({ error: { message: `bad credentials ${BASIC} ${TOKEN}` } }) });
    const host = createHostStatus({ baseUrl: fake.baseUrl, env: { BITBUCKET_EMAIL: EMAIL, BITBUCKET_API_TOKEN: TOKEN }, timeoutMs: 1000 });
    await fetchPrs(world.project, true, host);
    const loaded = await loadPrs(world.project, new Set(), host);
    expect(loaded.warnings.length).toBeGreaterThan(0);
    for (const warning of loaded.warnings) expectNoSecret(warning);
    expectNoSecret(JSON.stringify(loaded));
  });

  it('keeps the token out of results and logs on a successful lookup', async () => {
    fake.state(126, 'DECLINED');
    const host = createHostStatus({ baseUrl: fake.baseUrl, env: { BITBUCKET_EMAIL: EMAIL, BITBUCKET_API_TOKEN: TOKEN }, timeoutMs: 1000 });
    expectNoSecret(await everythingReturned(host));
    expect(fake.requests[0].authorization).toBe(`Basic ${BASIC}`);
    expect(fake.requests[0].url).not.toContain(TOKEN);
    expect(fake.requests[0].url).not.toContain(BASIC);
  });

  it('keeps a token read from .ai/.env out of results and logs', async () => {
    write(world.project, '.ai/.env', `BITBUCKET_EMAIL=${EMAIL}\nBITBUCKET_API_TOKEN=${TOKEN}\n`);
    fake.reply(126, { status: 403, body: `denied for ${TOKEN}` });
    const host = createHostStatus({ baseUrl: fake.baseUrl, env: {}, timeoutMs: 1000 });
    expectNoSecret(await everythingReturned(host));
    expect(fake.requests).toHaveLength(1);
  });

  it('keeps the token out of the warning after a timeout and after a redirect', async () => {
    fake.reply(126, { delayMs: 3000 });
    const slow = createHostStatus({ baseUrl: fake.baseUrl, env: { BITBUCKET_EMAIL: EMAIL, BITBUCKET_API_TOKEN: TOKEN }, timeoutMs: 100 });
    expectNoSecret(await everythingReturned(slow));
    fake.reply(126, { status: 302, location: `http://127.0.0.1:9/?t=${TOKEN}` });
    const redirected = createHostStatus({ baseUrl: fake.baseUrl, env: { BITBUCKET_EMAIL: EMAIL, BITBUCKET_API_TOKEN: TOKEN }, timeoutMs: 1000 });
    expectNoSecret(await everythingReturned(redirected));
  });
});
