import { describe, expect, it, vi } from 'vitest';
import { avatarData } from '../src/main/lantern-host-avatar';

const PNG = new Uint8Array([137, 80, 78, 71]);
const image = (body: BodyInit = PNG, headers: Record<string, string> = {}) => new Response(body, { headers: { 'content-type': 'image/png', ...headers } });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

describe('avatar download', () => {
  it('turns an image into a data URL, following https redirects, and never sends credentials', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => (String(url).endsWith('/a') ? redirect('/b') : image()));
    expect(await avatarData('https://avatars.example/a', fetchImpl)).toBe('data:image/png;base64,iVBORw==');
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.headers])).toEqual([
      ['https://avatars.example/a', undefined],
      ['https://avatars.example/b', undefined],
    ]);
  });

  it('refuses a redirect to plain http, a non-image and an oversized body', async () => {
    expect(await avatarData('https://avatars.example/http', vi.fn(async () => redirect('http://avatars.example/x')))).toBeNull();
    expect(await avatarData('https://avatars.example/svg', vi.fn(async () => image('<svg/>', { 'content-type': 'image/svg+xml' })))).toBeNull();
    expect(await avatarData('https://avatars.example/big', vi.fn(async () => image(new Uint8Array(80 * 1024))))).toBeNull();
    expect(await avatarData('https://avatars.example/said-big', vi.fn(async () => image(PNG, { 'content-length': String(80 * 1024) })))).toBeNull();
  });

  it('remembers a failure instead of downloading it again on the next refresh', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }));
    await avatarData('https://avatars.example/denied', fetchImpl);
    await avatarData('https://avatars.example/denied', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
