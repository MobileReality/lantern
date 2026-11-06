import http from 'node:http';
import { PORT } from '../shared/config';
import * as state from './state';
import { authorizeCodexHook, parseCodexEvent } from './codex-event';

interface ServerOptions {
  onChange?: (result: any) => void;
  codexToken?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function readBody(req: http.IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function isLoopbackHost(header: string | undefined) {
  if (!header) return false;
  const portStart = header.startsWith('[') ? header.indexOf(']') + 1 : header.lastIndexOf(':');
  const host = portStart > 0 && portStart <= header.length ? header.slice(0, portStart) : header;
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

function start({ onChange, codexToken = '' }: ServerOptions = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/codex/event') {
      if (!authorizeCodexHook(codexToken, req.headers['x-lantern-codex-token'])) {
        res.writeHead(403, { 'Content-Type': 'application/json' }).end('{"error":"bad token"}');
        return;
      }
      try {
        const parsed = parseCodexEvent(JSON.parse(await readBody(req, 64 * 1024)));
        if (parsed.kind === 'invalid') {
          res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"bad payload"}');
          return;
        }
        if (parsed.kind === 'event') {
          const result = state.applyCodexEvent(parsed.event);
          if (result && onChange) onChange(result);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"bad json"}');
      }
      return;
    }

    if (req.method === 'POST' && (req.url === '/event' || req.url === '/notify')) {
      res.writeHead(410).end('gone');
      return;
    }

    if (req.method === 'GET' && req.url === '/state') {
      if (!isLoopbackHost(req.headers.host)) {
        res.writeHead(403).end('{"error":"bad host"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state.all()));
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200).end('ok');
      return;
    }

    res.writeHead(404).end();
  });

  return new Promise<http.Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

export { start, isLoopbackHost };
