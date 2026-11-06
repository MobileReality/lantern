import path from 'node:path';

const PROVIDERS = ['claude', 'codex'] as const;

type Provider = (typeof PROVIDERS)[number];

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && PROVIDERS.includes(value as Provider);
}

function providerLabel(provider: Provider) {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
}

const SKILL_PATHS: Record<Provider, string[]> = {
  claude: ['.claude', 'skills'],
  codex: ['.agents', 'skills'],
};

function providerSkillsDir(base: string, provider: Provider = 'claude'): string {
  return path.join(base, ...SKILL_PATHS[provider]);
}

export { PROVIDERS, isProvider, isSessionId, providerLabel, providerSkillsDir };
export type { Provider };
