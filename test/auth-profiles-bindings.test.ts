import { AUTH_ERROR } from '@shared/auth-kinds';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAuthWorld } from './helpers/auth-world';

const SHOP = '/work/shop';
const BLOG = '/work/blog';

describe('profiles', () => {
  it('keeps several profiles per provider, without secrets', async () => {
    const world = createAuthWorld();
    await world.signIn('github', { login: 'work', displayName: 'Work Me' });
    await world.signIn('github', { login: 'home', displayName: 'Home Me' });
    const logins = world.auth.status().providers.github.profiles.map((profile) => profile.login);
    expect(logins).toEqual(['work', 'home']);

    const stored = fs.readFileSync(path.join(world.dir, 'auth-profiles.json'), 'utf8');
    expect(Object.keys(JSON.parse(stored).profiles[0]).sort()).toEqual(['createdAt', 'displayName', 'email', 'expiresAt', 'expirySource', 'id', 'kind', 'login', 'nickname', 'provider', 'scopes', 'site']);
  });

  it('signing in again as the same account keeps the profile id and its bindings', async () => {
    const world = createAuthWorld();
    const first = await world.signIn('github', { login: 'work', displayName: 'Work' });
    world.auth.bind('github', first.profile.id, SHOP);
    const again = await world.signIn('github', { login: 'work', displayName: 'Work Renamed' });
    expect(again.profile.id).toBe(first.profile.id);
    expect(world.auth.status(SHOP).providers.github.profiles).toHaveLength(1);
    expect(world.auth.status(SHOP).providers.github.profiles[0].displayName).toBe('Work Renamed');
    expect(world.auth.status(SHOP).providers.github.bound).toBe(first.profile.id);
  });

  it('survives a restart', async () => {
    const world = createAuthWorld();
    const { profile } = await world.signIn('jira');
    world.auth.bind('jira', profile.id, SHOP);
    const restarted = createAuthWorld({ dir: world.dir, cipher: world.cipher, clock: world.clock, drivers: world.drivers });
    expect(restarted.auth.status(SHOP).providers.jira.bound).toBe(profile.id);
  });

  it('ignores a damaged profile file instead of crashing', () => {
    const world = createAuthWorld();
    fs.writeFileSync(path.join(world.dir, 'auth-profiles.json'), '{ not json');
    const restarted = createAuthWorld({ dir: world.dir, cipher: world.cipher });
    expect(restarted.auth.status().providers.github.profiles).toEqual([]);
  });
});

describe('per-project choice', () => {
  it('uses the only profile of a provider by default', async () => {
    const world = createAuthWorld();
    const { profile } = await world.signIn('github');
    const github = world.auth.status(SHOP).providers.github;
    expect(github.binding).toBe('default');
    expect(github.bound).toBe(profile.id);
    expect(github.state).toBe('connected');
  });

  it('asks for a choice when there are several profiles and none is bound', async () => {
    const world = createAuthWorld();
    await world.signIn('github', { login: 'work', displayName: 'Work' });
    await world.signIn('github', { login: 'home', displayName: 'Home' });
    const github = world.auth.status(SHOP).providers.github;
    expect(github).toMatchObject({ binding: 'choose', bound: null, state: null });
    expect(await world.auth.credentialFor('github', SHOP)).toBeNull();
  });

  it('reports none for a provider nobody signed in to', () => {
    const world = createAuthWorld();
    expect(world.auth.status(SHOP).providers.bitbucket).toMatchObject({ binding: 'none', bound: null, profiles: [] });
  });

  it('lets two projects use two different profiles of the same provider', async () => {
    const world = createAuthWorld();
    const work = await world.signIn('github', { login: 'work', displayName: 'Work' });
    const home = await world.signIn('github', { login: 'home', displayName: 'Home' });
    world.auth.bind('github', work.profile.id, SHOP);
    world.auth.bind('github', home.profile.id, BLOG);

    expect((await world.auth.credentialFor('github', SHOP))?.login).toBe('work');
    expect((await world.auth.credentialFor('github', BLOG))?.login).toBe('home');
    expect(world.auth.status(SHOP).providers.github.binding).toBe('bound');
  });

  it('keys the choice by the resolved project path', async () => {
    const world = createAuthWorld();
    const work = await world.signIn('github', { login: 'work', displayName: 'Work' });
    await world.signIn('github', { login: 'home', displayName: 'Home' });
    world.auth.bind('github', work.profile.id, `${SHOP}/`);
    expect((await world.auth.credentialFor('github', SHOP))?.login).toBe('work');
  });

  it('clears one provider of one project on unbind', async () => {
    const world = createAuthWorld();
    const work = await world.signIn('github', { login: 'work', displayName: 'Work' });
    await world.signIn('github', { login: 'home', displayName: 'Home' });
    world.auth.bind('github', work.profile.id, SHOP);
    world.auth.unbind('github', SHOP);
    expect(world.auth.status(SHOP).providers.github.binding).toBe('choose');
  });

  it('refuses to bind an unknown profile or one of another provider', async () => {
    const world = createAuthWorld();
    const { profile } = await world.signIn('github');
    expect(() => world.auth.bind('github', 'nope', SHOP)).toThrow(AUTH_ERROR.unknownProfile);
    expect(() => world.auth.bind('jira', profile.id, SHOP)).toThrow(AUTH_ERROR.wrongProvider);
  });

  it('removing a profile clears its bindings and its tokens', async () => {
    const world = createAuthWorld();
    const work = await world.signIn('github', { login: 'work', displayName: 'Work' });
    const home = await world.signIn('github', { login: 'home', displayName: 'Home' });
    world.auth.bind('github', work.profile.id, SHOP);
    world.auth.bind('github', work.profile.id, BLOG);

    expect(world.auth.removeProfile(work.profile.id)).toBe(true);
    expect(world.auth.removeProfile(work.profile.id)).toBe(false);
    expect(world.auth.status(SHOP).providers.github).toMatchObject({ binding: 'default', bound: home.profile.id });

    const stored = fs.readFileSync(path.join(world.dir, 'auth-bindings.json'), 'utf8');
    expect(stored).not.toContain(work.profile.id);
    expect(fs.readFileSync(path.join(world.dir, 'auth-secrets.json'), 'utf8')).not.toContain(work.profile.id);
  });

  it('ignores a binding that points at a profile that no longer exists', async () => {
    const world = createAuthWorld();
    const { profile } = await world.signIn('github');
    world.auth.bind('github', profile.id, SHOP);
    fs.writeFileSync(path.join(world.dir, 'auth-profiles.json'), JSON.stringify({ version: 1, profiles: [] }));
    const restarted = createAuthWorld({ dir: world.dir, cipher: world.cipher });
    expect(restarted.auth.status(SHOP).providers.github).toMatchObject({ binding: 'none', bound: null });
  });

  it('tells listeners which provider changed', async () => {
    const world = createAuthWorld();
    const seen: unknown[] = [];
    world.auth.onChange((provider) => seen.push(provider));
    const { profile } = await world.signIn('jira');
    world.auth.bind('jira', profile.id, SHOP);
    world.auth.removeProfile(profile.id);
    expect(seen).toEqual(['jira', 'jira', 'jira']);
  });
});

describe('the tracker of a project', () => {
  const site = (name: string) => ({ email: `${name}@acme.test`, site: `https://${name}.atlassian.net` });

  it('is a Jira account, chosen by the same rules as a code host: default, ask, pin', () => {
    const world = createAuthWorld();
    expect(world.auth.status(SHOP).providers.jira).toMatchObject({ role: 'tracker', binding: 'none' });
    const one = world.addStatic('jira', 'tok-jira-0001', 'one@acme.test', site('one')).profile;
    expect(world.auth.status(SHOP).providers.jira).toMatchObject({ binding: 'default', bound: one.id });
    const two = world.addStatic('jira', 'tok-jira-0002', 'two@acme.test', site('two')).profile;
    expect(world.auth.status(SHOP).providers.jira).toMatchObject({ binding: 'choose', bound: null });
    world.auth.bind('jira', two.id, SHOP);
    expect(world.auth.status(SHOP).providers.jira).toMatchObject({ binding: 'bound', bound: two.id });
    expect(world.auth.status(BLOG).providers.jira).toMatchObject({ binding: 'choose' });
  });

  it('is kept apart from the code host of the same project', async () => {
    const world = createAuthWorld();
    const jira = world.addStatic('jira', 'tok-jira-0001', 'one@acme.test', site('one')).profile;
    const github = world.addStatic('github', 'tok-gh-00001', 'work').profile;
    world.auth.bind('jira', jira.id, SHOP);
    world.auth.unbind('github', SHOP);
    expect(world.auth.status(SHOP).providers.jira.bound).toBe(jira.id);
    expect(world.auth.status(SHOP).providers.github).toMatchObject({ role: 'code-host', bound: github.id });
    expect(() => world.auth.bind('jira', github.id, SHOP)).toThrow(AUTH_ERROR.wrongProvider);
  });

  it('forgets a Jira account together with its token when it is removed', () => {
    const world = createAuthWorld();
    const jira = world.addStatic('jira', 'tok-jira-0001', 'one@acme.test', site('one')).profile;
    world.auth.bind('jira', jira.id, SHOP);
    world.auth.removeProfile(jira.id);
    expect(world.auth.status(SHOP).providers.jira).toMatchObject({ binding: 'none', bound: null, profiles: [] });
    expect(fs.readFileSync(path.join(world.dir, 'auth-bindings.json'), 'utf8')).not.toContain(jira.id);
    expect(JSON.parse(fs.readFileSync(path.join(world.dir, 'auth-secrets.json'), 'utf8')).entries).toEqual({});
  });
});
