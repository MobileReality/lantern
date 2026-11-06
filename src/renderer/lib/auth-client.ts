import { AUTH_ERROR } from '@shared/auth-kinds';
import type { AddTokenResult, AuthStatus, EditResult, ProjectIntegrations } from '@shared/auth-view';
import { msg } from '@shared/lang/messages';
import type { ProviderId } from '@shared/providers';

type AuthListener = (provider: ProviderId | null) => void;

const listeners = new Set<AuthListener>();
let subscribedTo: Window['ccmws'] | null = null;

function ensureSubscribed() {
  if (subscribedTo === window.ccmws) return;
  subscribedTo = window.ccmws;
  window.ccmws.onAuthChanged?.((change) => listeners.forEach((listener) => { listener(change.provider); }));
}

function onAuthChange(listener: AuthListener): () => void {
  ensureSubscribed();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

async function attempt<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

async function loadAuthStatus(): Promise<AuthStatus | null> {
  const reply = await attempt(() => window.ccmws.authStatus());
  return reply?.ok ? reply.status : null;
}

async function loadProjectIntegrations(project: string): Promise<ProjectIntegrations | null> {
  const reply = await attempt(() => window.ccmws.authProject(project));
  return reply?.ok ? reply.project : null;
}

const failed = { ok: false, error: AUTH_ERROR.invalidRequest } as const;
const unreachable: AddTokenResult = { ok: false, error: AUTH_ERROR.storageFailed, message: msg('auth.unreachable') };

const addToken = async (input: Record<string, unknown>): Promise<AddTokenResult> => (await attempt(() => window.ccmws.authAddToken(input))) ?? unreachable;

const renameAccount = async (profileId: string, nickname: string): Promise<EditResult> => (await attempt(() => window.ccmws.authRenameProfile(profileId, nickname))) ?? failed;

const setAccountExpiry = async (profileId: string, expiresOn: string | null): Promise<EditResult> => (await attempt(() => window.ccmws.authSetExpiry(profileId, expiresOn))) ?? failed;

const setAccountEmail = async (profileId: string, email: string | null): Promise<EditResult> => (await attempt(() => window.ccmws.authSetEmail(profileId, email))) ?? failed;

const removeAccount = async (profileId: string): Promise<boolean> => (await attempt(() => window.ccmws.authRemoveProfile(profileId)))?.ok === true;

const bindAccount = async (provider: ProviderId, profileId: string, project: string): Promise<boolean> => (await attempt(() => window.ccmws.authBind(provider, profileId, project)))?.ok === true;

const unbindAccount = async (provider: ProviderId, project: string): Promise<boolean> => (await attempt(() => window.ccmws.authUnbind(provider, project)))?.ok === true;

export { onAuthChange, loadAuthStatus, loadProjectIntegrations, addToken, renameAccount, setAccountEmail, setAccountExpiry, removeAccount, bindAccount, unbindAccount };
