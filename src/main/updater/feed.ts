import { displayVersion, isNewerVersion, parseVersion } from './version';

export const RELEASE_REPO = 'MobileReality/lantern';
export const RELEASE_PAGE_ORIGIN = 'https://github.com';
export const RELEASE_PAGE_PREFIX = `/${RELEASE_REPO}/releases`;
export const RELEASES_URL = `${RELEASE_PAGE_ORIGIN}${RELEASE_PAGE_PREFIX}`;
const FEED_ORIGIN = 'https://update.electronjs.org';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const FEED_ARCHES: readonly string[] = ['arm64'];
const TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 1_000_000;

export interface HttpResponse {
  status: number;
  text(): Promise<string>;
}

export interface HttpRequest {
  headers: Record<string, string>;
  signal: AbortSignal;
}

export type HttpFetch = (url: string, request: HttpRequest) => Promise<HttpResponse>;

export type FeedAnswer =
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'failed'; reason: string };

export type ReleaseAnswer = { kind: 'up-to-date' } | { kind: 'available'; version: string; url: string } | { kind: 'failed'; reason: string };

export function macFeedUrl(version: string, arch: string): string | null {
  if (!FEED_ARCHES.includes(arch)) return null;
  return `${FEED_ORIGIN}/${RELEASE_REPO}/darwin-${arch}/${encodeURIComponent(version)}`;
}

export function releasePageUrl(tag: string): string {
  return `${RELEASE_PAGE_ORIGIN}${RELEASE_PAGE_PREFIX}/tag/${encodeURIComponent(tag)}`;
}

export function isReleasePageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const inReleases = url.pathname === RELEASE_PAGE_PREFIX || url.pathname.startsWith(`${RELEASE_PAGE_PREFIX}/`);
    return url.protocol === 'https:' && url.origin === RELEASE_PAGE_ORIGIN && inReleases && !url.username && !url.password;
  } catch {
    return false;
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function request(fetchUrl: HttpFetch, url: string, headers: Record<string, string>): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchUrl(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function jsonBody(response: HttpResponse): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_BODY_CHARS) throw new Error('the answer is too large');
  return JSON.parse(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readMacFeed(fetchUrl: HttpFetch, url: string, version: string): Promise<FeedAnswer> {
  let response: HttpResponse;
  try {
    response = await request(fetchUrl, url, { Accept: 'application/json', 'User-Agent': `Lantern/${version}` });
  } catch (error) {
    return { kind: 'failed', reason: `the update service did not answer: ${reasonOf(error)}` };
  }
  if (response.status === 204) return { kind: 'up-to-date' };
  if (response.status === 404 || response.status === 410) return { kind: 'unavailable', reason: `the update service has no download for this build (HTTP ${response.status})` };
  if (response.status !== 200) return { kind: 'failed', reason: `the update service answered HTTP ${response.status}` };
  try {
    const body = await jsonBody(response);
    const name = isRecord(body) && typeof body.name === 'string' && body.name.trim() ? body.name : null;
    const download = isRecord(body) && typeof body.url === 'string' && body.url ? body.url : null;
    if (!name || !download) return { kind: 'failed', reason: 'the update service answered without a version or a download' };
    if (parseVersion(name) && !isNewerVersion(name, version)) return { kind: 'up-to-date' };
    return { kind: 'available', version: displayVersion(name) };
  } catch (error) {
    return { kind: 'failed', reason: `the update service answer could not be read: ${reasonOf(error)}` };
  }
}

export async function readLatestRelease(fetchUrl: HttpFetch, version: string): Promise<ReleaseAnswer> {
  let response: HttpResponse;
  try {
    response = await request(fetchUrl, LATEST_RELEASE_URL, {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Lantern',
    });
  } catch (error) {
    return { kind: 'failed', reason: `GitHub did not answer: ${reasonOf(error)}` };
  }
  if (response.status !== 200) return { kind: 'failed', reason: `GitHub answered HTTP ${response.status}` };
  try {
    const body = await jsonBody(response);
    const tag = isRecord(body) && typeof body.tag_name === 'string' ? body.tag_name.trim() : '';
    if (!parseVersion(tag)) return { kind: 'failed', reason: 'GitHub answered without a readable release version' };
    if (isRecord(body) && (body.draft === true || body.prerelease === true)) return { kind: 'up-to-date' };
    if (!isNewerVersion(tag, version)) return { kind: 'up-to-date' };
    return { kind: 'available', version: displayVersion(tag), url: releasePageUrl(tag) };
  } catch (error) {
    return { kind: 'failed', reason: `the GitHub answer could not be read: ${reasonOf(error)}` };
  }
}
