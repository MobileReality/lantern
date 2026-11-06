import http from 'node:http';
import type { AddressInfo } from 'node:net';

interface FakeReply {
  status?: number;
  body?: string;
  delayMs?: number;
  location?: string;
}

interface FakeRequest {
  url: string;
  authorization: string | undefined;
}

interface FakeBitbucket {
  baseUrl: string;
  origin: string;
  requests: FakeRequest[];
  peak(): number;
  reply(id: number | string, reply: FakeReply): void;
  state(id: number | string, state: string): void;
  close(): Promise<void>;
}

const PR_PATH = /\/pullrequests\/(\d+)$/;

async function startFakeBitbucket(): Promise<FakeBitbucket> {
  const requests: FakeRequest[] = [];
  const replies = new Map<string, FakeReply>();
  const timers = new Set<NodeJS.Timeout>();
  let active = 0;
  let peak = 0;
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url ?? '', authorization: req.headers.authorization });
    active++;
    peak = Math.max(peak, active);
    res.on('close', () => active--);
    const reply = replies.get(PR_PATH.exec(req.url ?? '')?.[1] ?? '') ?? { status: 404, body: '{}' };
    const respond = () => {
      if (reply.location) res.writeHead(reply.status ?? 302, { Location: reply.location });
      else res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(reply.location ? undefined : (reply.body ?? '{}'));
    };
    if (!reply.delayMs) return respond();
    const timer = setTimeout(respond, reply.delayMs);
    timers.add(timer);
    res.on('close', () => clearTimeout(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl: `${origin}/2.0`,
    origin,
    requests,
    peak: () => peak,
    reply: (id, reply) => void replies.set(String(id), reply),
    state: (id, state) => void replies.set(String(id), { body: JSON.stringify({ type: 'pullrequest', id: Number(id), state }) }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of timers) clearTimeout(timer);
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export { startFakeBitbucket };
export type { FakeBitbucket };
