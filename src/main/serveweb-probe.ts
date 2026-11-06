import http from 'node:http';
import { classifyServerPage, type ServerPage } from './serveweb-parse';

export function fetchServerPage(port: number, timeout: number, token: string, cb: (page: ServerPage | null) => void) {
  let settled = false;
  const done = (page: ServerPage | null) => {
    if (settled) return;
    settled = true;
    cb(page);
  };
  const req = http.get({ host: '127.0.0.1', port, path: '/', headers: { Cookie: `vscode-tkn=${token}` }, timeout }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => done(classifyServerPage(res.statusCode, body)));
  });
  req.on('error', () => done(null));
  req.on('timeout', () => {
    req.destroy();
    done(null);
  });
}
