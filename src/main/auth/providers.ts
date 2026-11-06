import { PROVIDER, PROVIDER_IDS, PROVIDER_ROLE, PROVIDERS, TOKEN_FIELD } from '@shared/providers';
import type { CodeHostId, ProviderId, ProviderInfo, ProviderRole, TokenField } from '@shared/providers';

interface RefreshedTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

interface AccountInfo {
  login: string;
  displayName: string;
}

interface ProviderDriver {
  refresh(refreshToken: string): Promise<RefreshedTokens>;
  profile(accessToken: string): Promise<AccountInfo>;
}

type ProviderDrivers = Partial<Record<ProviderId, ProviderDriver>>;

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

function isAllowedProviderUrl(provider: ProviderId, url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && PROVIDERS[provider].hosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export { PROVIDER, PROVIDER_IDS, PROVIDER_ROLE, PROVIDERS, TOKEN_FIELD, isProviderId, isAllowedProviderUrl };
export type { CodeHostId, ProviderId, ProviderInfo, ProviderRole, TokenField, ProviderDriver, ProviderDrivers, RefreshedTokens, AccountInfo };
