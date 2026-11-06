type ValueOf<T> = T[keyof T];

const CHECK_FAILURE = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  unavailable: 'unavailable',
  network: 'network',
  timeout: 'timeout',
  malformed: 'malformed',
} as const;

const AUTH_ERROR = {
  invalidRequest: 'invalid-request',
  invalidInput: 'invalid-input',
  checkFailed: 'check-failed',
  storageFailed: 'storage-failed',
  unknownProfile: 'unknown-profile',
  wrongProvider: 'wrong-provider',
  providerReportsExpiry: 'provider-reports-expiry',
} as const;

const CONNECTION_STATE = {
  connected: 'connected',
  connectedOffline: 'connected-offline',
  expired: 'expired',
  unavailable: 'unavailable',
} as const;

const BINDING_CHOICE = { bound: 'bound', default: 'default', choose: 'choose', unused: 'unused', none: 'none' } as const;

const PERSISTENCE = { secure: 'secure', memoryOnly: 'memory-only' } as const;

const CREDENTIAL_KIND = { oauth: 'oauth', static: 'static' } as const;

const EXPIRY_SOURCE = { provider: 'provider', manual: 'manual' } as const;

const EXPIRY_LEVEL = { none: 'none', ok: 'ok', soon: 'soon', expired: 'expired' } as const;

const CREDENTIAL_SOURCE = { environment: 'environment', lantern: 'lantern', projectFile: 'project-file', none: 'none' } as const;

const CREDENTIAL_REFUSAL = {
  noAccount: 'no-account',
  chooseAccount: 'choose-account',
  storeUnavailable: 'store-unavailable',
  unknownProject: 'unknown-project',
  badRequest: 'bad-request',
  tooLarge: 'too-large',
} as const;

type CheckFailure = ValueOf<typeof CHECK_FAILURE>;
type CredentialRefusal = ValueOf<typeof CREDENTIAL_REFUSAL>;
type AuthErrorCode = ValueOf<typeof AUTH_ERROR>;
type ErrorCodeOf<K extends keyof typeof AUTH_ERROR> = (typeof AUTH_ERROR)[K];
type ConnectionState = ValueOf<typeof CONNECTION_STATE>;
type BindingChoice = ValueOf<typeof BINDING_CHOICE>;
type Persistence = ValueOf<typeof PERSISTENCE>;
type CredentialKind = ValueOf<typeof CREDENTIAL_KIND>;
type ExpirySource = ValueOf<typeof EXPIRY_SOURCE>;
type ExpiryLevel = ValueOf<typeof EXPIRY_LEVEL>;
type CredentialSource = ValueOf<typeof CREDENTIAL_SOURCE>;

export { AUTH_ERROR, BINDING_CHOICE, CHECK_FAILURE, CONNECTION_STATE, CREDENTIAL_KIND, CREDENTIAL_REFUSAL, CREDENTIAL_SOURCE, EXPIRY_LEVEL, EXPIRY_SOURCE, PERSISTENCE };
export type { AuthErrorCode, BindingChoice, CheckFailure, ConnectionState, CredentialKind, CredentialRefusal, CredentialSource, ErrorCodeOf, ExpiryLevel, ExpirySource, Persistence };
