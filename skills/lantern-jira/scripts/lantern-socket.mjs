import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { message } from './messages.mjs';

export const SOCKET_ENV = 'LANTERN_CREDENTIAL_SOCKET';
export const NOT_RUNNING = 'not-running';

const PROFILE_ENV = 'LANTERN_PROFILE';
const DEV_PROFILE = 'dev';
const APP_DIR = 'Lantern';
const DEV_SUFFIX = '-dev';
const SOCKET_FILE = 'lantern.sock';
const PIPE_PREFIX = '\\\\.\\pipe\\';
const PIPE_NAME = 'lantern-credentials';
const TIMEOUT_MS = 3000;
const MAX_REPLY_BYTES = 16384;
const BAD_REPLY = 'bad-reply';

const USER_DATA_ROOT = Object.freeze({
  darwin: ({ home }) => path.join(home, 'Library', 'Application Support'),
  win32: ({ home, env }) => env.APPDATA || path.join(home, 'AppData', 'Roaming'),
  linux: ({ home, env }) => env.XDG_CONFIG_HOME || path.join(home, '.config'),
});

const REASON_MESSAGES = Object.freeze({
  'no-account': 'credentials.reason.noAccount',
  'choose-account': 'credentials.reason.chooseAccount',
  'store-unavailable': 'credentials.reason.storeUnavailable',
  'unknown-project': 'credentials.reason.unknownProject',
  [NOT_RUNNING]: 'credentials.reason.notRunning',
});

const present = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '';

const locationOf = (profileSuffix, { env, platform, home, username }) => {
  if (platform === 'win32') return `${PIPE_PREFIX}${PIPE_NAME}-${username}${profileSuffix}`;
  const root = (USER_DATA_ROOT[platform] ?? USER_DATA_ROOT.linux)({ home, env });
  return path.join(root, `${APP_DIR}${profileSuffix}`, SOCKET_FILE);
};

export function socketPaths({ env, platform = process.platform, home = os.homedir(), username = os.userInfo().username }) {
  if (present(env, SOCKET_ENV)) return [env[SOCKET_ENV].trim()];
  const suffixes = env[PROFILE_ENV] === DEV_PROFILE ? [DEV_SUFFIX, ''] : ['', DEV_SUFFIX];
  return suffixes.map((suffix) => locationOf(suffix, { env, platform, home, username }));
}

const parseLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

const readReply = (line, names) => {
  const reply = parseLine(line);
  if (reply?.ok === true && reply.env && typeof reply.env === 'object') {
    const granted = names.filter((name) => typeof reply.env[name] === 'string' && reply.env[name].trim() !== '');
    return { ok: true, env: Object.fromEntries(granted.map((name) => [name, reply.env[name]])) };
  }
  return { ok: false, reason: reply?.ok === false && typeof reply.reason === 'string' ? reply.reason : BAD_REPLY };
};

function exchange(socketPath, request, names, timeoutMs) {
  return new Promise((resolve) => {
    let received = '';
    const socket = net.createConnection(socketPath);
    const settle = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => settle(null));
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('error', () => settle(null));
    socket.on('close', () => settle(null));
    socket.on('data', (chunk) => {
      received += chunk;
      const end = received.indexOf('\n');
      if (end >= 0) settle(readReply(received.slice(0, end), names));
      else if (received.length > MAX_REPLY_BYTES) settle(null);
    });
  });
}

export async function askLantern({ provider, names, cwd, paths, timeoutMs = TIMEOUT_MS }) {
  for (const socketPath of paths) {
    const reply = await exchange(socketPath, { project: cwd, provider }, names, timeoutMs);
    if (reply) return reply;
  }
  return { ok: false, reason: NOT_RUNNING };
}

export async function completeEnv(env, { provider, required, optional = [], cwd, ask = askLantern, ...where }) {
  if (required.some((name) => present(env, name))) return { env, reason: null };
  const reply = await ask({ provider, names: [...required, ...optional], cwd, paths: where.paths ?? socketPaths({ env, ...where }), timeoutMs: where.timeoutMs });
  if (!reply.ok) return { env, reason: reply.reason };
  const received = Object.entries(reply.env).filter(([name]) => !present(env, name));
  return { env: { ...env, ...Object.fromEntries(received) }, reason: null };
}

export const reasonText = (reason) => (reason ? message(REASON_MESSAGES[reason] ?? 'credentials.reason.refused') : '');
