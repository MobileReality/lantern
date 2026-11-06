import { CREDENTIAL_VARS } from './auth/env-names';
import type { Auth } from './auth';
import { PROVIDER } from '@shared/providers';
import type { CodeHostId } from '@shared/providers';

type AccountSource = Pick<Auth, 'injectionFor'>;

interface AccountCredentials {
  token: string;
  email?: string;
}

type AccountLookup = (root: string, provider?: CodeHostId) => Promise<AccountCredentials | null>;

function accountLookup(auth: AccountSource): AccountLookup {
  return async (root, provider = PROVIDER.bitbucket) => {
    try {
      const group = (await auth.injectionFor(root))[provider];
      const { required } = CREDENTIAL_VARS[provider];
      const token = group?.credentials[required[required.length - 1]];
      const email = required.length > 1 ? group?.credentials[required[0]] : undefined;
      if (!token || (required.length > 1 && !email)) return null;
      return email ? { email, token } : { token };
    } catch {
      return null;
    }
  };
}

export { accountLookup };
export type { AccountCredentials, AccountLookup, AccountSource };
