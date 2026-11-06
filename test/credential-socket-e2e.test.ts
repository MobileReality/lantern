import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createRouter, startFakeHost } from './helpers/fake-host';
import type { Route } from './helpers/fake-host';
import { createCredentialWorld } from './helpers/credential-world';
import { SKILLS_ROOT, makeHostedRepo } from './helpers/skill-runner';
import type { HostedRepo } from './helpers/skill-runner';

const run = promisify(execFile);
const REDIRECT = path.join(__dirname, 'helpers', 'redirect-fetch.mjs');
const SITE = 'https://example.atlassian.net';
const TOKENS = { github: 'ghp_lantern_store_token_1', bitbucket: 'bb_lantern_store_token_2', jira: 'jira_lantern_store_token_3' };
const EMAIL = 'dev@example.com';

interface Scenario {
  skill: string;
  script: string;
  provider: 'github' | 'bitbucket' | 'jira';
  host: { provider: 'github' | 'bitbucket'; owner: string; repo: string };
  origin: string;
  argv: string[];
  route: Route;
  expected: string;
  authorization: string;
}

const SCENARIOS: Scenario[] = [
  {
    skill: 'lantern-github',
    script: 'github.mjs',
    provider: 'github',
    host: { provider: 'github', owner: 'example-owner', repo: 'shop' },
    origin: 'git@github.com:example-owner/shop.git',
    argv: ['list'],
    route: { method: 'GET', url: 'https://api.github.com/repos/example-owner/shop/pulls?state=open', reply: { body: [{ number: 12, title: 'Add retry', user: { login: 'ada' }, head: { ref: 'feat/retry' }, base: { ref: 'main' }, html_url: 'https://github.com/example-owner/shop/pull/12' }] } },
    expected: '#12  Add retry',
    authorization: `Bearer ${TOKENS.github}`,
  },
  {
    skill: 'lantern-bitbucket',
    script: 'bitbucket.mjs',
    provider: 'bitbucket',
    host: { provider: 'bitbucket', owner: 'example-workspace', repo: 'shop' },
    origin: 'git@bitbucket.org:example-workspace/shop.git',
    argv: ['list'],
    route: { method: 'GET', url: 'https://api.bitbucket.org/2.0/repositories/example-workspace/shop/pullrequests?state=OPEN', reply: { body: { values: [{ id: 7, title: 'Add the thing', author: { display_name: 'Ada' }, source: { branch: { name: 'feat/work' } }, destination: { branch: { name: 'main' } }, links: { html: { href: 'https://bitbucket.org/example-workspace/shop/pull-requests/7' } } }] } } },
    expected: '#7  Add the thing',
    authorization: `Basic ${Buffer.from(`${EMAIL}:${TOKENS.bitbucket}`).toString('base64')}`,
  },
  {
    skill: 'lantern-jira',
    script: 'jira.mjs',
    provider: 'jira',
    host: { provider: 'github', owner: 'example-owner', repo: 'shop' },
    origin: 'git@github.com:example-owner/shop.git',
    argv: ['get', 'PROJ-1'],
    route: { method: 'GET', url: `${SITE}/rest/api/3/issue/PROJ-1?`, reply: { body: { key: 'PROJ-1', fields: { summary: 'Fix the login redirect', status: { name: 'To Do' } } } } },
    expected: 'PROJ-1: Fix the login redirect',
    authorization: `Basic ${Buffer.from(`${EMAIL}:${TOKENS.jira}`).toString('base64')}`,
  },
];

const repos: HostedRepo[] = [];
const folders: string[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) fs.rmSync(repo.dir, { recursive: true, force: true });
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

function skillCopy(skill: string, edit?: (cli: string) => string): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lce-skill-'));
  folders.push(folder);
  const target = path.join(folder, skill);
  fs.cpSync(path.join(SKILLS_ROOT, skill), target, { recursive: true });
  if (edit) {
    const cli = path.join(target, 'scripts', 'cli.mjs');
    fs.writeFileSync(cli, edit(fs.readFileSync(cli, 'utf8')));
  }
  return target;
}

async function playScenario(scenario: Scenario, options: { edit?: (cli: string) => string; socketKnown?: boolean } = {}) {
  const repo = makeHostedRepo(scenario.origin);
  repos.push(repo);
  const world = await createCredentialWorld({ host: scenario.host, opened: [repo.project] });
  world.addStatic('github', TOKENS.github, 'work');
  world.addStatic('bitbucket', TOKENS.bitbucket, 'work', { email: EMAIL });
  world.addStatic('jira', TOKENS.jira, EMAIL, { email: EMAIL, site: SITE });
  const router = createRouter([scenario.route]);
  const host = await startFakeHost(router);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lce-home-'));
  folders.push(home);
  const script = path.join(skillCopy(scenario.skill, options.edit), 'scripts', scenario.script);
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    LANTERN_TEST_HOST: host.origin,
    LANTERN_CREDENTIAL_SOCKET: options.socketKnown === false ? path.join(home, 'nothing.sock') : world.socketPath,
  };
  try {
    const { stdout, stderr } = await run(process.execPath, ['--import', REDIRECT, script, ...scenario.argv], { cwd: repo.project, env });
    return { code: 0, stdout, stderr, router, world };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr, router, world };
  } finally {
    await host.close();
  }
}

const ASSERT_TOKENS = Object.values(TOKENS);

describe.each(SCENARIOS)('$skill, with nothing injected, against the real credential server', (scenario) => {
  it('completes with the account Lantern holds for the project', async () => {
    const result = await playScenario(scenario);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(scenario.expected);
    expect(result.router.calls.length).toBeGreaterThan(0);
    for (const call of result.router.calls.filter((sent) => !sent.url.includes('/_edge/'))) expect(call.headers.authorization).toBe(scenario.authorization);
    for (const token of ASSERT_TOKENS) expect(`${result.stdout}${result.stderr}`).not.toContain(token);
    expect(result.world.logs.join('\n')).not.toMatch(new RegExp(ASSERT_TOKENS.join('|')));
  });

  it('fails the same run when the skill does not ask the socket', async () => {
    const result = await playScenario(scenario, { edit: (cli) => cli.replace(/await completeEnv\(env, \{[^}]*\}\)/, '{ env, reason: null }') });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Missing');
    expect(result.router.calls).toEqual([]);
  });

  it('prints the Lantern message with the reason when the socket is not there', async () => {
    const result = await playScenario(scenario, { socketKnown: false });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('command palette, Integrations');
    expect(result.stderr).toContain('Lantern is not running or does not answer; start it.');
    expect(result.router.calls).toEqual([]);
  });
});

describe('the edit that removes the client really removes it', () => {
  it.each(SCENARIOS)('$skill', (scenario) => {
    const edited = (cli: string) => cli.replace(/await completeEnv\(env, \{[^}]*\}\)/, '{ env, reason: null }');
    const original = fs.readFileSync(path.join(SKILLS_ROOT, scenario.skill, 'scripts', 'cli.mjs'), 'utf8');
    expect(original).toContain('await completeEnv(');
    expect(edited(original)).not.toContain('await completeEnv(');
  });
});
