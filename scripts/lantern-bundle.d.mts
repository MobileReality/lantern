type SkillStatus = 'installed' | 'refreshed' | 'current' | 'unmarked' | 'symlink' | 'home' | 'missing-source' | 'not-ignored' | 'off' | 'removed-off';
type AgentsStatus = 'installed' | 'refreshed' | 'current' | 'kept' | 'symlink' | 'missing-source';
type PermissionsStatus = 'written' | 'current' | 'unparseable' | 'not-ignored' | 'symlink' | 'missing-source' | 'failed' | 'not-a-directory' | 'home' | 'no-consent';
type Skipped = 'not-a-directory' | 'home' | 'not-ignored' | null;
type Provider = 'claude' | 'codex';

interface BundleResult {
  skipped: Skipped;
  skills: Record<string, SkillStatus>;
  agents: { status: AgentsStatus; files: string[] } | null;
  obsolete: string[];
  agentsSkipped?: string[];
  permissions?: { status: PermissionsStatus };
}

interface SkippedEntry {
  name: string;
  reason: string;
}

interface PermissionsOptions {
  project: string;
  root: string;
  home?: string;
  consent?: () => boolean | Promise<boolean>;
}

interface BundleOptions {
  project: string;
  root: string;
  home?: string;
  codexHome?: string;
  skills?: string[];
  agents?: boolean | string[];
  adopt?: string[];
  off?: string[];
  provider?: Provider;
  consent?: () => boolean | Promise<boolean>;
}

export const AGENTS_MARKER: string;
export const SKILL_MARKER: string;
export const OBSOLETE_SKILLS: ReadonlyArray<string>;
export const OBSOLETE_AGENTS: ReadonlyArray<string>;
export const BUNDLE_SKILLS: ReadonlyArray<{ name: string }>;
export const PROVIDERS: Readonly<Record<Provider, unknown>>;
export function gitIgnores(project: string, rel: string): Promise<boolean>;
export function ensureIgnored(project: string, rel: string, options?: { home?: string }): Promise<'ignored' | 'not-ignored'>;
export function installBundle(options: BundleOptions): BundleResult;
export function installBundleGuarded(options: BundleOptions): Promise<BundleResult>;
export function syncDelegatePermissions(options: PermissionsOptions): Promise<{ status: PermissionsStatus }>;
export function skippedEntries(result: Pick<BundleResult, 'skills' | 'agentsSkipped'>, provider?: Provider): SkippedEntry[];
export type { SkippedEntry, AgentsStatus, PermissionsStatus, BundleOptions, BundleResult, Provider, SkillStatus, Skipped };
