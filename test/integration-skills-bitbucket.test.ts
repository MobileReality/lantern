import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRouter, fakeFetch } from './helpers/fake-host';
import type { Route } from './helpers/fake-host';
import { SKILLS_ROOT, git, makeHostedRepo, runSkill } from './helpers/skill-runner';
import type { HostedRepo } from './helpers/skill-runner';

const ORIGIN = 'git@bitbucket.org:example-workspace/shop.git';
const TOKEN = 'ATATT-bitbucket-token-77c1';
const ENV = { BITBUCKET_EMAIL: 'dev@example.com', BITBUCKET_API_TOKEN: TOKEN };
const BASIC = `Basic ${Buffer.from(`dev@example.com:${TOKEN}`).toString('base64')}`;
const PRS = 'https://api.bitbucket.org/2.0/repositories/example-workspace/shop/pullrequests';
const PR_URL = 'https://bitbucket.org/example-workspace/shop/pull-requests/7';

const OPEN_PR = {
  id: 12,
  title: 'Add retry to the sync job',
  state: 'OPEN',
  description: 'Retries three times.',
  author: { display_name: 'Ada Example' },
  source: { branch: { name: 'feat/retry' } },
  destination: { branch: { name: 'main' } },
  links: { html: { href: 'https://bitbucket.org/example-workspace/shop/pull-requests/12' } },
};

const lookup = (values: unknown[]): Route => ({ method: 'GET', url: `${PRS}?q=`, reply: { body: { values } } });
const create: Route = { method: 'POST', url: PRS, reply: { status: 201, body: { id: 7, links: { html: { href: PR_URL } } } } };

let repo: HostedRepo;

beforeEach(() => {
  repo = makeHostedRepo(ORIGIN);
});

afterEach(() => {
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

async function bitbucket(routes: Route[], argv: string[], extra: { cwd?: string; env?: Record<string, string>; git?: (...args: string[]) => string } = {}) {
  const router = createRouter(routes);
  const result = await runSkill('lantern-bitbucket', argv, { env: ENV, cwd: repo.project, ...extra, fetch: fakeFetch(router) });
  return { ...result, router };
}

const remoteBranches = () => git(repo.bare, 'branch', '--list').replace(/\*/g, '').split('\n').map((line) => line.trim()).filter(Boolean);

describe('lantern-bitbucket read commands', () => {
  it('lists open pull requests of the repository named by the remote', async () => {
    const { code, out, router } = await bitbucket([{ method: 'GET', url: `${PRS}?state=OPEN`, reply: { body: { values: [OPEN_PR] } } }], ['list']);
    expect(code).toBe(0);
    expect(out.trim()).toBe('#12  Add retry to the sync job  (feat/retry -> main)  by Ada Example  https://bitbucket.org/example-workspace/shop/pull-requests/12');
    expect(router.calls[0].headers.authorization).toBe(BASIC);
  });

  it('says when nothing is open', async () => {
    const { out } = await bitbucket([{ method: 'GET', url: `${PRS}?state=OPEN`, reply: { body: { values: [] } } }], ['list']);
    expect(out).toContain('No open pull requests.');
  });

  it('shows one pull request, with a leading # accepted', async () => {
    const { code, out } = await bitbucket([{ method: 'GET', url: `${PRS}/12`, reply: { body: OPEN_PR } }], ['show', '#12']);
    expect(code).toBe(0);
    expect(out).toContain('#12: Add retry to the sync job');
    expect(out).toContain('State: OPEN');
    expect(out).toContain('Branches: feat/retry -> main');
    expect(out).toContain('Retries three times.');
  });

  it('refuses a pull request id that is not a number before any request', async () => {
    const { code, err, router } = await bitbucket([], ['show', '12/../../x']);
    expect(code).toBe(1);
    expect(err).toContain('is not a pull request number');
    expect(router.calls).toEqual([]);
  });

  it('comments on a pull request', async () => {
    const post: Route = { method: 'POST', url: `${PRS}/12/comments`, reply: { status: 201, body: { links: { html: { href: `${PR_URL}#c1` } } } } };
    const { code, out, router } = await bitbucket([post], ['comment', '12', '--body', 'Rebased on main.']);
    expect(code).toBe(0);
    expect(out).toContain('Commented on pull request #12.');
    expect(router.calls[0].body).toEqual({ content: { raw: 'Rebased on main.' } });
  });
});

describe('lantern-bitbucket create', () => {
  it('pushes the branch and opens one pull request into the target', async () => {
    const { code, out, router } = await bitbucket([lookup([]), create], ['create', '--title', 'Add the thing', '--body', 'Why it matters', '--target', 'main']);
    expect(code).toBe(0);
    expect(out).toContain(`Opened pull request #7. ${PR_URL}`);
    expect(router.calls.at(-1)?.body).toEqual({
      title: 'Add the thing',
      description: 'Why it matters',
      source: { branch: { name: 'feat/work' } },
      destination: { branch: { name: 'main' } },
      close_source_branch: false,
    });
    expect(remoteBranches()).toContain('feat/work');
  });

  it('takes the remote default branch as the target and the body from a file', async () => {
    const file = path.join(repo.dir, 'body.md');
    fs.writeFileSync(file, 'From a file');
    const { code, router } = await bitbucket([lookup([]), create], ['create', '--title', 'T', '--body-file', file]);
    expect(code).toBe(0);
    expect(router.calls.at(-1)?.body).toMatchObject({ description: 'From a file', destination: { branch: { name: 'main' } } });
  });

  it('refuses a second pull request for a branch that has one, and still pushes new commits', async () => {
    const { code, out, router } = await bitbucket([lookup([{ id: 5, links: { html: { href: 'https://bitbucket.org/example-workspace/shop/pull-requests/5' } } }]), create], ['create', '--title', 'T', '--target', 'main']);
    expect(code).toBe(0);
    expect(out).toContain('Pull request #5 is already open for this branch; no second one was opened.');
    expect(router.calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(remoteBranches()).toContain('feat/work');
  });

  it('does everything read-only and writes nothing with --dry-run', async () => {
    const { code, out, router } = await bitbucket([lookup([]), create], ['create', '--title', 'T', '--target', 'main', '--dry-run']);
    expect(code).toBe(0);
    expect(out).toContain('Dry run, nothing pushed or sent.');
    expect(out).toContain('"title": "T"');
    expect(router.calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(remoteBranches()).not.toContain('feat/work');
  });

  it('only ever runs a plain push of HEAD to the branch, never a force, delete or merge', async () => {
    const created = await import(pathToFileURL(path.join(SKILLS_ROOT, 'lantern-bitbucket', 'scripts', 'git.mjs')).href);
    const real = created.createGit(repo.project);
    const seen: string[][] = [];
    await bitbucket([lookup([]), create], ['create', '--title', 'T', '--target', 'main'], {
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
    const { code, err, router } = await bitbucket([lookup([]), create], argv);
    expect(code).toBe(1);
    expect(err).toContain(expected);
    expect(router.calls).toEqual([]);
    expect(remoteBranches()).not.toContain('feat/work');
  });

  it('is not stopped by an untracked scratch file such as a pull request body', async () => {
    fs.mkdirSync(path.join(repo.project, '.ai', 'tmp'), { recursive: true });
    const body = path.join(repo.project, '.ai', 'tmp', 'pr-body.md');
    fs.writeFileSync(body, 'Scratch body');
    const { code, router } = await bitbucket([lookup([]), create], ['create', '--title', 'T', '--target', 'main', '--body-file', body]);
    expect(code).toBe(0);
    expect(router.calls.at(-1)?.body).toMatchObject({ description: 'Scratch body' });
  });

  it('refuses uncommitted changes to tracked files and a detached HEAD', async () => {
    fs.writeFileSync(path.join(repo.project, 'b.txt'), 'edited\n');
    const dirty = await bitbucket([lookup([]), create], ['create', '--title', 'T', '--target', 'main']);
    expect(dirty.err).toContain('uncommitted changes');
    git(repo.project, 'checkout', '--', 'b.txt');
    git(repo.project, 'checkout', '-q', '--detach');
    const detached = await bitbucket([lookup([]), create], ['create', '--title', 'T', '--target', 'main']);
    expect(detached.err).toContain('Detached HEAD');
    expect(dirty.router.calls.concat(detached.router.calls)).toEqual([]);
  });
});

describe('lantern-bitbucket remotes', () => {
  it('asks for --remote when several remotes point at bitbucket.org, and honours it', async () => {
    git(repo.project, 'remote', 'add', 'fork', 'git@bitbucket.org:example-fork/shop.git');
    const ambiguous = await bitbucket([], ['list']);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toContain('Several Bitbucket remotes (fork, origin); pass --remote <name>.');
    const chosen = await bitbucket([{ method: 'GET', url: 'https://api.bitbucket.org/2.0/repositories/example-fork/shop/pullrequests?state=OPEN', reply: { body: { values: [] } } }], ['list', '--remote', 'fork']);
    expect(chosen.code).toBe(0);
    expect(chosen.router.unmatched).toEqual([]);
  });

  it('reports a repository with no bitbucket remote', async () => {
    git(repo.project, 'remote', 'set-url', 'origin', 'git@github.com:example-owner/shop.git');
    git(repo.project, 'config', '--unset-all', `url.${repo.bare}.insteadOf`);
    const { code, err } = await bitbucket([], ['list']);
    expect(code).toBe(1);
    expect(err).toContain('No remote of this repository points at bitbucket.org.');
  });

  it('parses ssh, https and credentialed remote urls', async () => {
    const remote = await import(pathToFileURL(path.join(SKILLS_ROOT, 'lantern-bitbucket', 'scripts', 'remote.mjs')).href);
    for (const url of ['git@bitbucket.org:example-workspace/shop.git', 'https://bitbucket.org/example-workspace/shop', 'https://dev@bitbucket.org/example-workspace/shop.git/']) {
      expect(remote.parseRemote(url)).toEqual({ workspace: 'example-workspace', repo: 'shop' });
    }
    expect(remote.parseRemote('git@github.com:example-workspace/shop.git')).toBeNull();
  });
});

describe('lantern-bitbucket environment', () => {
  it('names the missing variables, points at Lantern and sends nothing', async () => {
    const { code, err, router } = await bitbucket([], ['list'], { env: { BITBUCKET_EMAIL: 'dev@example.com' } });
    expect(code).toBe(1);
    expect(err.trim().split('\n')).toHaveLength(1);
    expect(err).toContain('Missing BITBUCKET_API_TOKEN.');
    expect(err).toContain('command palette, Integrations');
    expect(router.calls).toEqual([]);
  });
});
