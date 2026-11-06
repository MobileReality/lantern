import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bitbucketRepoOf, codeHostOf } from '@main/lantern-host-origin';
import { git, makeTmp } from './helpers/git-repo';

let root: string;

beforeEach(() => {
  root = makeTmp('lantern-host-detect-');
  git(root, ['init', '-q', '-b', 'main']);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const withRemote = (url: string) => git(root, ['remote', 'add', 'origin', url]);

describe('detecting the code host from the origin remote', () => {
  it.each([
    ['https://github.com/acme/shop.git', 'github'],
    ['https://github.com/acme/shop', 'github'],
    ['git@github.com:acme/shop.git', 'github'],
    ['ssh://git@github.com/acme/shop.git', 'github'],
    ['ssh://git@github.com:22/acme/shop.git', 'github'],
    ['https://GitHub.com/acme/shop.git', 'github'],
    ['https://x-access-token:ghp_secret@github.com/acme/shop.git', 'github'],
    ['https://bitbucket.org/acme/shop.git', 'bitbucket'],
    ['https://jun@bitbucket.org/acme/shop.git', 'bitbucket'],
    ['git@bitbucket.org:acme/shop.git', 'bitbucket'],
    ['ssh://git@bitbucket.org/acme/shop', 'bitbucket'],
  ] as const)('reads %s as %s', async (url, provider) => {
    withRemote(url);
    expect(await codeHostOf(root)).toEqual({ provider, owner: 'acme', repo: 'shop' });
  });

  it.each([
    'https://gitlab.com/acme/shop.git',
    'git@gitlab.com:acme/shop.git',
    'https://github.com.evil.test/acme/shop.git',
    'https://evil.test/github.com/acme/shop.git',
    'git@evil.test:github.com/shop.git',
    'https://dev.azure.com/acme/shop',
    'git@constructor:acme/shop.git',
    'git@__proto__:acme/shop.git',
    '/srv/git/shop.git',
    'not a url',
  ])('finds no host in %s', async (url) => {
    withRemote(url);
    expect(await codeHostOf(root, async () => null)).toBeNull();
  });

  it('finds no host when there is no remote at all, or the folder is not a repository', async () => {
    expect(await codeHostOf(root)).toBeNull();
    expect(await codeHostOf(makeTmp('lantern-not-a-repo-'))).toBeNull();
  });

  it('follows an ssh alias to its real host only through the resolver', async () => {
    withRemote('git@work-github:acme/shop.git');
    expect(await codeHostOf(root, async (alias) => (alias === 'work-github' ? 'github.com' : null))).toEqual({ provider: 'github', owner: 'acme', repo: 'shop' });
    expect(await codeHostOf(root, async () => 'gitlab.com')).toBeNull();
  });

  it('refuses owners and repositories with unsafe characters', async () => {
    withRemote('https://github.com/acme/sh$op.git');
    expect(await codeHostOf(root)).toBeNull();
  });

  it('never returns the remote URL or anything from its credentials', async () => {
    withRemote('https://x-access-token:ghp_secret@github.com/acme/shop.git');
    expect(JSON.stringify(await codeHostOf(root))).not.toContain('ghp_secret');
  });

  it('keeps the Bitbucket-only lookup the pull request status relies on', async () => {
    withRemote('git@bitbucket.org:acme/shop.git');
    expect(await bitbucketRepoOf(root)).toEqual({ workspace: 'acme', repo: 'shop' });
    git(root, ['remote', 'set-url', 'origin', 'git@github.com:acme/shop.git']);
    expect(await bitbucketRepoOf(root)).toBeNull();
  });
});
