import { registerAuthIpc } from '@main/auth/ipc';
import { createAuthWorld } from './auth-world';

type WorldOptions = NonNullable<Parameters<typeof createAuthWorld>[0]>;

const PROJECT = '/work/shop';
const WORKSPACE_URL = 'file:///Applications/Lantern.app/Contents/Resources/app/renderer/workspace.html?project=%2Fwork%2Fshop';

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)]);
}

function ipcOver(world: ReturnType<typeof createAuthWorld>) {
  const handlers = new Map<string, Listener>();
  const pushes: { channel: string; payload: unknown }[] = [];
  const mainFrame = { url: WORKSPACE_URL };
  const trustedContents = { mainFrame };
  const trusted = new Set<unknown>([trustedContents]);
  registerAuthIpc({
    ipc: { handle: (channel, listener) => void handlers.set(channel, listener) },
    fromWorkspace: (fn) => (e, ...args) => (trusted.has(e.sender) ? fn(e, ...args) : undefined),
    auth: world.auth,
    broadcast: (channel, payload) => void pushes.push({ channel, payload }),
  });
  const own = { sender: trustedContents, senderFrame: mainFrame };
  const call = (channel: string, arg?: unknown, event: unknown = own) => handlers.get(channel)?.(event, arg) as any;
  return { handlers, pushes, call, trustedContents, mainFrame };
}

async function ipcWorld(options: WorldOptions = {}) {
  const world = createAuthWorld(options);
  const work = await world.signIn('github', { login: 'work', displayName: 'Work' });
  const home = await world.signIn('github', { login: 'home', displayName: 'Home' });
  return { ...world, work: work.profile, home: home.profile, ...ipcOver(world) };
}

export { PROJECT, WORKSPACE_URL, ipcOver, ipcWorld, keysDeep };
