import type { LanternPrInfo, LanternPrPerson } from './lantern-types';

const AVATAR_TIMEOUT_MS = 5000;
const MAX_AVATAR_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;
const MAX_CACHED = 200;
const RETRY_FAILED_MS = 30 * 60 * 1000;
const IMAGE_TYPE = /^image\/(png|jpeg|gif|webp)$/;

type Fetch = typeof fetch;

interface Cached {
  job: Promise<string | null>;
  failedAt?: number;
}

const cache = new Map<string, Cached>();

async function readCapped(res: Response): Promise<Buffer | null> {
  if (Number(res.headers.get('content-length') ?? 0) > MAX_AVATAR_BYTES || !res.body) {
    await res.body?.cancel();
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.length;
    if (size > MAX_AVATAR_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

async function download(url: string, fetchImpl: Fetch): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(AVATAR_TIMEOUT_MS);
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetchImpl(target, { signal, redirect: 'manual' });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (location) {
        await res.body?.cancel();
        target = new URL(location, target).href;
        if (!target.startsWith('https://')) return null;
        continue;
      }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !IMAGE_TYPE.test(type)) {
        await res.body?.cancel();
        return null;
      }
      const bytes = await readCapped(res);
      return bytes?.length ? `data:${type};base64,${bytes.toString('base64')}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

function avatarData(url: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  const known = cache.get(url);
  if (known && (known.failedAt === undefined || Date.now() - known.failedAt < RETRY_FAILED_MS)) return known.job;
  const entry: Cached = { job: download(url, fetchImpl) };
  entry.job.then((data) => {
    if (!data) entry.failedAt = Date.now();
  });
  cache.delete(url);
  cache.set(url, entry);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  return entry.job;
}

async function withAvatar<T extends LanternPrPerson>(person: T, fetchImpl: Fetch): Promise<T> {
  if (!person.avatar?.startsWith('https://')) return person;
  const data = await avatarData(person.avatar, fetchImpl);
  const copy = { ...person };
  if (data) copy.avatar = data;
  else delete copy.avatar;
  return copy;
}

async function withAvatars(info: LanternPrInfo, fetchImpl: Fetch = fetch): Promise<LanternPrInfo> {
  const [author, reviewers] = await Promise.all([info.author && withAvatar(info.author, fetchImpl), Promise.all((info.reviewers ?? []).map((r) => withAvatar(r, fetchImpl)))]);
  return { ...info, ...(author ? { author } : {}), ...(info.reviewers ? { reviewers } : {}) };
}

export { avatarData, withAvatars };
