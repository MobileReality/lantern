import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRouter, fakeFetch } from './helpers/fake-host';
import { fakeFineGrainedToken } from './helpers/fake-tokens';
import type { Route } from './helpers/fake-host';
import { SKILLS_ROOT, git, makeHostedRepo, runSkill } from './helpers/skill-runner';
import type { HostedRepo } from './helpers/skill-runner';

const ORIGIN = 'git@github.com:example-owner/shop.git';
const TOKEN = fakeFineGrainedToken('11ABCDEFG_exampletoken');
const ENV = { GITHUB_TOKEN: TOKEN };
const API = 'https://api.github.com/repos/example-owner/shop';
const PR_URL = 'https://github.com/example-owner/shop/pull/7';

const OPEN_PR = {
  number: 12,
  title: 'Add retry to the sync job',
  state: 'open',
  merged: false,
  body: 'Retries three times.',
  user: { login: 'ada-example' },
  head: { ref: 'feat/retry' },
  base: { ref: 'main' },
  html_url: 'https://github.com/example-owner/shop/pull/12',
};

const lookup = (found: unknown[]): Route => ({ method: 'GET', url: `${API}/pulls?head=`, reply: { body: found } });
const create: Route = { method: 'POST', url: `${API}/pulls`, reply: { status: 201, body: { number: 7, html_url: PR_URL } } };

let repo: HostedRepo;

beforeEach(() => {
  repo = makeHostedRepo(ORIGIN);
});

afterEach(() => {
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

async function github(routes: Route[], argv: string[], extra: { env?: Record<string, string>; git?: (...args: string[]) => string } = {}) {
  const router = createRouter(routes);
  const result = await runSkill('lantern-github', argv, { env: ENV, cwd: repo.project, ...extra, fetch: fakeFetch(router) });
  return { ...result, router };
}

const remoteBranches = () => git(repo.bare, 'branch', '--list').replace(/\*/g, '').split('\n').map((line) => line.trim()).filter(Boolean);

describe('lantern-github read commands', () => {
  it('lists open pull requests of the repository named by the remote', async () => {
    const { code, out, router } = await github([{ method: 'GET', url: `${API}/pulls?state=open`, reply: { body: [OPEN_PR] } }], ['list']);
    expect(code).toBe(0);
    expect(out.trim()).toBe('#12  Add retry to the sync job  (feat/retry -> main)  by ada-example  https://github.com/example-owner/shop/pull/12');
    expect(router.calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(router.calls[0].headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('says when nothing is open', async () => {
    const { out } = await github([{ method: 'GET', url: `${API}/pulls?state=open`, reply: { body: [] } }], ['list']);
    expect(out).toContain('No open pull requests.');
  });

  it('shows one pull request', async () => {
    const { code, out } = await github([{ method: 'GET', url: `${API}/pulls/12`, reply: { body: OPEN_PR } }], ['show', '12']);
    expect(code).toBe(0);
    expect(out).toContain('#12: Add retry to the sync job');
    expect(out).toContain('State: open');
    expect(out).toContain('Retries three times.');
  });

  it('refuses a pull request number that is not a number before any request', async () => {
    const { code, err, router } = await github([], ['show', '12/../../x']);
    expect(code).toBe(1);
    expect(err).toContain('is not a pull request number');
    expect(router.calls).toEqual([]);
  });

  it('comments on a pull request through the issues endpoint', async () => {
    const post: Route = { method: 'POST', url: `${API}/issues/12/comments`, reply: { status: 201, body: { html_url: `${PR_URL}#c1` } } };
    const { code, out, router } = await github([post], ['comment', '12', '--body', 'Rebased on main.']);
    expect(code).toBe(0);
    expect(out).toContain('Commented on pull request #12.');
    expect(router.calls[0].body).toEqual({ body: 'Rebased on main.' });
  });
});

describe('lantern-github create', () => {
  it('pushes the branch and opens one pull request into the target', async () => {
    const { code, out, router } = await github([lookup([]), create], ['create', '--title', 'Add the thing', '--body', 'Why it matters', '--target', 'main']);
    expect(code).toBe(0);
    expect(out).toContain(`Opened pull request #7. ${PR_URL}`);
    expect(router.calls.at(-1)?.body).toEqual({ title: 'Add the thing', head: 'feat/work', base: 'main', body: 'Why it matters' });
    expect(remoteBranches()).toContain('feat/work');
  });

  it('takes the remote default branch as the target and the body from a file', async () => {
    const file = path.join(repo.dir, 'body.md');
    fs.writeFileSync(file, 'From a file');
    const { code, router } = await github([lookup([]), create], ['create', '--title', 'T', '--body-file', file]);
    expect(code).toBe(0);
    expect(router.calls.at(-1)?.body).toMatchObject({ body: 'From a file', base: 'main' });
  });

  it('looks for an open pull request by owner and branch', async () => {
    const { router } = await github([lookup([]), create], ['create', '--title', 'T', '--target', 'main']);
    expect(decodeURIComponent(router.calls[0].url)).toContain('head=example-owner:feat/work&state=open');
  });

  it('refuses a second pull request for a branch that has one, and still pushes new commits', async () => {
    const { code, out, router } = await github([lookup([{ number: 5, html_url: 'https://github.com/example-owner/shop/pull/5' }]), create], ['create', '--title', 'T', '--target', 'main']);
    expect(code).toBe(0);
    expect(out).toContain('Pull request #5 is already open for this branch; no second one was opened.');
    expect(router.calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(remoteBranches()).toContain('feat/work');
  });

  it('does everything read-only and writes nothing with --dry-run', async () => {
    const { code, out, router } = await github([lookup([]), create], ['create', '--title', 'T', '--target', 'main', '--dry-run']);
    expect(code).toBe(0);
    expect(out).toContain('Dry run, nothing pushed or sent.');
    expect(router.calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(remoteBranches()).not.toContain('feat/work');
  });

  it('only ever runs a plain push of HEAD to the branch, never a force, delete or merge', async () => {
    const gitModule = await import(pathToFileURL(path.join(SKILLS_ROOT, 'lantern-github', 'scripts', 'git.mjs')).href);
    const real = gitModule.createGit(repo.project);
    const seen: string[][] = [];
    await github([lookup([]), create], ['create', '--title', 'T', '--target', 'main'], {
      git: (...args: string[]) => {
        seen.push(args);
        return real(...args);
      },
    });
    expect(seen.filter((args) => args[0] === 'push')).toEqual([['push', 'origin', 'HEAD:refs/heads/feat/work']]);
    expect(seen.flat().filter((arg) => /^(--force|-f|--delete|-d|merge|--mirror)/.test(arg))).toEqual([]);
  });

  it.each([
    ['a missing title', ['create'], 'Give the pull request a title'],
    ['a target that is not on the remote', ['create', '--title', 'T', '--target', 'nope'], 'Target branch "nope" does not exist on origin'],
    ['the source as its own target', ['create', '--title', 'T', '--target', 'feat/work'], 'Source and target are both "feat/work"'],
  ])('refuses %s and sends nothing', async (_label, argv, expected) => {
    const { code, err, router } = await github([lookup([]), create], argv);
    expect(code).toBe(1);
    expect(err).toContain(expected);
    expect(router.calls).toEqual([]);
    expect(remoteBranches()).not.toContain('feat/work');
  });

  it('is not stopped by an untracked scratch file such as a pull request body', async () => {
    fs.mkdirSync(path.join(repo.project, '.ai', 'tmp'), { recursive: true });
    const body = path.join(repo.project, '.ai', 'tmp', 'pr-body.md');
    fs.writeFileSync(body, 'Scratch body');
    const { code, router } = await github([lookup([]), create], ['create', '--title', 'T', '--target', 'main', '--body-file', body]);
    expect(code).toBe(0);
    expect(router.calls.at(-1)?.body).toMatchObject({ body: 'Scratch body' });
  });

  it('refuses uncommitted changes to tracked files and a detached HEAD', async () => {
    fs.writeFileSync(path.join(repo.project, 'b.txt'), 'edited\n');
    const dirty = await github([lookup([]), create], ['create', '--title', 'T', '--target', 'main']);
    expect(dirty.err).toContain('uncommitted changes');
    git(repo.project, 'checkout', '--', 'b.txt');
    git(repo.project, 'checkout', '-q', '--detach');
    const detached = await github([lookup([]), create], ['create', '--title', 'T', '--target', 'main']);
    expect(detached.err).toContain('Detached HEAD');
    expect(dirty.router.calls.concat(detached.router.calls)).toEqual([]);
  });
});

describe('lantern-github remotes', () => {
  it('asks for --remote when several remotes point at github.com, and honours it', async () => {
    git(repo.project, 'remote', 'add', 'fork', 'https://github.com/example-fork/shop.git');
    const ambiguous = await github([], ['list']);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toContain('Several GitHub remotes (fork, origin); pass --remote <name>.');
    const chosen = await github([{ method: 'GET', url: 'https://api.github.com/repos/example-fork/shop/pulls?state=open', reply: { body: [] } }], ['list', '--remote', 'fork']);
    expect(chosen.code).toBe(0);
    expect(chosen.router.unmatched).toEqual([]);
  });

  it('reports a repository with no github remote', async () => {
    git(repo.project, 'remote', 'set-url', 'origin', 'git@bitbucket.org:example-workspace/shop.git');
    git(repo.project, 'config', '--unset-all', `url.${repo.bare}.insteadOf`);
    const { code, err } = await github([], ['list']);
    expect(code).toBe(1);
    expect(err).toContain('No remote of this repository points at github.com.');
  });

  it('parses ssh, ssh-url and https remote urls and resolves an ssh alias', async () => {
    const remote = await import(pathToFileURL(path.join(SKILLS_ROOT, 'lantern-github', 'scripts', 'remote.mjs')).href);
    for (const url of ['git@github.com:example-owner/shop.git', 'ssh://git@github.com/example-owner/shop.git', 'https://github.com/example-owner/shop', 'https://dev@github.com/example-owner/shop.git/']) {
      expect(remote.parseRemoteUrl(url)).toMatchObject({ host: 'github.com', owner: 'example-owner', repo: 'shop' });
    }
    const fakeGit = (...args: string[]) => (args[0] === 'remote' && args.length === 1 ? 'origin\nwork' : args[0] === 'remote' ? args[2] : '');
    const urls: Record<string, string> = { origin: 'git@gh-alias:example-owner/shop.git', work: 'git@elsewhere:example-owner/other.git' };
    const withUrls = (...args: string[]) => (args[0] === 'remote' && args[1] === 'get-url' ? urls[args[2]] : fakeGit(...args));
    const resolved = remote.githubRemotes(withUrls, (host: string) => (host === 'gh-alias' ? 'github.com' : host));
    expect(resolved).toEqual([{ name: 'origin', owner: 'example-owner', repo: 'shop' }]);
  });
});

describe('lantern-github environment', () => {
  it('names the missing variable, points at Lantern and sends nothing', async () => {
    const { code, err, router } = await github([], ['list'], { env: {} });
    expect(code).toBe(1);
    expect(err.trim().split('\n')).toHaveLength(1);
    expect(err).toContain('Missing GITHUB_TOKEN.');
    expect(err).toContain('command palette, Integrations');
    expect(router.calls).toEqual([]);
  });
});
