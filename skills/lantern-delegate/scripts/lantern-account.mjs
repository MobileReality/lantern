import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOST_SKILL, hostScript, skillRoots } from './host-skill.mjs';

export const EMAIL_SOURCE = Object.freeze({ profile: 'profile', env: 'env', none: 'none' });

const COMMIT_EMAIL = 'GIT_COMMIT_EMAIL';
const SOCKET_MODULE = 'lantern-socket.mjs';

async function loadSocket(host, roots) {
    const script = host && HOST_SKILL[host] ? hostScript(host, roots) : null;
    const file = script && join(dirname(script), SOCKET_MODULE);
    if (!file || !existsSync(file)) return null;
    try {
        return await import(pathToFileURL(file).href);
    } catch {
        return null;
    }
}

export async function profileEmail({ host, cwd = process.cwd(), env = process.env, roots = skillRoots({ cwd }) } = {}) {
    const socket = await loadSocket(host, roots);
    if (!socket) return null;
    const reply = await socket.askLantern({ provider: host, names: [COMMIT_EMAIL], cwd, paths: socket.socketPaths({ env }) });
    const email = reply.ok ? reply.env[COMMIT_EMAIL]?.trim() : '';
    return email || null;
}
