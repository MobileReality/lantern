import { describe, expect, it } from 'vitest';
import { PROVIDERS_VAR, SOURCE_VAR, applyInjection, injectionOf } from '@main/auth/spawn-env';
import type { CredentialInjection } from '@main/auth/spawn-env';
import { createAuthWorld } from './helpers/auth-world';

const GITHUB_HOST = { provider: 'github', owner: 'acme', repo: 'shop' } as const;
const SHOP = '/work/shop';

const github = injectionOf({ github: { secret: 'ghp_lantern_token', login: 'work' } });
const bitbucket = injectionOf({ bitbucket: { secret: 'bb_lantern_token', login: 'me', email: 'lantern@x.test' } });
const jira = injectionOf({ jira: { secret: 'jira_lantern_token', login: 'me@x.test', email: 'me@x.test', site: 'https://acme.atlassian.net' } });
const everything: CredentialInjection = { ...github, ...bitbucket, ...jira };

describe('the variables a bound account becomes', () => {
  it('are GITHUB_TOKEN for GitHub', () => {
    expect(applyInjection({}, github)).toEqual({ GITHUB_TOKEN: 'ghp_lantern_token', [SOURCE_VAR]: 'lantern', [PROVIDERS_VAR]: 'github' });
  });

  it('are BITBUCKET_EMAIL and BITBUCKET_API_TOKEN for Bitbucket', () => {
    expect(applyInjection({}, bitbucket)).toEqual({ BITBUCKET_EMAIL: 'lantern@x.test', BITBUCKET_API_TOKEN: 'bb_lantern_token', [SOURCE_VAR]: 'lantern', [PROVIDERS_VAR]: 'bitbucket' });
  });

  it('are ATLASSIAN_EMAIL, GLOBAL_ATLASSIAN_TOKEN and the site for Jira', () => {
    expect(applyInjection({}, jira)).toEqual({
      ATLASSIAN_EMAIL: 'me@x.test',
      GLOBAL_ATLASSIAN_TOKEN: 'jira_lantern_token',
      ATLASSIAN_BASE_URL: 'https://acme.atlassian.net',
      [SOURCE_VAR]: 'lantern',
      [PROVIDERS_VAR]: 'jira',
    });
  });

  it('skip an account that cannot form its pair, such as a Bitbucket token without an email', () => {
    expect(injectionOf({ bitbucket: { secret: 'x', login: 'me' }, jira: { secret: 'y', login: 'me' } })).toEqual({});
  });
});

describe('precedence against the app environment', () => {
  it('lets a variable that is already set win, leaving the whole group alone', () => {
    const env = applyInjection({ GITHUB_TOKEN: 'explicit', PATH: '/bin' }, everything);
    expect(env.GITHUB_TOKEN).toBe('explicit');
    expect(env.BITBUCKET_API_TOKEN).toBe('bb_lantern_token');
    expect(env[PROVIDERS_VAR]).toBe('jira,bitbucket');
    expect(env.PATH).toBe('/bin');
  });

  it('never mixes an explicit email with a Lantern token', () => {
    const env = applyInjection({ BITBUCKET_EMAIL: 'explicit@x.test' }, bitbucket);
    expect(env.BITBUCKET_EMAIL).toBe('explicit@x.test');
    expect(env.BITBUCKET_API_TOKEN).toBeUndefined();
    expect(env[SOURCE_VAR]).toBeUndefined();
  });

  it('treats an empty variable as not set, as the delegate scripts do, and a blank one too since it could not work', () => {
    const env = applyInjection({ GITHUB_TOKEN: '', BITBUCKET_EMAIL: '   ' }, { ...github, ...bitbucket });
    expect(env.GITHUB_TOKEN).toBe('ghp_lantern_token');
    expect(env.BITBUCKET_EMAIL).toBe('lantern@x.test');
  });

  it('keeps an explicit site next to a Lantern Jira account', () => {
    const env = applyInjection({ ATLASSIAN_BASE_URL: 'https://other.atlassian.net' }, jira);
    expect(env.ATLASSIAN_BASE_URL).toBe('https://other.atlassian.net');
    expect(env.GLOBAL_ATLASSIAN_TOKEN).toBe('jira_lantern_token');
  });

  it('marks the run only for the providers it injected, so a script can tell them apart', () => {
    expect(applyInjection({ GITHUB_TOKEN: 'explicit' }, { ...github, ...jira })[PROVIDERS_VAR]).toBe('jira');
    expect(applyInjection({}, everything)[PROVIDERS_VAR]).toBe('github,jira,bitbucket');
    expect(applyInjection({ GLOBAL_ATLASSIAN_TOKEN: 'explicit' }, everything)[PROVIDERS_VAR]).toBe('github,bitbucket');
  });

  it('adds nothing and drops a stale marker when no account applies', () => {
    const base = { [SOURCE_VAR]: 'lantern', [PROVIDERS_VAR]: 'github', HOME: '/h' };
    expect(applyInjection(base, {})).toEqual({ HOME: '/h' });
    expect(applyInjection(base)).toEqual({ HOME: '/h' });
  });

  it('does not change the environment it was given', () => {
    const base = { PATH: '/bin' };
    applyInjection(base, everything);
    expect(base).toEqual({ PATH: '/bin' });
  });
});

describe('what a project injects', () => {
  it('uses the bound or the only account of the detected host and of Jira', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST });
    world.addStatic('github', 'ghp_default_token', 'work');
    world.addStatic('jira', 'jira_default_token', 'me@x.test', { email: 'me@x.test', site: 'https://acme.atlassian.net' });
    const env = applyInjection({}, await world.auth.injectionFor(SHOP));
    expect(env).toMatchObject({ GITHUB_TOKEN: 'ghp_default_token', ATLASSIAN_EMAIL: 'me@x.test', GLOBAL_ATLASSIAN_TOKEN: 'jira_default_token', ATLASSIAN_BASE_URL: 'https://acme.atlassian.net', [SOURCE_VAR]: 'lantern' });
    expect(env.BITBUCKET_API_TOKEN).toBeUndefined();
  });

  it('injects nothing for a provider with several accounts and no choice, until the project pins one', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST });
    world.addStatic('github', 'ghp_work_token', 'work');
    const home = world.addStatic('github', 'ghp_home_token', 'home').profile;
    expect(applyInjection({}, await world.auth.injectionFor(SHOP)).GITHUB_TOKEN).toBeUndefined();
    world.auth.bind('github', home.id, SHOP);
    expect(applyInjection({}, await world.auth.injectionFor(SHOP)).GITHUB_TOKEN).toBe('ghp_home_token');
    expect(applyInjection({}, await world.auth.injectionFor('/work/blog')).GITHUB_TOKEN).toBeUndefined();
  });

  it('leaves out the other code host, even when it has exactly one account', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST });
    world.addStatic('bitbucket', 'bb_token_value', 'me', { email: 'me@x.test' });
    expect(await world.auth.injectionFor(SHOP)).toEqual({});
  });

  it('injects only Jira for a project without a known code host', async () => {
    const world = createAuthWorld({ host: null });
    world.addStatic('github', 'ghp_default_token', 'work');
    world.addStatic('jira', 'jira_default_token', 'me@x.test', { email: 'me@x.test', site: 'https://acme.atlassian.net' });
    const injection = await world.auth.injectionFor(SHOP);
    expect(Object.keys(injection)).toEqual(['jira']);
  });

  it('skips an account whose token cannot be read, instead of failing the run', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST });
    world.addStatic('github', 'ghp_default_token', 'work');
    world.cipher.setAvailable(false);
    const locked = createAuthWorld({ dir: world.dir, cipher: world.cipher, host: GITHUB_HOST });
    expect(await locked.auth.injectionFor(SHOP)).toEqual({});
  });

  it('logs the account that a run can use but never its token', async () => {
    const world = createAuthWorld({ host: GITHUB_HOST });
    world.addStatic('github', 'ghp_default_token', 'work');
    await world.auth.injectionFor(SHOP);
    expect(world.logs.join('\n')).toContain('work');
    expect(world.logs.join('\n')).not.toContain('ghp_default_token');
  });
});
