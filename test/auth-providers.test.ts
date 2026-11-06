import { describe, expect, it } from 'vitest';
import { PROVIDERS, PROVIDER_IDS, isAllowedProviderUrl, isProviderId } from '../src/main/auth/providers';

describe('provider table', () => {
  it('lists github, jira and bitbucket, each with a name and hosts', () => {
    expect([...PROVIDER_IDS]).toEqual(['github', 'jira', 'bitbucket']);
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id]).toMatchObject({ id, name: expect.any(String), hosts: expect.any(Array) });
  });

  it('accepts only the three ids', () => {
    expect(isProviderId('github')).toBe(true);
    for (const value of ['gitlab', '', 'GitHub', undefined, null, 7, ['github']]) expect(isProviderId(value)).toBe(false);
  });

  it('allows https URLs on the provider hosts only', () => {
    expect(isAllowedProviderUrl('github', 'https://github.com/login/device')).toBe(true);
    expect(isAllowedProviderUrl('jira', 'https://auth.atlassian.com/authorize?x=1')).toBe(true);
    expect(isAllowedProviderUrl('bitbucket', 'https://bitbucket.org/site/oauth2/authorize')).toBe(true);
    expect(isAllowedProviderUrl('github', 'http://github.com/login/device')).toBe(false);
    expect(isAllowedProviderUrl('github', 'https://github.com.evil.test/')).toBe(false);
    expect(isAllowedProviderUrl('github', 'https://evil.test/github.com')).toBe(false);
    expect(isAllowedProviderUrl('github', 'https://auth.atlassian.com/')).toBe(false);
    expect(isAllowedProviderUrl('github', 'javascript:alert(1)')).toBe(false);
    expect(isAllowedProviderUrl('github', 'not a url')).toBe(false);
  });
});
