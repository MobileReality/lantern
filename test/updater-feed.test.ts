import { describe, expect, it } from 'vitest';
import { type HttpFetch, isReleasePageUrl, macFeedUrl, readLatestRelease, readMacFeed, releasePageUrl } from '../src/main/updater/feed';

const answering =
  (status: number, body = ''): HttpFetch =>
  async () => ({ status, text: async () => body });

const failing = (message: string): HttpFetch => async () => {
  throw new Error(message);
};

describe('macFeedUrl', () => {
  it('names the update service, the repository, the platform with its architecture and the running version', () => {
    expect(macFeedUrl('0.2.2', 'arm64')).toBe('https://update.electronjs.org/MobileReality/lantern/darwin-arm64/0.2.2');
  });

  it('has no feed for an architecture Lantern does not publish', () => {
    expect(macFeedUrl('0.2.2', 'x64')).toBeNull();
  });
});

describe('readMacFeed', () => {
  const URL = 'https://update.electronjs.org/MobileReality/lantern/darwin-arm64/0.2.2';

  it('treats 204 as up to date', async () => {
    expect(await readMacFeed(answering(204), URL, '0.3.0')).toEqual({ kind: 'up-to-date' });
  });

  it('treats 200 with a newer release as an update', async () => {
    const body = JSON.stringify({ name: 'v0.3.0', url: 'https://github.com/MobileReality/lantern/releases/download/v0.3.0/Lantern-mac.zip', notes: 'x' });
    expect(await readMacFeed(answering(200, body), URL, '0.2.2')).toEqual({ kind: 'available', version: '0.3.0' });
  });

  it('treats 200 that names a version no newer than the running one as up to date', async () => {
    const body = JSON.stringify({ name: 'v0.3.0', url: 'https://example.test/a.zip' });
    expect(await readMacFeed(answering(200, body), URL, '0.3.0')).toEqual({ kind: 'up-to-date' });
  });

  it('sends the running version and nothing about the user', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchUrl: HttpFetch = async (url, { headers }) => {
      seen.push({ url, headers });
      return { status: 204, text: async () => '' };
    };
    await readMacFeed(fetchUrl, URL, '0.2.2');
    expect(seen).toEqual([{ url: URL, headers: { Accept: 'application/json', 'User-Agent': 'Lantern/0.2.2' } }]);
  });

  it('reports a 404 as a feed that is not available, which is not a failure', async () => {
    const result = await readMacFeed(answering(404, 'No updates found (needs asset matching .*-(mac|darwin|osx).*.zip in public repository)'), URL, '0.2.2');
    expect(result).toMatchObject({ kind: 'unavailable' });
  });

  it.each([500, 502, 429, 403])('reports HTTP %i as a failed check', async (status) => {
    expect(await readMacFeed(answering(status), URL, '0.2.2')).toMatchObject({ kind: 'failed', reason: expect.stringContaining(String(status)) });
  });

  it('reports an answer it cannot read as a failed check', async () => {
    expect(await readMacFeed(answering(200, 'not json'), URL, '0.2.2')).toMatchObject({ kind: 'failed' });
    expect(await readMacFeed(answering(200, '{"name":"v0.3.0"}'), URL, '0.2.2')).toMatchObject({ kind: 'failed' });
    expect(await readMacFeed(answering(200, '[]'), URL, '0.2.2')).toMatchObject({ kind: 'failed' });
  });

  it('reports a network error as a failed check', async () => {
    expect(await readMacFeed(failing('offline'), URL, '0.2.2')).toMatchObject({ kind: 'failed', reason: expect.stringContaining('offline') });
  });
});

describe('readLatestRelease', () => {
  const release = (tag: string, extra: object = {}) => JSON.stringify({ tag_name: tag, html_url: 'https://evil.test/elsewhere', ...extra });

  it('reports a newer release with a page on the fixed repository, whatever html_url says', async () => {
    expect(await readLatestRelease(answering(200, release('v0.4.0')), '0.3.0')).toEqual({
      kind: 'available',
      version: '0.4.0',
      url: 'https://github.com/MobileReality/lantern/releases/tag/v0.4.0',
    });
  });

  it('reports the same or an older release as up to date', async () => {
    expect(await readLatestRelease(answering(200, release('v0.3.0')), '0.3.0')).toEqual({ kind: 'up-to-date' });
    expect(await readLatestRelease(answering(200, release('v0.2.2')), '0.3.0')).toEqual({ kind: 'up-to-date' });
  });

  it('ignores a draft or a pre-release', async () => {
    expect(await readLatestRelease(answering(200, release('v0.9.0', { prerelease: true })), '0.3.0')).toEqual({ kind: 'up-to-date' });
    expect(await readLatestRelease(answering(200, release('v0.9.0', { draft: true })), '0.3.0')).toEqual({ kind: 'up-to-date' });
  });

  it('asks the public API without a token', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchUrl: HttpFetch = async (url, { headers }) => {
      seen.push({ url, headers });
      return { status: 200, text: async () => release('v0.3.0') };
    };
    await readLatestRelease(fetchUrl, '0.3.0');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.github.com/repos/MobileReality/lantern/releases/latest');
    expect(Object.keys(seen[0].headers).map((name) => name.toLowerCase())).not.toContain('authorization');
    expect(seen[0].headers['User-Agent']).toBe('Lantern');
  });

  it('reports a rate limit, an error status, a tag it cannot read and a network error as failures', async () => {
    expect(await readLatestRelease(answering(403), '0.3.0')).toMatchObject({ kind: 'failed' });
    expect(await readLatestRelease(answering(404), '0.3.0')).toMatchObject({ kind: 'failed' });
    expect(await readLatestRelease(answering(200, release('nightly')), '0.3.0')).toMatchObject({ kind: 'failed' });
    expect(await readLatestRelease(answering(200, 'oops'), '0.3.0')).toMatchObject({ kind: 'failed' });
    expect(await readLatestRelease(failing('offline'), '0.3.0')).toMatchObject({ kind: 'failed' });
  });
});

describe('release page links', () => {
  it('builds the page of a tag on the fixed repository', () => {
    expect(releasePageUrl('v0.4.0')).toBe('https://github.com/MobileReality/lantern/releases/tag/v0.4.0');
  });

  it('accepts only https pages under the repository releases', () => {
    expect(isReleasePageUrl('https://github.com/MobileReality/lantern/releases')).toBe(true);
    expect(isReleasePageUrl('https://github.com/MobileReality/lantern/releases/tag/v0.4.0')).toBe(true);
    expect(isReleasePageUrl('http://github.com/MobileReality/lantern/releases')).toBe(false);
    expect(isReleasePageUrl('https://github.com/Other/lantern/releases')).toBe(false);
    expect(isReleasePageUrl('https://github.com/MobileReality/lantern/issues/1')).toBe(false);
    expect(isReleasePageUrl('https://github.com.evil.test/MobileReality/lantern/releases')).toBe(false);
    expect(isReleasePageUrl('https://user@github.com/MobileReality/lantern/releases')).toBe(false);
    expect(isReleasePageUrl('javascript:alert(1)')).toBe(false);
    expect(isReleasePageUrl('not a url')).toBe(false);
  });
});
