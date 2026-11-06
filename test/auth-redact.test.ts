import { describe, expect, it } from 'vitest';
import { createLog, redact } from '../src/main/auth/redact';
import { fakeFineGrainedToken, fakeGithubUserToken } from './helpers/fake-tokens';

const USER_TOKEN = fakeGithubUserToken('16C7e42F292c6912E7710c838347Ae178B4a');
const FINE_GRAINED_TOKEN = fakeFineGrainedToken('11ABCDEFG0abcdefghijklmnopqrstuvwxyz');

describe('redact', () => {
  it.each([
    ['https://x.test/cb?code=abc123&state=keep', 'abc123'],
    ['grant_type=refresh_token&refresh_token=r-SECRET&client_id=id', 'r-SECRET'],
    ['access_token=a-SECRET&token_type=bearer', 'a-SECRET'],
    ['https://app/cb#access_token=frag-SECRET&expires_in=7200', 'frag-SECRET'],
    ['code_verifier=ver-SECRET', 'ver-SECRET'],
    ['{"refreshToken":"camel-SECRET"}', 'camel-SECRET'],
    ["{ accessToken: 'inspect-SECRET', clientSecret: 'inspect-S2' }", 'inspect-SECRET'],
    ['password=pw-SECRET', 'pw-SECRET'],
    ['client_secret=cs-SECRET', 'cs-SECRET'],
    ['device_code=dev-SECRET&user_code=WDJB-MJHT', 'dev-SECRET'],
    ['{"access_token":"json-SECRET","expires_in":3600}', 'json-SECRET'],
    ['{"refresh_token": "json-R-SECRET"}', 'json-R-SECRET'],
    ['Authorization: Bearer abc.def-SECRET', 'abc.def-SECRET'],
    ['authorization=Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['sent Bearer longtoken-SECRET to host', 'longtoken-SECRET'],
    [USER_TOKEN, USER_TOKEN],
    [FINE_GRAINED_TOKEN, FINE_GRAINED_TOKEN],
    ['token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJl', 'eyJhbGciOiJIUzI1NiJ9'],
  ])('hides the secret in %s', (input, secret) => {
    const out = redact(input);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('keeps what is safe to log', () => {
    const out = redact('GET https://api.github.com/user status=200 login=octocat status_code=200 scopes=repo,read:user');
    expect(out).toBe('GET https://api.github.com/user status=200 login=octocat status_code=200 scopes=repo,read:user');
  });

  it('keeps the other parameters around a hidden one', () => {
    expect(redact('https://x.test/cb?state=s1&code=abc&foo=bar')).toBe('https://x.test/cb?state=s1&code=[redacted]&foo=bar');
  });

  it('redacts several secrets in one line', () => {
    const out = redact('refresh_token=one&access_token=two&client_secret=three');
    expect(out).toBe('refresh_token=[redacted]&access_token=[redacted]&client_secret=[redacted]');
  });
});

describe('createLog', () => {
  it('redacts the message and the error it is given', () => {
    const lines: string[] = [];
    const log = createLog((line) => lines.push(line));
    log('refresh failed', new Error('POST ?refresh_token=SECRET1 body {"client_secret":"SECRET2"}'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[auth] refresh failed');
    expect(lines[0]).not.toMatch(/SECRET/);
  });
});
