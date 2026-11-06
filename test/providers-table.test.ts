import { describe, expect, it } from 'vitest';
import * as fromMain from '@main/auth/providers';
import { CODE_HOST_IDS, PROVIDER, PROVIDER_IDS, PROVIDER_ROLE, PROVIDERS, TOKEN_FIELD, providersWithRole } from '@shared/providers';

describe('the provider table', () => {
  it('has one entry per id, keyed by that id', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...PROVIDER_IDS].sort());
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].id).toBe(id);
  });

  it('gives every provider a name', () => {
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].name).not.toBe('');
  });

  it('lets only a code host that does not ask for an email at sign-in carry an optional one', () => {
    for (const id of PROVIDER_IDS) {
      if (PROVIDERS[id].optionalEmail) expect(PROVIDERS[id].tokenFields.includes(TOKEN_FIELD.email)).toBe(false);
    }
    expect(PROVIDER_IDS.filter((id) => PROVIDERS[id].optionalEmail)).toEqual([PROVIDER.github]);
  });

  it('asks every provider for a token, last, and only a tracker for a site', () => {
    for (const id of PROVIDER_IDS) {
      const fields = PROVIDERS[id].tokenFields;
      expect(fields[fields.length - 1]).toBe(TOKEN_FIELD.token);
      expect(fields.includes(TOKEN_FIELD.site)).toBe(PROVIDERS[id].role === PROVIDER_ROLE.tracker);
    }
  });

  it('names a git remote host for code hosts and none for the tracker', () => {
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].remoteHost === null).toBe(PROVIDERS[id].role === PROVIDER_ROLE.tracker);
    expect(CODE_HOST_IDS).toEqual(providersWithRole(PROVIDER_ROLE.codeHost));
    expect(CODE_HOST_IDS).not.toContain(PROVIDER.jira);
  });

  it('is the one table the main process re-exports', () => {
    expect(fromMain.PROVIDERS).toBe(PROVIDERS);
    expect(fromMain.PROVIDER_IDS).toBe(PROVIDER_IDS);
    expect(fromMain.PROVIDER).toBe(PROVIDER);
  });

  it('lists the roles in provider order', () => {
    expect(providersWithRole(PROVIDER_ROLE.tracker)).toEqual([PROVIDER.jira]);
    expect(providersWithRole(PROVIDER_ROLE.codeHost)).toEqual([PROVIDER.github, PROVIDER.bitbucket]);
  });
});
