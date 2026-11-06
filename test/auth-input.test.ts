import { describe, expect, it } from 'vitest';
import { normalizeSite, parseNickname, parseTokenInput } from '@shared/auth-input';
import { FAKE_GITHUB_TOKEN } from './helpers/fake-tokens';

const TOKEN = FAKE_GITHUB_TOKEN;

function issueOf(provider: Parameters<typeof parseTokenInput>[0], raw: Record<string, unknown>) {
  const parsed = parseTokenInput(provider, raw);
  return parsed.ok ? null : parsed.issue;
}

describe('the site address', () => {
  it.each([
    ['https://acme.atlassian.net', 'https://acme.atlassian.net'],
    ['https://acme.atlassian.net/', 'https://acme.atlassian.net'],
    ['  ACME.atlassian.net  ', 'https://acme.atlassian.net'],
    ['acme-co.atlassian.net', 'https://acme-co.atlassian.net'],
  ])('accepts %s', (raw, site) => {
    expect(normalizeSite(raw)).toBe(site);
  });

  it.each([
    'http://acme.atlassian.net',
    'https://acme.atlassian.net/jira',
    'https://acme.atlassian.net?x=1',
    'https://acme.atlassian.net:8443',
    'https://user:pass@acme.atlassian.net',
    'https://acme.atlassian.net.evil.test',
    'https://evil.test/acme.atlassian.net',
    'https://evil.test',
    'https://a.b.atlassian.net',
    'https://-acme.atlassian.net',
    'https://atlassian.net',
    'ftp://acme.atlassian.net',
    'javascript:alert(1)',
    'https://acme.atlassian.net\nhttps://evil.test',
    '',
  ])('refuses %j', (raw) => {
    expect(normalizeSite(raw)).toBeNull();
  });
});

describe('the fields each provider asks for', () => {
  it('GitHub needs only the token', () => {
    expect(parseTokenInput('github', { token: TOKEN })).toMatchObject({ ok: true, input: { provider: 'github', token: TOKEN, email: null, site: null } });
  });

  it('Bitbucket needs an email and a token', () => {
    expect(issueOf('bitbucket', { token: TOKEN })?.field).toBe('email');
    expect(parseTokenInput('bitbucket', { token: TOKEN, email: 'me@acme.test' })).toMatchObject({ ok: true, input: { email: 'me@acme.test', site: null } });
  });

  it('Jira needs a site, an email and a token, and checks the site first', () => {
    expect(issueOf('jira', { token: TOKEN, email: 'me@acme.test' })?.field).toBe('site');
    expect(issueOf('jira', { token: TOKEN, site: 'https://acme.atlassian.net' })?.field).toBe('email');
    expect(parseTokenInput('jira', { token: TOKEN, email: 'me@acme.test', site: 'acme.atlassian.net' })).toMatchObject({ ok: true, input: { site: 'https://acme.atlassian.net' } });
  });

  it('ignores fields the provider does not use, so a GitHub request cannot carry a site', () => {
    expect(parseTokenInput('github', { token: TOKEN, site: 'https://evil.test' })).toMatchObject({ ok: true, input: { email: null, site: null } });
  });

  it('takes an optional email for GitHub, trimmed, and refuses one that is not an address', () => {
    expect(parseTokenInput('github', { token: TOKEN, email: '  me@acme.test ' })).toMatchObject({ ok: true, input: { email: 'me@acme.test' } });
    expect(parseTokenInput('github', { token: TOKEN, email: '' })).toMatchObject({ ok: true, input: { email: null } });
    expect(parseTokenInput('github', { token: TOKEN, email: 'x' })).toMatchObject({ ok: false, issue: { field: 'email' } });
  });
});

describe('the token and the email', () => {
  it('trims the token and rejects empty, short, long, spaced or non-text ones', () => {
    expect(parseTokenInput('github', { token: `  ${TOKEN}\n` })).toMatchObject({ ok: true, input: { token: TOKEN } });
    for (const token of ['', 'short', 'a'.repeat(513), 'two words here', 'tab\there12345', 'zażółć-gęślą-jaźń', 42, null, undefined, ['x'], { a: 1 }]) {
      expect(issueOf('github', { token })?.field).toBe('token');
    }
  });

  it.each(['me@acme.test', 'first.last+tag@sub.acme.co.uk'])('accepts the email %s', (email) => {
    expect(parseTokenInput('bitbucket', { token: TOKEN, email }).ok).toBe(true);
  });

  it.each(['', 'me', 'me@', '@acme.test', 'me@acme', 'me @acme.test', 'me@acme..test', `${'a'.repeat(250)}@x.test`, 7, null])('refuses the email %j', (email) => {
    expect(issueOf('bitbucket', { token: TOKEN, email })?.field).toBe('email');
  });
});

describe('the nickname and the manual expiry', () => {
  it('accepts a short nickname and an empty one, and refuses control characters and long names', () => {
    expect(parseTokenInput('github', { token: TOKEN, nickname: ' Work ' })).toMatchObject({ ok: true, input: { nickname: 'Work' } });
    expect(parseTokenInput('github', { token: TOKEN, nickname: '' })).toMatchObject({ ok: true, input: { nickname: null } });
    for (const nickname of ['a'.repeat(61), 'bad\nname', '   ', 5]) expect(issueOf('github', { token: TOKEN, nickname })?.field).toBe('nickname');
    expect(parseNickname(' Home ')).toBe('Home');
    expect(parseNickname('')).toBeNull();
    expect(parseNickname('x\u0000y')).toBeNull();
  });

  it('turns a date into the end of that day in UTC and refuses dates that do not exist', () => {
    expect(parseTokenInput('github', { token: TOKEN, expiresOn: '2026-12-31' })).toMatchObject({ ok: true, input: { expiresAt: Date.UTC(2026, 11, 31, 23, 59, 59, 999) } });
    for (const expiresOn of ['2026-02-30', '2026-13-01', '31-12-2026', 'tomorrow', 20261231]) expect(issueOf('github', { token: TOKEN, expiresOn })?.field).toBe('expiresOn');
  });

  it('never repeats the token in a refusal', () => {
    const issue = issueOf('bitbucket', { token: TOKEN, email: 'nope' });
    expect(JSON.stringify(issue)).not.toContain(TOKEN);
  });
});
