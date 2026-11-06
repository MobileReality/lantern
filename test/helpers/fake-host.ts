import http from 'node:http';
import type { AddressInfo } from 'node:net';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: unknown;
}

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface Route {
  method: string;
  url: string | RegExp;
  reply: Reply | ((call: Call) => Reply);
}

interface Router {
  calls: Call[];
  unmatched: Call[];
  handle(call: Call): Reply;
}

const NO_BODY_STATUSES = new Set([204, 205, 304]);

function createRouter(routes: Route[]): Router {
  const calls: Call[] = [];
  const unmatched: Call[] = [];
  return {
    calls,
    unmatched,
    handle(call) {
      calls.push(call);
      const route = routes.find((candidate) => candidate.method === call.method && (typeof candidate.url === 'string' ? call.url.startsWith(candidate.url) : candidate.url.test(call.url)));
      if (!route) {
        unmatched.push(call);
        return { status: 404, body: { message: 'no route' } };
      }
      return typeof route.reply === 'function' ? route.reply(call) : route.reply;
    },
  };
}

const lowered = (headers: Record<string, string | string[] | undefined>) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? value.join(',') : value]));

function toResponse(reply: Reply): Response {
  const status = reply.status ?? 200;
  return new Response(NO_BODY_STATUSES.has(status) ? null : JSON.stringify(reply.body ?? {}), { status, headers: reply.headers });
}

function fakeFetch(router: Router): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return toResponse(router.handle({ method: init?.method ?? 'GET', url: String(input), headers: lowered((init?.headers ?? {}) as Record<string, string>), body }));
  }) as typeof fetch;
}

async function startFakeHost(router: Router) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const [, host, ...rest] = (req.url ?? '').split('/');
      const reply = router.handle({ method: req.method ?? 'GET', url: `https://${host}/${rest.join('/')}`, headers: lowered(req.headers), body: text ? JSON.parse(text) : undefined });
      const status = reply.status ?? 200;
      res.writeHead(status, { 'Content-Type': 'application/json', ...reply.headers });
      res.end(NO_BODY_STATUSES.has(status) ? undefined : JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export { createRouter, fakeFetch, startFakeHost };
export type { Call, Reply, Route, Router };
