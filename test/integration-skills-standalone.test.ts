import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installBundleGuarded } from '../scripts/lantern-bundle.mjs';
import { createRouter, startFakeHost } from './helpers/fake-host';
import type { Router } from './helpers/fake-host';
import { SKILLS_ROOT, git, makeHostedRepo } from './helpers/skill-runner';
import type { HostedRepo } from './helpers/skill-runner';

const run = promisify(execFile);
const REDIRECT = path.join(__dirname, 'helpers', 'redirect-fetch.mjs');
const SCRIPT = { 'lantern-jira': 'jira.mjs', 'lantern-bitbucket': 'bitbucket.mjs', 'lantern-github': 'github.mjs' } as const;
type SkillName = keyof typeof SCRIPT;
const SKILLS = Object.keys(SCRIPT) as SkillName[];

const BITBUCKET_ORIGIN = 'git@bitbucket.org:example-workspace/shop.git';
const GITHUB_ORIGIN = 'git@github.com:example-owner/shop.git';
const SITE = 'https://example.atlassian.net';
const BB = 'https://api.bitbucket.org/2.0/repositories/example-workspace/shop/pullrequests';
const GH = 'https://api.github.com/repos/example-owner/shop';
const TOKENS = { jira: 'ATATT-jira-1a2b3c', bitbucket: 'ATATT-bitbucket-4d5e6f', github: 'github_pat_7g8h9i' };
const INJECTED: Record<SkillName, Record<string, string>> = {
  'lantern-jira': { ATLASSIAN_EMAIL: 'dev@example.com', GLOBAL_ATLASSIAN_TOKEN: TOKENS.jira, ATLASSIAN_BASE_URL: SITE },
  'lantern-bitbucket': { BITBUCKET_EMAIL: 'dev@example.com', BITBUCKET_API_TOKEN: TOKENS.bitbucket },
  'lantern-github': { GITHUB_TOKEN: TOKENS.github },
};
const ALLOWED_HOSTS = ['example.atlassian.net', 'api.bitbucket.org', 'api.github.com'];

let tmp: string;
let repo: HostedRepo;
let isolated: string;
let router: Router;
let stopHost: () => Promise<void>;
let hostOrigin: string;

function routes() {
  return createRouter([
    { method: 'GET', url: `${SITE}/_edge/tenant_info`, reply: { status: 404 } },
    { method: 'GET', url: `${SITE}/rest/api/3/issue/PROJ-1/transitions`, reply: { body: { transitions: [{ id: '11', name: 'Start review', to: { name: 'In Review' } }] } } },
    { method: 'GET', url: `${SITE}/rest/api/3/issue/PROJ-1?`, reply: { body: { key: 'PROJ-1', fields: { summary: 'Fix the login redirect', status: { name: 'To Do' } } } } },
    { method: 'POST', url: `${SITE}/rest/api/3/issue/PROJ-1/transitions`, reply: { status: 204 } },
    { method: 'POST', url: `${SITE}/rest/api/3/issue/PROJ-1/comment`, reply: { status: 201, body: { id: '10001' } } },
    { method: 'GET', url: `${BB}?q=`, reply: { body: { values: [] } } },
    { method: 'POST', url: BB, reply: { status: 201, body: { id: 7, links: { html: { href: 'https://bitbucket.org/example-workspace/shop/pull-requests/7' } } } } },
    { method: 'GET', url: `${BB}?state=OPEN`, reply: { body: { values: [{ id: 7, title: 'Add the thing', author: { display_name: 'Ada' }, source: { branch: { name: 'feat/work' } }, destination: { branch: { name: 'main' } }, links: { html: { href: 'https://bitbucket.org/example-workspace/shop/pull-requests/7' } } }] } } },
    { method: 'GET', url: `${GH}/pulls?head=`, reply: { body: [] } },
    { method: 'POST', url: `${GH}/pulls`, reply: { status: 201, body: { number: 9, html_url: 'https://github.com/example-owner/shop/pull/9' } } },
    { method: 'GET', url: `${GH}/pulls?state=open`, reply: { body: [{ number: 9, title: 'Add the thing', user: { login: 'ada' }, head: { ref: 'feat/work' }, base: { ref: 'main' }, html_url: 'https://github.com/example-owner/shop/pull/9' }] } },
  ]);
}

async function script(skill: SkillName, argv: string[], env: Record<string, string> = INJECTED[skill]) {
  const file = path.join(isolated, skill, 'scripts', SCRIPT[skill]);
  const base = { PATH: process.env.PATH ?? '', LANTERN_TEST_HOST: hostOrigin, ...hermetic() };
  try {
    const { stdout, stderr } = await run(process.execPath, ['--import', REDIRECT, file, ...argv], { cwd: repo.project, env: { ...base, ...env } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

const hermetic = () => ({ GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', HOME: path.join(tmp, 'home'), XDG_CONFIG_HOME: path.join(tmp, 'home', '.config') });
let savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-standalone-'));
  fs.mkdirSync(path.join(tmp, 'home'));
  savedEnv = Object.fromEntries(Object.keys(hermetic()).map((name) => [name, process.env[name]]));
  Object.assign(process.env, hermetic());
  const bundle = path.join(tmp, 'bundle');
  fs.cpSync(SKILLS_ROOT, bundle, { recursive: true, filter: (src) => !src.endsWith(path.join('lantern-setup', 'example-web')) });
  repo = makeHostedRepo(BITBUCKET_ORIGIN);
  const githubBare = path.join(tmp, 'github-origin.git');
  fs.mkdirSync(githubBare);
  git(githubBare, 'init', '-q', '--bare', '-b', 'main');
  git(repo.project, 'remote', 'add', 'gh', GITHUB_ORIGIN);
  git(repo.project, 'config', `url.${githubBare}.insteadOf`, GITHUB_ORIGIN);
  git(repo.project, 'push', '-q', 'gh', 'main');
  const installed = await installBundleGuarded({ project: repo.project, root: bundle, home: path.join(tmp, 'home') });
  expect(SKILLS.map((name) => installed.skills[name])).toEqual(['installed', 'installed', 'installed']);
  isolated = path.join(tmp, 'isolated');
  for (const name of SKILLS) fs.cpSync(path.join(repo.project, '.claude', 'skills', name), path.join(isolated, name), { recursive: true });
  router = routes();
  const host = await startFakeHost(router);
  hostOrigin = host.origin;
  stopHost = host.close;
});

afterAll(async () => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await stopHost();
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

describe('a bundle copied into an empty project, each skill alone, only the injected credentials', () => {
  it('starts from a clean project with none of the owner skills', () => {
    expect(git(repo.project, 'status', '--short')).toBe('');
    expect(fs.readdirSync(path.join(tmp, 'home'))).toEqual([]);
    expect(fs.readdirSync(isolated).sort()).toEqual([...SKILLS].sort());
    const installedSkills = fs.readdirSync(path.join(repo.project, '.claude', 'skills'));
    for (const own of ['team-tickets', 'team-pr', 'team-merge']) expect(installedSkills).not.toContain(own);
  });

  it('Jira: reads a ticket, moves it to a named status and comments on it', async () => {
    const get = await script('lantern-jira', ['get', 'PROJ-1']);
    expect(get).toMatchObject({ code: 0 });
    expect(get.stdout).toContain('PROJ-1: Fix the login redirect');
    const move = await script('lantern-jira', ['transition', 'PROJ-1', 'In', 'Review']);
    expect(move).toMatchObject({ code: 0 });
    expect(move.stdout).toContain('PROJ-1 is now "In Review".');
    const comment = await script('lantern-jira', ['comment', 'PROJ-1', '--body', 'Ready for review.']);
    expect(comment).toMatchObject({ code: 0 });
    expect(comment.stdout).toContain('Commented on PROJ-1 (comment 10001).');
    const posts = router.calls.filter((call) => call.method === 'POST' && call.url.startsWith(SITE));
    expect(posts.map((call) => call.url.replace(SITE, ''))).toEqual(['/rest/api/3/issue/PROJ-1/transitions', '/rest/api/3/issue/PROJ-1/comment']);
    expect(posts[0].body).toEqual({ transition: { id: '11' } });
    expect(JSON.stringify(posts[1].body)).toContain('Ready for review.');
  });

  it('Bitbucket: opens a pull request from the current branch and lists it', async () => {
    const created = await script('lantern-bitbucket', ['create', '--title', 'Add the thing', '--body', 'Because.', '--target', 'main']);
    expect(created).toMatchObject({ code: 0 });
    expect(created.stdout).toContain('Opened pull request #7. https://bitbucket.org/example-workspace/shop/pull-requests/7');
    expect(git(repo.bare, 'branch', '--list', 'feat/work')).toContain('feat/work');
    const listed = await script('lantern-bitbucket', ['list']);
    expect(listed).toMatchObject({ code: 0 });
    expect(listed.stdout).toContain('#7  Add the thing  (feat/work -> main)');
  });

  it('GitHub: opens a pull request from the current branch and lists it', async () => {
    const created = await script('lantern-github', ['create', '--title', 'Add the thing', '--body', 'Because.', '--target', 'main']);
    expect(created).toMatchObject({ code: 0 });
    expect(created.stdout).toContain('Opened pull request #9. https://github.com/example-owner/shop/pull/9');
    const listed = await script('lantern-github', ['list']);
    expect(listed).toMatchObject({ code: 0 });
    expect(listed.stdout).toContain('#9  Add the thing  (feat/work -> main)');
  });

  it('only talked to the expected hosts, with the right credential, and printed no token', async () => {
    expect(router.unmatched).toEqual([]);
    expect([...new Set(router.calls.map((call) => new URL(call.url).host))].sort()).toEqual([...ALLOWED_HOSTS].sort());
    const authorization = (host: string) => new Set(router.calls.filter((call) => new URL(call.url).host === host && !call.url.includes('/_edge/')).map((call) => call.headers.authorization));
    expect(authorization('example.atlassian.net')).toEqual(new Set([`Basic ${Buffer.from(`dev@example.com:${TOKENS.jira}`).toString('base64')}`]));
    expect(authorization('api.bitbucket.org')).toEqual(new Set([`Basic ${Buffer.from(`dev@example.com:${TOKENS.bitbucket}`).toString('base64')}`]));
    expect(authorization('api.github.com')).toEqual(new Set([`Bearer ${TOKENS.github}`]));
  });

  it.each(SKILLS)('%s with nothing injected prints one Lantern message and exits non-zero', async (skill) => {
    const argv = { 'lantern-jira': ['get', 'PROJ-1'], 'lantern-bitbucket': ['list'], 'lantern-github': ['list'] }[skill];
    const before = router.calls.length;
    const result = await script(skill, argv, {});
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toContain('Add the');
    expect(result.stderr).toContain('command palette, Integrations');
    expect(router.calls.length).toBe(before);
  });
});

describe('every skill is self-contained', () => {
  const scriptsOf = (skill: string) => {
    const dir = path.join(SKILLS_ROOT, skill, 'scripts');
    return fs.readdirSync(dir).filter((file) => file.endsWith('.mjs')).map((file) => path.join(dir, file));
  };
  const IMPORT = /(?:from|import\()\s*['"]([^'"]+)['"]/g;

  it.each(SKILLS)('%s imports only node built-ins and files of its own folder', (skill) => {
    const own = path.join(SKILLS_ROOT, skill) + path.sep;
    for (const file of scriptsOf(skill)) {
      for (const [, specifier] of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
        if (specifier.startsWith('node:')) continue;
        expect(specifier.startsWith('./'), `${file} imports ${specifier}`).toBe(true);
        expect(path.resolve(path.dirname(file), specifier).startsWith(own), `${file} imports ${specifier}`).toBe(true);
        expect(fs.existsSync(path.resolve(path.dirname(file), specifier)), `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it.each([
    ['args.mjs', SKILLS],
    ['http.mjs', SKILLS],
    ['redact.mjs', SKILLS],
    ['messages.mjs', SKILLS],
    ['lantern-socket.mjs', SKILLS],
    ['conventions.mjs', SKILLS],
    ['git.mjs', ['lantern-bitbucket', 'lantern-github']],
    ['block.mjs', ['lantern-bitbucket', 'lantern-github']],
  ])('keeps the deliberate copy %s identical in every skill that has it', (file, skills) => {
    const texts = skills.map((skill) => fs.readFileSync(path.join(SKILLS_ROOT, skill, 'scripts', file), 'utf8'));
    expect(new Set(texts).size).toBe(1);
  });

  it.each(SKILLS)('%s carries no comment and no dependency', (skill) => {
    for (const file of scriptsOf(skill)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !line.startsWith('#!'));
      expect(lines.filter((line) => /^\s*(\/\/|\/\*|\*)/.test(line)), file).toEqual([]);
    }
    expect(fs.existsSync(path.join(SKILLS_ROOT, skill, 'package.json'))).toBe(false);
  });

  it.each(SKILLS)('%s has every message it uses in messages.json and no message it does not use', async (skill) => {
    const dir = path.join(SKILLS_ROOT, skill, 'scripts');
    const table = JSON.parse(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'));
    const leaves = (node: unknown, prefix: string): string[] =>
      typeof node === 'string' ? [prefix] : Object.entries(node as object).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
    const defined = leaves(table, '');
    const { COMMANDS } = await import(pathToFileURL(path.join(dir, 'commands.mjs')).href);
    const used = new Set<string>(Object.keys(COMMANDS).map((name) => `usage.${name}`));
    const KEY = /'((?:usage|cli|args|credentials|http|git|remote|pr|jira|conventions|template|check|block)\.[A-Za-z0-9_.]+)'/g;
    for (const file of scriptsOf(skill)) for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(KEY)) used.add(key);
    expect([...used].filter((key) => !defined.includes(key))).toEqual([]);
    expect(defined.filter((key) => !used.has(key))).toEqual([]);
  });
});
