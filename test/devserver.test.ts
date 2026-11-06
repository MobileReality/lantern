import fs from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const world = vi.hoisted(() => ({
  windows: [] as unknown[],
}));

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => world.windows } }));

import { recordDebugHandle, recordInstance } from '../src/main/dev-instance';
import { start } from '../src/main/devserver';
import { TOKEN_HEADER } from '../src/main/devserver-guard';

const TITLE = 'Lantern fake window';
const NOT_WINDOWS = process.platform === 'win32';

interface Reply {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function fakeWindow(png: Buffer = Buffer.from('png')) {
  const executeJavaScript = vi.fn(async () => 2);
  const win = {
    id: 7,
    isDestroyed: () => false,
    getTitle: () => TITLE,
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    isVisible: () => true,
    show: vi.fn(),
    moveTop: vi.fn(),
    focus: vi.fn(),
    webContents: {
      executeJavaScript,
      invalidate: vi.fn(),
      once: (_event: string, cb: () => void) => cb(),
      capturePage: async () => ({ toPNG: () => png }),
    },
  };
  return { win, executeJavaScript };
}

function listening(server: http.Server) {
  return new Promise<number>((resolve) => server.once('listening', () => resolve((server.address() as AddressInfo).port)));
}

function ask(port: number, target: string, { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {}) {
  return new Promise<Reply>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const tmps: string[] = [];
const servers: http.Server[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-devserver-'));
  tmps.push(dir);
  return dir;
};

async function launch(win = fakeWindow()) {
  world.windows = [win.win];
  const notify = vi.fn(() => true);
  const toggleTray = vi.fn();
  const harness = start(() => win.win as never, vi.fn(), notify, toggleTray, 0);
  servers.push(harness.server);
  const port = await listening(harness.server);
  return { ...harness, port, win, notify, toggleTray };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  world.windows = [];
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => (server.listening ? server.close(resolve) : resolve(null)))));
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('debug harness routes', () => {
  const shotFile = () => path.join(tmp(), 'shot.png');
  const routes = () => [
    '/windows',
    '/notify?kind=done',
    '/tray',
    `/shot?path=${encodeURIComponent(shotFile())}`,
    `/eval?js=${encodeURIComponent('1+1')}`,
  ];

  it('refuses every route without a token and never runs page code', async () => {
    const h = await launch();
    for (const route of routes()) {
      const reply = await ask(h.port, route);
      expect(reply.status, route).toBe(401);
      expect(reply.body).toBe('');
    }
    expect(h.win.executeJavaScript).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.toggleTray).not.toHaveBeenCalled();
  });

  it('refuses a wrong token the same way, in the header and in the query', async () => {
    const h = await launch();
    const wrong = 'f'.repeat(h.token.length);
    for (const route of routes()) {
      expect((await ask(h.port, route, { headers: { [TOKEN_HEADER]: wrong } })).status, route).toBe(401);
      expect((await ask(h.port, `${route}${route.includes('?') ? '&' : '?'}token=${wrong}`)).status, route).toBe(401);
      expect((await ask(h.port, route, { headers: { [TOKEN_HEADER]: h.token.slice(1) } })).status, route).toBe(401);
    }
    expect(h.win.executeJavaScript).not.toHaveBeenCalled();
  });

  it('answers 200 on each route with the token in the header', async () => {
    const h = await launch();
    for (const route of routes()) {
      const reply = await ask(h.port, route, { headers: { [TOKEN_HEADER]: h.token } });
      expect(reply.status, route).toBe(200);
    }
    const evalReply = await ask(h.port, '/eval?js=1%2B1', { headers: { [TOKEN_HEADER]: h.token } });
    expect(JSON.parse(evalReply.body)).toEqual({ ok: true, out: 2 });
    expect(h.win.executeJavaScript).toHaveBeenCalledWith('1+1', true);
    expect(h.notify).toHaveBeenCalledWith('done');
    expect(h.toggleTray).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await ask(h.port, '/windows', { headers: { [TOKEN_HEADER]: h.token } })).body)).toEqual([
      { id: 7, title: TITLE, bounds: { x: 0, y: 0, width: 800, height: 600 }, visible: true },
    ]);
  });

  it('answers 200 on each route with the token in the query and accepts POST', async () => {
    const h = await launch();
    for (const route of routes()) {
      const target = `${route}${route.includes('?') ? '&' : '?'}token=${h.token}`;
      expect((await ask(h.port, target)).status, route).toBe(200);
      expect((await ask(h.port, target, { method: 'POST' })).status, route).toBe(200);
    }
  });

  it('still answers 404 for an unknown route once the token is right', async () => {
    const h = await launch();
    expect((await ask(h.port, '/nope', { headers: { [TOKEN_HEADER]: h.token } })).status).toBe(404);
    expect((await ask(h.port, '/nope')).status).toBe(401);
  });

  it('only serves GET and POST', async () => {
    const h = await launch();
    for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const reply = await ask(h.port, '/eval?js=1', { method, headers: { [TOKEN_HEADER]: h.token } });
      expect(reply.status, method).toBe(405);
    }
    expect(h.win.executeJavaScript).not.toHaveBeenCalled();
  });
});

describe('debug harness request origin', () => {
  it('refuses a Host that is not this loopback address and port, even with the token', async () => {
    const h = await launch();
    const auth = { [TOKEN_HEADER]: h.token };
    for (const host of ['evil.example', `evil.example:${h.port}`, '127.0.0.1', 'localhost', `127.0.0.1:${h.port + 1}`, `[::1]:${h.port}`, `127.0.0.1:${h.port}.evil.example`]) {
      const reply = await ask(h.port, '/eval?js=1', { headers: { ...auth, Host: host } });
      expect(reply.status, host).toBe(403);
      expect(reply.body).toBe('');
    }
    expect(h.win.executeJavaScript).not.toHaveBeenCalled();
  });

  it('refuses a request that names no Host at all', async () => {
    const h = await launch();
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(h.port, '127.0.0.1', () => socket.write(`GET /eval?js=1 HTTP/1.0\r\n${TOKEN_HEADER}: ${h.token}\r\n\r\n`));
      const chunks: Buffer[] = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      socket.on('error', reject);
    });
    expect(raw.split('\r\n')[0]).toBe('HTTP/1.1 403 Forbidden');
    expect(h.win.executeJavaScript).not.toHaveBeenCalled();
  });

  it('accepts localhost with the port', async () => {
    const h = await launch();
    const reply = await ask(h.port, '/windows', { headers: { [TOKEN_HEADER]: h.token, Host: `localhost:${h.port}` } });
    expect(reply.status).toBe(200);
  });

  it('refuses any Origin, even with the token', async () => {
    const h = await launch();
    for (const origin of ['http://evil.example', `http://127.0.0.1:${h.port}`, 'null']) {
      const reply = await ask(h.port, '/eval?js=1', { headers: { [TOKEN_HEADER]: h.token, Origin: origin } });
      expect(reply.status, origin).toBe(403);
    }
    expect(h.win.executeJavaScript).not.toHaveBeenCalled();
  });

  it('refuses a request a page made, whatever Sec-Fetch-Site says but none', async () => {
    const h = await launch();
    for (const site of ['cross-site', 'same-site', 'same-origin']) {
      const reply = await ask(h.port, '/eval?js=1', { headers: { [TOKEN_HEADER]: h.token, 'Sec-Fetch-Site': site } });
      expect(reply.status, site).toBe(403);
    }
    expect(h.win.executeJavaScript).not.toHaveBeenCalled();
    const typed = await ask(h.port, '/windows', { headers: { [TOKEN_HEADER]: h.token, 'Sec-Fetch-Site': 'none' } });
    expect(typed.status).toBe(200);
  });

  it('never sends CORS headers', async () => {
    const h = await launch();
    const replies = [
      await ask(h.port, '/windows'),
      await ask(h.port, '/windows', { headers: { [TOKEN_HEADER]: h.token } }),
      await ask(h.port, '/windows', { headers: { Origin: 'http://evil.example' } }),
      await ask(h.port, '/windows', { method: 'OPTIONS', headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'GET' } }),
    ];
    for (const reply of replies) {
      expect(Object.keys(reply.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
    }
  });

  it('does not run code for a page-like request: an image GET or a rebound host', async () => {
    const h = await launch();
    const js = encodeURIComponent('window.api.dangerous()');
    const image = await ask(h.port, `/eval?js=${js}`, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'image', Referer: 'http://evil.example/' } });
    const rebound = await ask(h.port, `/eval?js=${js}`, { headers: { Host: `rebound.evil.example:${h.port}` } });
    const guessing = await ask(h.port, `/eval?js=${js}&token=${'0'.repeat(h.token.length)}`);
    expect([image.status, rebound.status, guessing.status]).toEqual([403, 403, 401]);
    expect(h.win.executeJavaScript).not.toHaveBeenCalled();
  });
});

describe('debug harness token', () => {
  it('is 256 bits of hex, new for every start', async () => {
    const first = await launch();
    const second = await launch();
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect(second.token).not.toBe(first.token);
    expect((await ask(first.port, '/windows', { headers: { [TOKEN_HEADER]: second.token } })).status).toBe(401);
  });

  it('is in the instance record only, owner-only, and in no response, title or log', async () => {
    const h = await launch();
    const out = tmp();
    const recorded = recordInstance(out, { httpPort: 5000, debugPort: h.port, debugToken: h.token });
    expect(JSON.parse(fs.readFileSync(recorded, 'utf8'))).toEqual({ pid: process.pid, httpPort: 5000, debugPort: h.port, debugToken: h.token });
    if (!NOT_WINDOWS) expect(fs.statSync(recorded).mode & 0o777).toBe(0o600);

    const bodies: string[] = [];
    for (const route of ['/windows', '/eval?js=1', '/nope']) {
      const withToken = await ask(h.port, route, { headers: { [TOKEN_HEADER]: h.token } });
      const without = await ask(h.port, route);
      bodies.push(withToken.body, JSON.stringify(withToken.headers), without.body, JSON.stringify(without.headers));
    }
    expect(bodies.join('\n')).not.toContain(h.token);
    expect(h.win.win.getTitle()).not.toContain(h.token);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(h.token);
    const siblings = fs.readdirSync(out);
    expect(siblings).toEqual(['lantern-instance.json']);
  });

  it('tightens an instance record an older run left readable by others', () => {
    if (NOT_WINDOWS) return;
    const out = tmp();
    const file = path.join(out, 'lantern-instance.json');
    fs.writeFileSync(file, '{}', { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    recordInstance(out, { debugToken: 'a'.repeat(64) });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('is written owner-only to the user data folder for the installed profile', () => {
    const userData = tmp();
    const file = recordDebugHandle(userData, { debugPort: 31339, debugToken: 'b'.repeat(64) });
    expect(path.basename(file)).toBe('lantern-debug.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ debugPort: 31339, debugToken: 'b'.repeat(64) });
    if (!NOT_WINDOWS) expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('debug harness port', () => {
  it('listens on loopback only', async () => {
    const h = await launch();
    expect((h.server.address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('leaves a second listener on the same port to fail quietly and keeps the first one serving', async () => {
    const first = await launch();
    const second = start(() => null, vi.fn(), () => false, vi.fn(), first.port);
    servers.push(second.server);
    const failed = await new Promise<NodeJS.ErrnoException>((resolve) => second.server.once('error', resolve));
    expect(failed.code).toBe('EADDRINUSE');
    expect(second.server.listening).toBe(false);
    expect((await ask(first.port, '/windows', { headers: { [TOKEN_HEADER]: first.token } })).status).toBe(200);
    expect((await ask(first.port, '/windows', { headers: { [TOKEN_HEADER]: second.token } })).status).toBe(401);
  });
});
