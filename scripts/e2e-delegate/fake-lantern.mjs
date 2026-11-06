import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const FAKE_ACCOUNT = Object.freeze({ BITBUCKET_EMAIL: 'e2e@example.test', BITBUCKET_API_TOKEN: 'dummy-token' });
export const SOCKET_FILE = 'lantern.sock';
export const REFUSAL = Object.freeze({ ok: false, reason: 'no-account' });

const GRANTS = Object.freeze({ bitbucket: FAKE_ACCOUNT });

export const answerFor = (request) => (Object.hasOwn(GRANTS, request?.provider) ? { ok: true, env: GRANTS[request.provider] } : REFUSAL);

function parseRequest(line) {
    try {
        return JSON.parse(line);
    } catch {
        return null;
    }
}

export async function startFakeLantern(folder) {
    const socketPath = path.join(folder, SOCKET_FILE);
    const sockets = new Set();
    const requests = [];
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        let received = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
            received += chunk;
            const end = received.indexOf('\n');
            if (end < 0) return;
            const request = parseRequest(received.slice(0, end));
            requests.push(request);
            socket.end(`${JSON.stringify(answerFor(request))}\n`);
        });
    });
    fs.mkdirSync(folder, { recursive: true });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
    });
    server.unref();
    const close = () =>
        new Promise((resolve) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => resolve());
        });
    return { socketPath, requests, close };
}
