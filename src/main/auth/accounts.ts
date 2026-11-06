import { parseExpiryDate } from '@shared/auth-expiry';
import { parseCommitEmail, parseNickname, parseTokenInput } from '@shared/auth-input';
import { AUTH_ERROR, CHECK_FAILURE, EXPIRY_SOURCE } from '@shared/auth-kinds';
import type { AddTokenResult, EditResult } from '@shared/auth-view';
import { msg } from '@shared/lang/messages';
import { PROVIDERS, isProviderId } from './providers';
import type { ProviderId } from './providers';
import { andThen, done, refuse } from './outcome';
import type { Outcome } from './outcome';
import type { ExpirySource, Profile, ProfilePatch, ProfileStore } from './profiles';
import { profileStatus } from './status';
import type { ConnectionState } from './token-manager';
import { TokenCheckError, checkToken, describeCheckFailure } from './token-check';
import type { CheckDeps } from './token-check';
import { isRecord } from './private-file';

interface StaticGrant {
  provider: ProviderId;
  token: string;
  login: string;
  displayName: string;
  scopes: string[];
  email?: string | null;
  site?: string | null;
  expiresAt?: number | null;
  expirySource?: ExpirySource;
}

interface AccountsDeps {
  profiles: ProfileStore;
  connectStatic: (grant: StaticGrant) => { profile: Profile; created: boolean };
  stateOf: (profileId: string) => ConnectionState;
  emit: (provider: ProviderId) => void;
  check?: CheckDeps;
  log: (message: string, err?: unknown) => void;
}

type EditError = Extract<EditResult, { ok: false }>['error'];

type Change = (profile: Profile) => Outcome<ProfilePatch, EditError>;

type ExpiryRule = (profile: Profile, expiresOn: unknown) => Outcome<ProfilePatch, EditError> | undefined;

const fail = <E extends string>(error: E) => ({ ok: false, error }) as const;

const EXPIRY_RULES: readonly ExpiryRule[] = [
  (profile) => (profile.expirySource === EXPIRY_SOURCE.provider ? refuse(AUTH_ERROR.providerReportsExpiry) : undefined),
  (_profile, expiresOn) => (expiresOn === null ? done({ expiresAt: null, expirySource: null }) : undefined),
];

function manualExpiry(expiresOn: unknown): Outcome<ProfilePatch, EditError> {
  const expiresAt = typeof expiresOn === 'string' ? parseExpiryDate(expiresOn) : null;
  return expiresAt === null ? refuse(AUTH_ERROR.invalidRequest) : done({ expiresAt, expirySource: EXPIRY_SOURCE.manual });
}

const expiryChange =
  (expiresOn: unknown): Change =>
  (profile) =>
    EXPIRY_RULES.map((rule) => rule(profile, expiresOn)).find((outcome) => outcome !== undefined) ?? manualExpiry(expiresOn);

const nicknameChange =
  (nickname: unknown): Change =>
  () => {
    const name = parseNickname(nickname);
    return name === null ? refuse(AUTH_ERROR.invalidRequest) : done({ nickname: name });
  };

const emailChange =
  (email: unknown): Change =>
  (profile) => {
    const parsed = parseCommitEmail(email);
    return parsed.ok && PROVIDERS[profile.provider].optionalEmail ? done({ email: parsed.email }) : refuse(AUTH_ERROR.invalidRequest);
  };

function createAccounts({ profiles, connectStatic, stateOf, emit, check, log }: AccountsDeps) {
  const view = (profile: Profile) => profileStatus(stateOf, profile);

  async function addToken(raw: unknown): Promise<AddTokenResult> {
    if (!isRecord(raw) || !isProviderId(raw.provider)) return fail(AUTH_ERROR.invalidRequest);
    const provider = raw.provider;
    const parsed = parseTokenInput(provider, raw);
    if (!parsed.ok) return { ok: false, error: AUTH_ERROR.invalidInput, field: parsed.issue.field, message: parsed.issue.message };
    const { input } = parsed;

    let account;
    try {
      account = await checkToken(input, check);
    } catch (err) {
      const failure = err instanceof TokenCheckError ? err : new TokenCheckError(CHECK_FAILURE.network);
      log(failure.status ? msg('logs.tokenCheckFailedStatus', { provider, reason: failure.reason, status: failure.status }) : msg('logs.tokenCheckFailed', { provider, reason: failure.reason }));
      return { ok: false, error: AUTH_ERROR.checkFailed, reason: failure.reason, message: describeCheckFailure(provider, failure, check?.timeoutMs) };
    }

    const reported = account.expiresAt !== null;
    try {
      const { profile, created } = connectStatic({
        provider,
        token: input.token,
        login: account.login,
        displayName: account.displayName,
        scopes: account.scopes,
        email: input.email ?? account.email,
        site: input.site,
        expiresAt: reported ? account.expiresAt : input.expiresAt,
        expirySource: reported ? EXPIRY_SOURCE.provider : EXPIRY_SOURCE.manual,
      });
      const named = input.nickname && created ? (profiles.update(profile.id, { nickname: input.nickname }) ?? profile) : profile;
      log(msg(created ? 'logs.accountAdded' : 'logs.accountUpdated', { provider, login: account.login }));
      return { ok: true, profile: view(named), created };
    } catch (err) {
      log(msg('logs.tokenNotStored', { provider }), err);
      return { ok: false, error: AUTH_ERROR.storageFailed, message: msg('auth.storageFailed') };
    }
  }

  const profileOf = (profileId: unknown): Outcome<Profile, EditError> =>
    andThen(typeof profileId === 'string' ? done(profileId) : refuse(AUTH_ERROR.invalidRequest), (id) => {
      const profile = profiles.get(id);
      return profile ? done(profile) : refuse(AUTH_ERROR.unknownProfile);
    });

  const save = (id: string, patch: ProfilePatch): Outcome<Profile, EditError> => {
    const next = profiles.update(id, patch);
    return next ? done(next) : refuse(AUTH_ERROR.unknownProfile);
  };

  function edit(profileId: unknown, change: Change): EditResult {
    const saved = andThen(profileOf(profileId), (current) => andThen(change(current), (patch) => save(current.id, patch)));
    if ('error' in saved) return fail(saved.error);
    emit(saved.value.provider);
    return { ok: true, profile: view(saved.value) };
  }

  const rename = (profileId: unknown, nickname: unknown) => edit(profileId, nicknameChange(nickname));

  const setExpiry = (profileId: unknown, expiresOn: unknown) => edit(profileId, expiryChange(expiresOn));

  const setEmail = (profileId: unknown, email: unknown) => edit(profileId, emailChange(email));

  return { addToken, rename, setExpiry, setEmail };
}

export { createAccounts };
export type { StaticGrant, AddTokenResult, EditResult, AccountsDeps };
