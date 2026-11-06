import type { AuthChange } from '@main/auth/ipc';
import { createAuthHandlers } from '@main/auth/ipc';
import { createAuthWorld } from './auth-world';
import { startFakeProviders } from './fake-providers';
import type { FakeProviders } from './fake-providers';

type WorldOptions = NonNullable<Parameters<typeof createAuthWorld>[0]>;

async function installAuthWindow(options: WorldOptions = {}) {
  const fake: FakeProviders = await startFakeProviders();
  const world = createAuthWorld({
    ...options,
    check: { endpoints: fake.endpoints, timeoutMs: 2000, fetch: (url, init) => fetch(url, { ...init, signal: undefined }) },
  });
  const handlers = createAuthHandlers(world.auth);
  const subscribers: ((change: AuthChange) => void)[] = [];
  const calls: { name: string; args: unknown[] }[] = [];
  world.auth.onChange((provider) => subscribers.forEach((subscriber) => { subscriber({ provider }); }));

  const track =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      calls.push({ name, args });
      return fn(...args);
    };

  window.ccmws = {
    authStatus: track('authStatus', async (project?: string) => handlers.status(project)),
    authProject: track('authProject', (project: string) => handlers.project(project)),
    authAddToken: track('authAddToken', (input: Record<string, unknown>) => handlers.addToken(input)),
    authRenameProfile: track('authRenameProfile', async (profileId: string, nickname: string) => handlers.renameProfile({ profileId, nickname })),
    authSetExpiry: track('authSetExpiry', async (profileId: string, expiresOn: string | null) => handlers.setExpiry({ profileId, expiresOn })),
    authSetEmail: track('authSetEmail', async (profileId: string, email: string | null) => handlers.setEmail({ profileId, email })),
    authRemoveProfile: track('authRemoveProfile', async (profileId: string, project?: string) => handlers.removeProfile({ profileId, project })),
    authBind: track('authBind', async (provider: string, profileId: string, project: string) => handlers.bind({ provider, profileId, project })),
    authUnbind: track('authUnbind', async (provider: string, project: string) => handlers.unbind({ provider, project })),
    onAuthChanged: (cb: (change: AuthChange) => void) => void subscribers.push(cb),
  } as unknown as Window['ccmws'];

  return { ...world, fake, calls, close: () => fake.close() };
}

type AuthWindow = Awaited<ReturnType<typeof installAuthWindow>>;

export { installAuthWindow };
export type { AuthWindow };
