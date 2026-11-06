import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

type Answer = object | ((request: { project: string; provider: string }) => object);

const open: (() => Promise<void>)[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const close of open.splice(0)) await close();
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

function shortFolder(prefix = 'lfl-'): string {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  folders.push(folder);
  return folder;
}

async function startFakeLantern(socketPath: string, answer: Answer) {
  const requests: { project: string; provider: string }[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      received += chunk;
      const end = received.indexOf('\n');
      if (end < 0) return;
      const request = JSON.parse(received.slice(0, end));
      requests.push(request);
      socket.end(`${JSON.stringify(typeof answer === 'function' ? answer(request) : answer)}\n`);
    });
  });
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  open.push(
    () =>
      new Promise<void>((resolve) => {
        sockets.forEach((socket) => { socket.destroy(); });
        server.close(() => resolve());
      }),
  );
  return { requests };
}

export { shortFolder, startFakeLantern };
