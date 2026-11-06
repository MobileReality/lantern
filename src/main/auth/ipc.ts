import path from 'node:path';
import {
  AUTH_ADD_TOKEN_CHANNEL,
  AUTH_BIND_CHANNEL,
  AUTH_CHANGED_CHANNEL,
  AUTH_PROJECT_CHANNEL,
  AUTH_REMOVE_PROFILE_CHANNEL,
  AUTH_RENAME_PROFILE_CHANNEL,
  AUTH_SET_EMAIL_CHANNEL,
  AUTH_SET_EXPIRY_CHANNEL,
  AUTH_STATUS_CHANNEL,
  AUTH_UNBIND_CHANNEL,
} from '@shared/auth';
import { AUTH_ERROR } from '@shared/auth-kinds';
import type { AddTokenResult, AuthChange, AuthError, AuthReply, EditResult, ProjectReply } from '@shared/auth-view';
import { msg } from '@shared/lang/messages';
import { BindingError } from './errors';
import type { Auth } from './index';
import { isProviderId } from './providers';
import type { ProviderId } from './providers';
import { isRecord } from './private-file';

type AuthAnyReply = AuthReply | ProjectReply | AddTokenResult | EditResult;

interface SenderEvent {
  sender: { mainFrame?: unknown };
  senderFrame?: { url: string } | null;
}

type Handler = (event: any, ...args: any[]) => unknown;

interface IpcMainLike {
  handle(channel: string, listener: Handler): void;
}

interface AuthIpcDeps {
  ipc: IpcMainLike;
  fromWorkspace: (fn: Handler) => Handler;
  auth: Auth;
  broadcast: (channel: string, payload: AuthChange) => void;
  isOwnFrame?: (event: SenderEvent) => boolean;
}

const WORKSPACE_PAGE_SUFFIX = '/renderer/workspace.html';
const PROFILE_ID = /^[\w-]{1,64}$/;
const MAX_PROJECT_LENGTH = 4096;
const INVALID = Symbol('invalid');

function isWorkspaceFrame(event: SenderEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(frame.url);
    return url.protocol === 'file:' && url.pathname.endsWith(WORKSPACE_PAGE_SUFFIX);
  } catch {
    return false;
  }
}

function parseProject(value: unknown): string | undefined | typeof INVALID {
  if (value === undefined || value === null) return undefined;
  const valid = typeof value === 'string' && value.length <= MAX_PROJECT_LENGTH && !value.includes('\0') && path.isAbsolute(value);
  return valid ? value : INVALID;
}

function parseProfileId(value: unknown): string | typeof INVALID {
  return typeof value === 'string' && PROFILE_ID.test(value) ? value : INVALID;
}

function parseProvider(value: unknown): ProviderId | typeof INVALID {
  return isProviderId(value) ? value : INVALID;
}

const invalid = { ok: false, error: AUTH_ERROR.invalidRequest } as const;

function createAuthHandlers(auth: Auth) {
  const ok = (project?: string): AuthReply => ({ ok: true, status: auth.status(project) });

  function status(arg: unknown): AuthReply {
    const project = parseProject(arg);
    return project === INVALID ? invalid : ok(project);
  }

  async function projectOf(arg: unknown): Promise<ProjectReply> {
    const project = parseProject(arg);
    if (project === INVALID || project === undefined) return invalid;
    return { ok: true, project: await auth.project(project) };
  }

  function bind(arg: unknown): AuthReply {
    if (!isRecord(arg)) return invalid;
    const provider = parseProvider(arg.provider);
    const profileId = parseProfileId(arg.profileId);
    const project = parseProject(arg.project);
    if (provider === INVALID || profileId === INVALID || project === INVALID || project === undefined) return invalid;
    try {
      auth.bind(provider, profileId, project);
    } catch (err) {
      if (err instanceof BindingError) return { ok: false, error: err.reason };
      throw err;
    }
    return ok(project);
  }

  function unbind(arg: unknown): AuthReply {
    if (!isRecord(arg)) return invalid;
    const provider = parseProvider(arg.provider);
    const project = parseProject(arg.project);
    if (provider === INVALID || project === INVALID || project === undefined) return invalid;
    auth.unbind(provider, project);
    return ok(project);
  }

  function removeProfile(arg: unknown): AuthReply {
    if (!isRecord(arg)) return invalid;
    const profileId = parseProfileId(arg.profileId);
    const project = parseProject(arg.project);
    if (profileId === INVALID || project === INVALID) return invalid;
    return auth.removeProfile(profileId) ? ok(project) : { ok: false, error: AUTH_ERROR.unknownProfile };
  }

  async function addToken(arg: unknown): Promise<AddTokenResult> {
    try {
      return await auth.addToken(arg);
    } catch {
      return { ok: false, error: AUTH_ERROR.storageFailed, message: msg('auth.unexpected') };
    }
  }

  function renameProfile(arg: unknown): EditResult {
    if (!isRecord(arg)) return invalid;
    const profileId = parseProfileId(arg.profileId);
    return profileId === INVALID ? invalid : auth.renameProfile(profileId, arg.nickname);
  }

  function setExpiry(arg: unknown): EditResult {
    if (!isRecord(arg) || !('expiresOn' in arg)) return invalid;
    const profileId = parseProfileId(arg.profileId);
    return profileId === INVALID ? invalid : auth.setExpiry(profileId, arg.expiresOn);
  }

  function setEmail(arg: unknown): EditResult {
    if (!isRecord(arg) || !('email' in arg)) return invalid;
    const profileId = parseProfileId(arg.profileId);
    return profileId === INVALID ? invalid : auth.setEmail(profileId, arg.email);
  }

  return { status, project: projectOf, bind, unbind, removeProfile, addToken, renameProfile, setExpiry, setEmail };
}

function registerAuthIpc({ ipc, fromWorkspace, auth, broadcast, isOwnFrame = isWorkspaceFrame }: AuthIpcDeps) {
  const handlers = createAuthHandlers(auth);
  const guarded = (fn: (arg: unknown) => AuthAnyReply | Promise<AuthAnyReply>) =>
    fromWorkspace((event, arg) => (isOwnFrame(event) ? fn(arg) : undefined));
  ipc.handle(AUTH_STATUS_CHANNEL, guarded(handlers.status));
  ipc.handle(AUTH_PROJECT_CHANNEL, guarded(handlers.project));
  ipc.handle(AUTH_BIND_CHANNEL, guarded(handlers.bind));
  ipc.handle(AUTH_UNBIND_CHANNEL, guarded(handlers.unbind));
  ipc.handle(AUTH_REMOVE_PROFILE_CHANNEL, guarded(handlers.removeProfile));
  ipc.handle(AUTH_ADD_TOKEN_CHANNEL, guarded(handlers.addToken));
  ipc.handle(AUTH_RENAME_PROFILE_CHANNEL, guarded(handlers.renameProfile));
  ipc.handle(AUTH_SET_EXPIRY_CHANNEL, guarded(handlers.setExpiry));
  ipc.handle(AUTH_SET_EMAIL_CHANNEL, guarded(handlers.setEmail));
  return auth.onChange((provider) => broadcast(AUTH_CHANGED_CHANNEL, { provider }));
}

export { createAuthHandlers, registerAuthIpc, isWorkspaceFrame };
export type { AuthReply, AuthError, AuthChange, ProjectReply, AuthIpcDeps };
