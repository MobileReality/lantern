import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/shared/config', async (original) => ({ ...(await original<object>()), PORT: 0 }));

const { start } = await import('../src/main/server');

const TOKEN = 'codex-hook-token';
const changes: unknown[] = [];
let server: http.Server;
let url: string;

beforeAll(async () => {
  server = await start({ codexToken: TOKEN, onChange: (result) => changes.push(result) });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/codex/event`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const event = { session_id: 'sess-0001-abcd', cwd: '/tmp/project', hook_event_name: 'SessionStart' };
const post = (body: string, token: string | null = TOKEN) =>
  fetch(url, { method: 'POST', headers: token === null ? {} : { 'X-Lantern-Codex-Token': token }, body });

describe('POST /codex/event', () => {
  it('rejects a missing or wrong token with 403 and changes nothing', async () => {
    expect((await post(JSON.stringify(event), null)).status).toBe(403);
    expect((await post(JSON.stringify(event), 'wrong-token-of-same-size')).status).toBe(403);
    expect(changes).toEqual([]);
  });

  it('rejects malformed JSON and invalid payloads with 400', async () => {
    expect((await post('{not json')).status).toBe(400);
    expect((await post(JSON.stringify({ ...event, cwd: 'relative/path' }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...event, hook_event_name: 'Bogus' }))).status).toBe(400);
    expect(changes).toEqual([]);
  });

  it('refuses a body over the 64 KB limit without applying it', async () => {
    const big = JSON.stringify({ ...event, last_assistant_message: 'x'.repeat(70 * 1024) });
    const status = await post(big).then((r) => r.status, () => 'reset');
    expect([400, 'reset']).toContain(status);
    expect(changes).toEqual([]);
  });

  it('applies a valid event', async () => {
    const res = await post(JSON.stringify(event));
    expect(res.status).toBe(200);
    expect(changes).toHaveLength(1);
  });
});
