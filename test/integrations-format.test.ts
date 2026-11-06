import { msg } from '@shared/lang/messages';
import { describe, expect, it } from 'vitest';
import type { ProjectSlot } from '@main/auth/project-view';
import type { ProfileStatus } from '@main/auth/status';
import { DAY_MS } from '@shared/auth-expiry';
import { accountDetail, accountDetailParts, accountName, accountOptionLabel, bindingNote, expiryLabel, hostLabel, isShadowed, slotRole, suggestedNote, winnerNote } from '@renderer/lib/integrations-format';

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

const profile = (extra: Partial<ProfileStatus> = {}): ProfileStatus => ({
  id: 'p1',
  provider: 'github',
  kind: 'static',
  login: 'octo',
  displayName: 'Octo Cat',
  nickname: 'octo',
  email: null,
  site: null,
  createdAt: NOW,
  expiresAt: null,
  expirySource: null,
  state: 'connected',
  ...extra,
});

const slot = (extra: Partial<ProjectSlot> = {}): ProjectSlot => ({
  provider: 'github',
  role: 'code-host',
  suggested: true,
  binding: 'default',
  bound: 'p1',
  candidates: [profile()],
  inEnvironment: [],
  inProjectFile: [],
  projectFileComplete: false,
  winner: 'lantern',
  ...extra,
});

describe('expiry labels', () => {
  it('says nothing is known without a date', () => {
    expect(expiryLabel(null, NOW)).toMatchObject({ text: msg('integrations.expiry.none'), level: 'none' });
  });

  it('gives the date for a distant expiry and counts days for a near one', () => {
    expect(expiryLabel(NOW + 40 * DAY_MS, NOW)).toMatchObject({ level: 'ok', text: expect.stringMatching(/^Expires \d+ \w{3} 2026$/) });
    expect(expiryLabel(NOW + 14 * DAY_MS, NOW)).toMatchObject({ level: 'soon', text: 'Expires in 14 days' });
    expect(expiryLabel(NOW + 15 * DAY_MS, NOW).level).toBe('ok');
    expect(expiryLabel(NOW + DAY_MS / 2, NOW)).toMatchObject({ level: 'soon', text: msg('integrations.expiry.tomorrow') });
  });

  it('counts the days since an expiry, and says today for the same day', () => {
    expect(expiryLabel(NOW - 2 * DAY_MS, NOW)).toMatchObject({ level: 'expired', text: 'Expired 2 days ago' });
    expect(expiryLabel(NOW - DAY_MS, NOW).text).toBe('Expired 1 day ago');
    expect(expiryLabel(NOW - 1000, NOW)).toMatchObject({ level: 'expired', text: msg('integrations.expiry.today') });
  });

  it('puts the full date in the title', () => {
    expect(expiryLabel(Date.UTC(2026, 10, 3), NOW).title).toBe('Expires on 3 Nov 2026');
  });
});

describe('account wording', () => {
  it('names an account by its nickname, falling back to the login', () => {
    expect(accountName(profile({ nickname: 'Work laptop' }))).toBe('Work laptop');
    expect(accountName(profile({ nickname: '' }))).toBe('octo');
  });

  it('describes each provider with what the user will recognise', () => {
    expect(accountDetailParts(profile({ nickname: 'Work' }))).toEqual(['octo', 'Octo Cat']);
    expect(accountDetailParts(profile())).toEqual(['Octo Cat']);
    expect(accountDetailParts(profile({ displayName: 'octo' }))).toEqual([]);
    expect(accountDetailParts(profile({ provider: 'bitbucket', login: 'meacme', displayName: 'Me Acme', email: 'me@acme.test' }))).toEqual(['meacme', 'Me Acme', 'me@acme.test']);
    const jira = profile({ provider: 'jira', login: 'me@acme.test', email: 'me@acme.test', site: 'https://acme.atlassian.net' });
    expect(accountDetailParts(jira)).toEqual(['me@acme.test', 'acme.atlassian.net']);
    expect(accountDetail(jira)).toBe('me@acme.test, acme.atlassian.net');
  });

  it('labels an option with the nickname and, when it adds something, the login or the site', () => {
    expect(accountOptionLabel(profile())).toBe('octo');
    expect(accountOptionLabel(profile({ nickname: 'Work' }))).toBe('Work – octo');
    expect(accountOptionLabel(profile({ provider: 'jira', nickname: 'Tickets', site: 'https://acme.atlassian.net' }))).toBe('Tickets – acme.atlassian.net');
  });
});

describe('project wording', () => {
  it('shows the host and repository of a detected remote, and nothing for none', () => {
    expect(hostLabel({ provider: 'github', owner: 'acme', repo: 'shop' })).toBe('github.com/acme/shop');
    expect(hostLabel({ provider: 'bitbucket', owner: 'acme', repo: 'shop' })).toBe('bitbucket.org/acme/shop');
    expect(hostLabel({ provider: null, owner: null, repo: null })).toBeNull();
  });

  it('names a slot by its role', () => {
    expect(slotRole(slot())).toBe(msg('integrations.role.code-host'));
    expect(slotRole(slot({ role: 'tracker', provider: 'jira' }))).toBe('Tickets');
  });

  it('says how the account was picked', () => {
    expect(bindingNote(slot({ binding: 'bound' }), 'GitHub')).toBe(msg('integrations.binding.bound'));
    expect(bindingNote(slot({ binding: 'default' }), 'GitHub')).toBe('Your only GitHub account, used by default');
    expect(bindingNote(slot({ binding: 'choose' }), 'GitHub')).toBe('Choose a GitHub account for this project');
    expect(bindingNote(slot({ binding: 'unused' }), 'Bitbucket')).toBe('This project does not use Bitbucket yet. Choose an account to use it here.');
    expect(bindingNote(slot({ binding: 'none' }), 'Jira')).toBe('No Jira account yet. Add one, then choose it for this project.');
  });

  it('says which credential a run gets', () => {
    expect(winnerNote(slot({ winner: 'lantern' }))).toBe(msg('integrations.winner.lantern'));
    expect(winnerNote(slot({ winner: 'lantern', inProjectFile: ['GITHUB_TOKEN'] }))).toBe(msg('integrations.winner.lantern'));
    expect(winnerNote(slot({ winner: 'environment' }))).toMatch(/environment/);
    expect(winnerNote(slot({ winner: 'project-file', candidates: [] }))).toBeNull();
    expect(winnerNote(slot({ winner: 'project-file', binding: 'choose', bound: null }))).toBeNull();
    expect(winnerNote(slot({ winner: 'none' }))).toBe(msg('integrations.winner.none'));
    expect(winnerNote(slot({ winner: 'none', inProjectFile: ['BITBUCKET_EMAIL'] }))).toBe(msg('integrations.winner.none'));
  });

  it('keeps quiet about the credential of a provider the project does not use, unless the environment holds one', () => {
    expect(winnerNote(slot({ binding: 'unused', bound: null, winner: 'none' }))).toBeNull();
    expect(winnerNote(slot({ binding: 'unused', bound: null, winner: 'environment' }))).toMatch(/environment/);
  });

  it('flags a chosen account that a variable in the environment shadows, and nothing else', () => {
    expect(isShadowed(slot({ binding: 'bound', winner: 'environment' }))).toBe(true);
    expect(isShadowed(slot({ binding: 'bound', winner: 'lantern' }))).toBe(false);
    expect(isShadowed(slot({ binding: 'default', winner: 'environment' }))).toBe(false);
    expect(isShadowed(slot({ binding: 'unused', bound: null, winner: 'environment' }))).toBe(false);
  });

  it('suggests only the provider of the origin remote', () => {
    expect(suggestedNote(slot({ suggested: true }), 'GitHub')).toBe('Suggested: GitHub, from the origin remote');
    expect(suggestedNote(slot({ suggested: false }), 'GitHub')).toBeNull();
  });
});
