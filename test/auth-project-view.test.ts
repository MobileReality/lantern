import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { namesInEnvironment, namesInProjectFiles } from '@main/auth/env-names';
import { applyInjection } from '@main/auth/spawn-env';
import { createAuthWorld } from './helpers/auth-world';
import { makeTmp, write } from './helpers/git-repo';

const SHOP = '/work/shop';
const GITHUB_HOST = { provider: 'github', owner: 'acme', repo: 'shop' } as const;
const BITBUCKET_HOST = { provider: 'bitbucket', owner: 'acme', repo: 'shop' } as const;

function slot(view: Awaited<ReturnType<ReturnType<typeof createAuthWorld>['auth']['project']>>, provider: string) {
  const found = view.slots.find((entry) => entry.provider === provider);
  if (!found) throw new Error(`no ${provider} slot`);
  return found;
}

describe('the integrations of a project', () => {
  it('shows a slot for every provider and suggests the detected code host first', async () => {
    const { auth, surroundings } = createAuthWorld({ host: GITHUB_HOST });
    surroundings.host = GITHUB_HOST;
    const view = await auth.project(SHOP);
    expect(view.project).toBe(SHOP);
    expect(view.host).toEqual({ provider: 'github', owner: 'acme', repo: 'shop' });
    expect(view.slots.map((entry) => [entry.provider, entry.role, entry.suggested])).toEqual([
      ['github', 'code-host', true],
      ['bitbucket', 'code-host', false],
      ['jira', 'tracker', false],
    ]);
  });

  it('shows all three slots, none suggested, for a project with no origin remote', async () => {
    const { auth } = createAuthWorld({ host: null });
    const view = await auth.project(SHOP);
    expect(view.host).toEqual({ provider: null, owner: null, repo: null });
    expect(view.slots.map((entry) => [entry.provider, entry.suggested])).toEqual([['github', false], ['bitbucket', false], ['jira', false]]);
  });

  it('follows a Bitbucket remote', async () => {
    const { auth } = createAuthWorld({ host: BITBUCKET_HOST });
    expect((await auth.project(SHOP)).slots.map((entry) => [entry.provider, entry.suggested])).toEqual([['bitbucket', true], ['github', false], ['jira', false]]);
  });

  it('lists every account added for each provider in every slot, with or without a remote', async () => {
    for (const host of [null, GITHUB_HOST]) {
      const world = createAuthWorld({ host });
      world.addStatic('github', 'tok-gh-0001', 'gh-one');
      world.addStatic('github', 'tok-gh-0002', 'gh-two');
      world.addStatic('bitbucket', 'tok-bb-0001', 'bb-one', { email: 'bb@x.test' });
      world.addStatic('jira', 'tok-jr-0001', 'jr@x.test', { email: 'jr@x.test', site: 'https://one.atlassian.net' });
      const view = await world.auth.project(SHOP);
      expect(view.slots.map((entry) => [entry.provider, entry.candidates.map((profile) => profile.login)])).toEqual([
        ['github', ['gh-one', 'gh-two']],
        ['bitbucket', ['bb-one']],
        ['jira', ['jr@x.test']],
      ]);
    }
  });

  it('does not use an account of a provider the project has no remote for until one is chosen', async () => {
    const world = createAuthWorld({ host: null });
    const only = world.addStatic('github', 'tok-gh-0001', 'gh-one').profile;
    expect(slot(await world.auth.project(SHOP), 'github')).toMatchObject({ binding: 'unused', bound: null });
    expect(await world.auth.injectionFor(SHOP)).toEqual({});
    world.auth.bind('github', only.id, SHOP);
    expect(slot(await world.auth.project(SHOP), 'github')).toMatchObject({ binding: 'bound', bound: only.id });
    expect(Object.keys(await world.auth.injectionFor(SHOP))).toEqual(['github']);
  });

  it('can pin a Bitbucket account on a GitHub project, and keeps the suggested provider as it was', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST });
    const github = world.addStatic('github', 'tok-gh-0001', 'gh-one').profile;
    const bitbucket = world.addStatic('bitbucket', 'tok-bb-0001', 'bb-one', { email: 'bb@x.test' }).profile;
    const before = await world.auth.project(SHOP);
    expect(slot(before, 'github')).toMatchObject({ binding: 'default', bound: github.id });
    expect(slot(before, 'bitbucket')).toMatchObject({ binding: 'unused', bound: null });
    world.auth.bind('bitbucket', bitbucket.id, SHOP);
    const after = await world.auth.project(SHOP);
    expect(slot(after, 'bitbucket')).toMatchObject({ binding: 'bound', bound: bitbucket.id, suggested: false });
    expect(slot(after, 'github')).toMatchObject({ binding: 'default', bound: github.id, suggested: true });
    expect(Object.keys(await world.auth.injectionFor(SHOP)).sort()).toEqual(['bitbucket', 'github']);
  });

  it('shows an empty slot for a provider with no account, with nothing to use', async () => {
    const world = createAuthWorld({ host: null });
    const view = await world.auth.project(SHOP);
    for (const entry of view.slots) expect(entry).toMatchObject({ binding: 'none', bound: null, candidates: [] });
  });

  it('uses the only account of a provider by default, and asks when there are several', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST });
    expect(slot(await world.auth.project(SHOP), 'github')).toMatchObject({ binding: 'none', bound: null, candidates: [] });
    const work = world.addStatic('github', 'tok-work-0001', 'work').profile;
    expect(slot(await world.auth.project(SHOP), 'github')).toMatchObject({ binding: 'default', bound: work.id });
    world.addStatic('github', 'tok-home-0001', 'home');
    const asked = slot(await world.auth.project(SHOP), 'github');
    expect(asked).toMatchObject({ binding: 'choose', bound: null });
    expect(asked.candidates.map((profile) => profile.login)).toEqual(['work', 'home']);
  });

  it('pins an account per project, for the code host and for the tracker', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST });
    const work = world.addStatic('github', 'tok-work-0001', 'work').profile;
    const home = world.addStatic('github', 'tok-home-0001', 'home').profile;
    const one = world.addStatic('jira', 'tok-jira-0001', 'one@x.test', { email: 'one@x.test', site: 'https://one.atlassian.net' }).profile;
    const two = world.addStatic('jira', 'tok-jira-0002', 'two@x.test', { email: 'two@x.test', site: 'https://two.atlassian.net' }).profile;
    world.auth.bind('github', home.id, SHOP);
    world.auth.bind('jira', two.id, SHOP);
    const view = await world.auth.project(SHOP);
    expect(slot(view, 'github')).toMatchObject({ binding: 'bound', bound: home.id });
    expect(slot(view, 'jira')).toMatchObject({ binding: 'bound', bound: two.id });
    const other = await world.auth.project('/work/blog');
    expect(slot(other, 'github')).toMatchObject({ binding: 'choose', bound: null });
    expect(work.id).not.toBe(home.id);
    expect(one.id).not.toBe(two.id);
  });

  it('unlinking a pin falls back to the default rules', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST });
    const only = world.addStatic('jira', 'tok-jira-0001', 'one@x.test', { email: 'one@x.test', site: 'https://one.atlassian.net' }).profile;
    world.auth.bind('jira', only.id, SHOP);
    expect(slot(await world.auth.project(SHOP), 'jira').binding).toBe('bound');
    world.auth.unbind('jira', SHOP);
    expect(slot(await world.auth.project(SHOP), 'jira')).toMatchObject({ binding: 'default', bound: only.id });
  });

  it('never contains a token, even for accounts that exist', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST, fileNames: ['GITHUB_TOKEN'], env: { GITHUB_TOKEN: 'env-secret-value' } });
    world.addStatic('github', 'ghp_pasted_secret_value', 'work');
    const text = JSON.stringify(await world.auth.project(SHOP));
    expect(text).not.toContain('ghp_pasted_secret_value');
    expect(text).not.toContain('env-secret-value');
  });
});

describe('which credential wins for a project', () => {
  const fullFile = ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN'];

  it('is the environment first, then the Lantern account, then .ai/.env, then none', async () => {
    const world = createAuthWorld({ host: BITBUCKET_HOST, fileNames: fullFile });
    world.addStatic('bitbucket', 'tok-bb-0001', 'meacme', { email: 'me@x.test' });
    world.surroundings.env = { BITBUCKET_API_TOKEN: 'from-env' };
    expect(slot(await world.auth.project(SHOP), 'bitbucket')).toMatchObject({ winner: 'environment', inEnvironment: ['BITBUCKET_API_TOKEN'], inProjectFile: fullFile });
    world.surroundings.env = {};
    expect(slot(await world.auth.project(SHOP), 'bitbucket').winner).toBe('lantern');
    world.auth.removeProfile((await world.auth.project(SHOP)).slots[0].bound as string);
    expect(slot(await world.auth.project(SHOP), 'bitbucket')).toMatchObject({ winner: 'project-file', projectFileComplete: true });
    world.surroundings.fileNames = [];
    expect(slot(await world.auth.project(SHOP), 'bitbucket')).toMatchObject({ winner: 'none', inProjectFile: [] });
  });

  it('still lets the environment win over a pinned account, so the pin shows as shadowed', async () => {
    const world = createAuthWorld({ host: null, env: { GITHUB_TOKEN: 'from-env' } });
    const pinned = world.addStatic('github', 'tok-gh-0001', 'gh-one').profile;
    world.auth.bind('github', pinned.id, SHOP);
    expect(slot(await world.auth.project(SHOP), 'github')).toMatchObject({ binding: 'bound', bound: pinned.id, winner: 'environment', inEnvironment: ['GITHUB_TOKEN'] });
    expect(applyInjection({ GITHUB_TOKEN: 'from-env' }, await world.auth.injectionFor(SHOP)).GITHUB_TOKEN).toBe('from-env');
  });

  it('counts a half-filled .ai/.env as found but not complete', async () => {
    const world = createAuthWorld({ host: BITBUCKET_HOST, fileNames: ['BITBUCKET_EMAIL'] });
    expect(slot(await world.auth.project(SHOP), 'bitbucket')).toMatchObject({ winner: 'none', inProjectFile: ['BITBUCKET_EMAIL'], projectFileComplete: false });
  });

  it('lists only names, in the order of the provider table, and treats an empty variable as not set', async () => {
    const world = createAuthWorld({ host: null, fileNames: ['GLOBAL_ATLASSIAN_TOKEN', 'ATLASSIAN_EMAIL', 'ATLASSIAN_BASE_URL'], env: { ATLASSIAN_EMAIL: '' } });
    expect(slot(await world.auth.project(SHOP), 'jira')).toMatchObject({
      inEnvironment: [],
      inProjectFile: ['ATLASSIAN_EMAIL', 'GLOBAL_ATLASSIAN_TOKEN', 'ATLASSIAN_BASE_URL'],
      winner: 'project-file',
    });
  });

  it('does not let a Lantern account win when its token cannot be read', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST, fileNames: ['GITHUB_TOKEN'] });
    world.addStatic('github', 'tok-gh-0001', 'work');
    fs.writeFileSync(path.join(world.dir, 'auth-secrets.json'), JSON.stringify({ version: 1, entries: {} }));
    const restarted = createAuthWorld({ dir: world.dir, cipher: world.cipher, host: GITHUB_HOST, fileNames: ['GITHUB_TOKEN'] });
    expect(slot(await restarted.auth.project(SHOP), 'github')).toMatchObject({ binding: 'default', winner: 'project-file' });
  });
});

describe('reading names from the project files', () => {
  let root: string;

  beforeEach(() => {
    root = makeTmp('lantern-env-names-');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds the names with a value in .ai/.env and in .env, quoted or exported, and never returns a value', async () => {
    write(root, '.ai/.env', '# tokens\nexport GITHUB_TOKEN="ghp_value"\nBITBUCKET_EMAIL=a@x.test\nBITBUCKET_API_TOKEN=\nUNRELATED=1\n');
    write(root, '.env', "GLOBAL_ATLASSIAN_TOKEN='tok'\n");
    const names = await namesInProjectFiles(root);
    expect([...names].sort()).toEqual(['BITBUCKET_EMAIL', 'GITHUB_TOKEN', 'GLOBAL_ATLASSIAN_TOKEN']);
    expect(JSON.stringify([...names])).not.toContain('ghp_value');
  });

  it('finds nothing in a project without those files', async () => {
    expect([...(await namesInProjectFiles(root))]).toEqual([]);
  });

  it('skips a symlinked file, a file in a symlinked .ai folder, and a file that is too large', async () => {
    write(root, 'real.env', 'GITHUB_TOKEN=abc12345\n');
    fs.mkdirSync(path.join(root, '.ai'));
    fs.symlinkSync(path.join(root, 'real.env'), path.join(root, '.ai/.env'));
    expect([...(await namesInProjectFiles(root))]).toEqual([]);
    fs.rmSync(path.join(root, '.ai'), { recursive: true });
    write(root, 'shared/.env', 'GITHUB_TOKEN=abc12345\n');
    fs.symlinkSync(path.join(root, 'shared'), path.join(root, '.ai'));
    expect([...(await namesInProjectFiles(root))]).toEqual([]);
    fs.rmSync(path.join(root, '.ai'));
    write(root, '.env', `GITHUB_TOKEN=abc12345\n${'# pad\n'.repeat(4000)}`);
    expect([...(await namesInProjectFiles(root))]).toEqual([]);
  });

  it('reads a project reached through a symlinked folder', async () => {
    write(root, 'real/.env', 'GITHUB_TOKEN=abc12345\n');
    const link = path.join(root, 'link');
    fs.symlinkSync(path.join(root, 'real'), link);
    expect([...(await namesInProjectFiles(link))]).toEqual(['GITHUB_TOKEN']);
  });

  it('reads the names set in the process environment, ignoring empty and unrelated ones', () => {
    const names = namesInEnvironment({ GITHUB_TOKEN: 'x', BITBUCKET_EMAIL: '  ', PATH: '/bin', ATLASSIAN_BASE_URL: 'https://a.atlassian.net' });
    expect([...names].sort()).toEqual(['ATLASSIAN_BASE_URL', 'GITHUB_TOKEN']);
  });
});
