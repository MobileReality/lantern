import type { ErrorCodeOf } from '@shared/auth-kinds';

type DriverErrorKind = 'invalid_grant' | 'network' | 'unavailable';

class DriverError extends Error {
  constructor(
    readonly kind: DriverErrorKind,
    message = kind,
  ) {
    super(message);
    this.name = 'DriverError';
  }
}

type TokenFailure = 'not-found' | 'expired' | 'offline' | 'unavailable' | 'persist-failed';

class TokenError extends Error {
  constructor(readonly reason: TokenFailure) {
    super(reason);
    this.name = 'TokenError';
  }
}

class BindingError extends Error {
  constructor(readonly reason: ErrorCodeOf<'unknownProfile' | 'wrongProvider'>) {
    super(reason);
    this.name = 'BindingError';
  }
}

export { DriverError, TokenError, BindingError };
export type { DriverErrorKind, TokenFailure };
