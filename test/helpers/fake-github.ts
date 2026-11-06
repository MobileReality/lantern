import http from 'node:http';
import type { AddressInfo } from 'node:net';

interface FakeReply {
  status?: number;
  body?: string;
  delayMs?: number;
  headers?: Record<string, string>;
}

interface FakeRequest {
  url: string;
  authorization: string | undefined;
  accept: string | undefined;
  apiVersion: string | undefined;
}

type FakePullState = 'open' | 'merged' | 'declined';

interface FakeGithub {
  baseUrl: string;
  requests: FakeRequest[];
  peak(): number;
  reply(id: number | string, reply: FakeReply): void;
  state(id: number | string, state: FakePullState, extra?: Record<string, unknown>): void;
  close(): Promise<void>;
}

const PULL_PATH = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/;

function pullBody(id: number | string, state: FakePullState, extra: Record<string, unknown> = {}) {
  const base = { number: Number(id), base: { ref: 'main' }, ...extra };
  if (state === 'open') return JSON.stringify({ ...base, state: 'open', merged: false, merged_at: null });
  if (state === 'merged') return JSON.stringify({ ...base, state: 'closed', merged: true, merged_at: '2026-10-01T10:00:00Z' });
  return JSON.stringify({ ...base, state: 'closed', merged: false, merged_at: null });
}

async function startFakeGithub(): Promise<FakeGithub> {
  const requests: FakeRequest[] = [];
  const replies = new Map<string, FakeReply>();
  const timers = new Set<NodeJS.Timeout>();
  let active = 0;
  let peak = 0;
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url ?? '', authorization: req.headers.authorization, accept: req.headers.accept, apiVersion: req.headers['x-github-api-version'] as string | undefined });
    active++;
    peak = Math.max(peak, active);
    res.on('close', () => active--);
    const reply = replies.get(PULL_PATH.exec(req.url ?? '')?.[1] ?? '') ?? { status: 404, body: '{"message":"Not Found"}' };
    const respond = () => {
      res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json', ...reply.headers });
      res.end(reply.body ?? '{}');
    };
    if (!reply.delayMs) return respond();
    const timer = setTimeout(respond, reply.delayMs);
    timers.add(timer);
    res.on('close', () => clearTimeout(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    requests,
    peak: () => peak,
    reply: (id, reply) => void replies.set(String(id), reply),
    state: (id, state, extra) => void replies.set(String(id), { body: pullBody(id, state, extra) }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of timers) clearTimeout(timer);
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export { pullBody, startFakeGithub };
export type { FakeGithub, FakePullState };
