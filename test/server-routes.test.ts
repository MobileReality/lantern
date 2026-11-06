import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/shared/config', async (original) => ({ ...(await original<object>()), PORT: 0 }));

const { start, isLoopbackHost } = await import('../src/main/server');

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = await start({ codexToken: 'codex-hook-token' });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function request(method: string, path: string, host?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const headers = host === undefined ? {} : { host };
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('removed Claude hook routes', () => {
  it('answers 410 for /event and /notify', async () => {
    expect((await request('POST', '/event')).status).toBe(410);
    expect((await request('POST', '/notify')).status).toBe(410);
  });
});

describe('GET /state', () => {
  it('serves the session list to a loopback Host header', async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'localhost']) {
      const res = await request('GET', '/state', host);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    }
  });

  it('rejects any other Host header with 403', async () => {
    for (const host of ['evil.example', `evil.example:${port}`, '192.168.1.5:31337', 'localhost.evil.example', '127.0.0.1.evil.example']) {
      expect((await request('GET', '/state', host)).status).toBe(403);
    }
  });

  it('leaves /health reachable', async () => {
    expect((await request('GET', '/health', 'evil.example')).status).toBe(200);
  });
});

describe('isLoopbackHost', () => {
  it('accepts loopback names with or without a port and rejects the rest', () => {
    expect(isLoopbackHost('127.0.0.1:31337')).toBe(true);
    expect(isLoopbackHost('LOCALHOST:31337')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('[::1]:31337')).toBe(true);
    expect(isLoopbackHost('0.0.0.0:31337')).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });
});
