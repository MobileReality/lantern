import { CREDENTIAL_VARS } from './auth/env-names';
import type { Auth } from './auth';
import type { HostCredentials } from './lantern-host-credentials';
import { PROVIDER } from '@shared/providers';

type AccountSource = Pick<Auth, 'injectionFor'>;

type AccountLookup = (root: string) => Promise<HostCredentials | null>;

const [EMAIL_VAR, TOKEN_VAR] = CREDENTIAL_VARS[PROVIDER.bitbucket].required;

function accountLookup(auth: AccountSource): AccountLookup {
  return async (root) => {
    try {
      const group = (await auth.injectionFor(root))[PROVIDER.bitbucket];
      const email = group?.credentials[EMAIL_VAR];
      const token = group?.credentials[TOKEN_VAR];
      return email && token ? { email, token } : null;
    } catch {
      return null;
    }
  };
}

export { accountLookup };
export type { AccountLookup, AccountSource };
