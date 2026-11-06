import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SKILLS_ROOT, makeHostedRepo, runSkill } from './helpers/skill-runner';
import type { HostedRepo } from './helpers/skill-runner';

const TOKEN = 'tok/en+with=special&chars-9f2c';
const EMAIL = 'dev@example.com';
const BASIC_PAIR = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const FORMS = [TOKEN, encodeURIComponent(TOKEN), BASIC_PAIR];

interface SkillCase {
  skill: string;
  env: Record<string, string>;
  commands: string[][];
  origin?: string;
}

const CASES: SkillCase[] = [
  {
    skill: 'lantern-jira',
    env: { ATLASSIAN_EMAIL: EMAIL, GLOBAL_ATLASSIAN_TOKEN: TOKEN, ATLASSIAN_BASE_URL: 'https://example.atlassian.net' },
    commands: [['get', 'PROJ-1'], ['search', 'project = PROJ'], ['comment', 'PROJ-1', '--body', 'hello'], ['transitions', 'PROJ-1'], ['transition', 'PROJ-1', 'Done'], ['describe', 'PROJ-1', '--body', 'hello']],
  },
  {
    skill: 'lantern-bitbucket',
    env: { BITBUCKET_EMAIL: EMAIL, BITBUCKET_API_TOKEN: TOKEN },
    origin: 'git@bitbucket.org:example-workspace/shop.git',
    commands: [['list'], ['show', '1'], ['comment', '1', '--body', 'hello'], ['create', '--title', 'T', '--target', 'main']],
  },
  {
    skill: 'lantern-github',
    env: { GITHUB_TOKEN: TOKEN },
    origin: 'git@github.com:example-owner/shop.git',
    commands: [['list'], ['show', '1'], ['comment', '1', '--body', 'hello'], ['create', '--title', 'T', '--target', 'main']],
  },
];

const echoes = `Authorization: Basic ${BASIC_PAIR} Authorization: Bearer ${TOKEN} token=${TOKEN} enc=${encodeURIComponent(TOKEN)} https://dev:${TOKEN}@host.example/path`;

const MODES: Record<string, typeof fetch> = {
  'a refusal that echoes the credentials': (async () => new Response(JSON.stringify({ message: echoes }), { status: 500 })) as typeof fetch,
  'a network error that names the credentials': (async () => {
    throw new Error(`connect failed ${echoes}`);
  }) as typeof fetch,
  'a success whose content contains the token': (async () => new Response(JSON.stringify({ key: 'PROJ-1', fields: { summary: echoes }, title: echoes, id: 1, values: [], issues: [{ key: 'PROJ-1', fields: { summary: echoes } }], transitions: [{ id: '1', name: 'Done', to: { name: echoes } }] }), { status: 200 })) as typeof fetch,
};

let repos: HostedRepo[] = [];

afterAll(() => {
  for (const repo of repos) fs.rmSync(repo.dir, { recursive: true, force: true });
});

describe.each(CASES)('$skill never prints a credential', ({ skill, env, commands, origin }) => {
  let cwd: string;

  beforeAll(() => {
    const repo = makeHostedRepo(origin ?? 'git@github.com:example-owner/none.git');
    repos.push(repo);
    cwd = repo.project;
  });

  it.each(Object.entries(MODES))('in output after %s', async (_label, fetch) => {
    let printed = '';
    for (const argv of commands) {
      const { out, err } = await runSkill(skill, argv, { env, fetch, cwd });
      printed += `${out}\n${err}\n`;
    }
    expect(printed.trim().length).toBeGreaterThan(0);
    for (const form of FORMS) expect(printed).not.toContain(form);
    expect(printed).not.toMatch(/authorization: *(basic|bearer) +(?!\[redacted\])\S/i);
    expect(printed).not.toContain(`dev:${TOKEN}@`);
  });

  it('leaves not even a fragment of a token that straddles the length cut of an error body', async () => {
    const straddling = (async () => new Response(JSON.stringify({ message: `${'x'.repeat(280)}${TOKEN}` }), { status: 500 })) as typeof fetch;
    const { err } = await runSkill(skill, commands[0], { env, fetch: straddling, cwd });
    expect(err).toContain('refused (500)');
    expect(err).not.toContain(TOKEN.slice(0, 6));
  });

  it('masks what the host echoed instead of dropping the message', async () => {
    const { err } = await runSkill(skill, commands[0], { env, fetch: MODES['a refusal that echoes the credentials'], cwd });
    expect(err).toContain('[redacted]');
    expect(err).toContain('refused (500)');
  });

  const create = commands.find((argv) => argv[0] === 'create');

  it.runIf(create !== undefined)('masks a credential inside a failure of the git helper', async () => {
    const failingGit = () => {
      throw new Error(`fatal: unable to access 'https://dev:${TOKEN}@bitbucket.org/example-workspace/shop.git/'`);
    };
    const { code, err } = await runSkill(skill, create ?? [],{ env, fetch: MODES['a refusal that echoes the credentials'], cwd, git: failingGit });
    expect(code).toBe(1);
    for (const form of FORMS) expect(err).not.toContain(form);
  });
});

describe('the redactor', () => {
  it('masks tokens, encoded tokens, the basic pair, authorization headers and url credentials', async () => {
    const { createRedactor, basicSecrets } = await import(pathToFileURL(path.join(SKILLS_ROOT, 'lantern-jira', 'scripts', 'redact.mjs')).href);
    const redact = createRedactor(basicSecrets(EMAIL, TOKEN));
    const text = redact(`a ${TOKEN} b ${encodeURIComponent(TOKEN)} c ${BASIC_PAIR} "Authorization": "Bearer abc.def" authorization: token ghp_xyz ssh://git:pw@host/x https://u:p@host/y`);
    expect(text).not.toMatch(/abc\.def|ghp_xyz|git:pw|u:p@/);
    expect(text).not.toContain(TOKEN);
    expect(redact('nothing secret here')).toBe('nothing secret here');
    expect(createRedactor([])('plain')).toBe('plain');
  });
});
