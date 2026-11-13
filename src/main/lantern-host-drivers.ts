import { PROVIDER, providerOfRecordUrl } from '@shared/providers';
import type { CodeHostId } from '@shared/providers';
import type { AccountCredentials, AccountLookup } from './lantern-host-account';
import { fetchGithubState } from './lantern-host-github';
import { readHostCredentials } from './lantern-host-credentials';
import type { CodeHost } from './lantern-host-origin';
import { fetchHostState } from './lantern-host-request';
import type { HostAnswer, RequestOptions } from './lantern-host-request';
import type { LanternPrState } from './lantern-types';
import type { RateLimited } from './lantern-host-github';

type HostLookup = HostAnswer | RateLimited | null;

interface CredentialSources {
  account: AccountLookup | null;
  env?: NodeJS.ProcessEnv;
}

interface HostDriver {
  asks(state: LanternPrState): boolean;
  credentials(root: string, sources: CredentialSources): Promise<AccountCredentials | null>;
  fetch(host: CodeHost, id: string, credentials: AccountCredentials, options: RequestOptions): Promise<HostLookup>;
}

const isUnsettled = (state: LanternPrState) => state !== 'merged';

const DRIVERS: Record<CodeHostId, HostDriver> = {
  [PROVIDER.bitbucket]: {
    asks: isUnsettled,
    credentials: async (root, { account, env }) => (await account?.(root, PROVIDER.bitbucket)) ?? (await readHostCredentials(root, env)),
    fetch: async (host, id, { email, token }, options) => (email ? fetchHostState({ workspace: host.owner, repo: host.repo }, id, { email, token }, options) : null),
  },
  [PROVIDER.github]: {
    asks: () => true,
    credentials: async (root, { account }) => (await account?.(root, PROVIDER.github)) ?? null,
    fetch: (host, id, { token }, options) => fetchGithubState(host, id, token, options),
  },
};

function recordBelongsTo(provider: CodeHostId, url: string) {
  const named = providerOfRecordUrl(url);
  return named === null || named === provider;
}

export { DRIVERS, recordBelongsTo };
export type { HostDriver, HostLookup };
