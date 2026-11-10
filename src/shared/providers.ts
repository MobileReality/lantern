const PROVIDER = { github: 'github', jira: 'jira', bitbucket: 'bitbucket' } as const;

type ProviderId = keyof typeof PROVIDER;

const PROVIDER_IDS: readonly ProviderId[] = Object.values(PROVIDER);

const PROVIDER_ROLE = { codeHost: 'code-host', tracker: 'tracker' } as const;

type ProviderRole = (typeof PROVIDER_ROLE)[keyof typeof PROVIDER_ROLE];

const TOKEN_FIELD = { site: 'site', email: 'email', token: 'token' } as const;

type TokenField = (typeof TOKEN_FIELD)[keyof typeof TOKEN_FIELD];

interface ProviderInfo {
  id: ProviderId;
  name: string;
  role: ProviderRole;
  hosts: readonly string[];
  remoteHost: string | null;
  remoteAliases: readonly string[];
  tokenPage: string;
  tokenFields: readonly TokenField[];
  reportsExpiry: boolean;
  optionalEmail: boolean;
}

const TABLE = {
  [PROVIDER.github]: {
    id: PROVIDER.github,
    name: 'GitHub',
    role: PROVIDER_ROLE.codeHost,
    hosts: ['github.com', 'api.github.com'],
    remoteHost: 'github.com',
    remoteAliases: ['ssh.github.com'],
    tokenPage: 'github.com/settings/personal-access-tokens/new',
    tokenFields: [TOKEN_FIELD.token],
    reportsExpiry: true,
    optionalEmail: true,
  },
  [PROVIDER.jira]: {
    id: PROVIDER.jira,
    name: 'Jira',
    role: PROVIDER_ROLE.tracker,
    hosts: ['auth.atlassian.com', 'api.atlassian.com'],
    remoteHost: null,
    remoteAliases: [],
    tokenPage: 'id.atlassian.com/manage-profile/security/api-tokens',
    tokenFields: [TOKEN_FIELD.site, TOKEN_FIELD.email, TOKEN_FIELD.token],
    reportsExpiry: false,
    optionalEmail: false,
  },
  [PROVIDER.bitbucket]: {
    id: PROVIDER.bitbucket,
    name: 'Bitbucket',
    role: PROVIDER_ROLE.codeHost,
    hosts: ['bitbucket.org', 'api.bitbucket.org'],
    remoteHost: 'bitbucket.org',
    remoteAliases: [],
    tokenPage: 'id.atlassian.com/manage-profile/security/api-tokens',
    tokenFields: [TOKEN_FIELD.email, TOKEN_FIELD.token],
    reportsExpiry: false,
    optionalEmail: false,
  },
} as const satisfies Record<ProviderId, ProviderInfo>;

const PROVIDERS: Record<ProviderId, ProviderInfo> = TABLE;

type CodeHostId = { [K in ProviderId]: (typeof TABLE)[K]['role'] extends typeof PROVIDER_ROLE.codeHost ? K : never }[ProviderId];

const providersWithRole = (role: ProviderRole): ProviderId[] => PROVIDER_IDS.filter((id) => PROVIDERS[id].role === role);

const CODE_HOST_IDS = PROVIDER_IDS.filter((id): id is CodeHostId => PROVIDERS[id].role === PROVIDER_ROLE.codeHost);

const PROVIDER_OF_HOSTNAME = new Map(CODE_HOST_IDS.flatMap((id) => [...PROVIDERS[id].hosts, ...PROVIDERS[id].remoteAliases].map((hostname) => [hostname, id] as const)));

function providerOfRecordUrl(url: string): CodeHostId | null {
  try {
    return PROVIDER_OF_HOSTNAME.get(new URL(url).hostname.toLowerCase().replace(/^www\./, '')) ?? null;
  } catch {
    return null;
  }
}

export { CODE_HOST_IDS, PROVIDER, PROVIDER_IDS, PROVIDER_ROLE, PROVIDERS, TOKEN_FIELD, providerOfRecordUrl, providersWithRole };
export type { CodeHostId, ProviderId, ProviderInfo, ProviderRole, TokenField };
