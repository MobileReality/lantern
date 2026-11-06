export const EXTENSION_SLOT = { delegate: 'delegate', orchestrator: 'orchestrator', reviewer: 'reviewer' } as const;

export type ExtensionSlot = (typeof EXTENSION_SLOT)[keyof typeof EXTENSION_SLOT];

export const EXTENSION_SLOTS: readonly ExtensionSlot[] = Object.values(EXTENSION_SLOT);

export const EXTENSION_SCOPE = { global: 'global', project: 'project' } as const;

export type ExtensionScope = (typeof EXTENSION_SCOPE)[keyof typeof EXTENSION_SCOPE];

export const EXTENSION_SCOPES: readonly ExtensionScope[] = Object.values(EXTENSION_SCOPE);

export const isExtensionScope = (value: unknown): value is ExtensionScope => typeof value === 'string' && (EXTENSION_SCOPES as readonly string[]).includes(value);

export const mergeExtras = (...lists: readonly (readonly string[])[]): string[] => [...new Set(lists.flat())];

export const LOCKED_SKILL_PREFIX = 'lantern-plan';

export const EXTENSIONS_FOLDER = '.claude';
export const EXTENSIONS_FILE = 'lantern-extensions.json';

const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/]|\\\\)/;
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const SKILL_LINKER_KEY = 'skillLinker';

export const SKILL_LINKER_STATE = { initialized: 'initialized', unset: 'unset', invalid: 'invalid' } as const;

export type SkillLinkerState = (typeof SKILL_LINKER_STATE)[keyof typeof SKILL_LINKER_STATE];

export const OFF_KEY = 'off';

export type ExtensionProblem = 'badName' | 'locked' | 'duplicate' | 'notSwitchable';

export const isExtensionSlot = (value: unknown): value is ExtensionSlot => typeof value === 'string' && (EXTENSION_SLOTS as readonly string[]).includes(value);

export const hasLockedPrefix = (name: string): boolean => name.startsWith(LOCKED_SKILL_PREFIX);

export const isLockedSkill = (name: string, locked: readonly string[]): boolean => locked.includes(name) || hasLockedPrefix(name);

export function extraProblem(names: readonly string[], locked: readonly string[]): { problem: ExtensionProblem; name: string } | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== 'string' || !PLAIN_NAME.test(name) || name.includes('..')) return { problem: 'badName', name: String(name) };
    if (isLockedSkill(name, locked)) return { problem: 'locked', name };
    if (seen.has(name)) return { problem: 'duplicate', name };
    seen.add(name);
  }
  return null;
}

export function offProblem(names: readonly string[], switchable: readonly string[]): { problem: ExtensionProblem; name: string } | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== 'string' || !switchable.includes(name)) return { problem: 'notSwitchable', name: String(name) };
    if (seen.has(name)) return { problem: 'duplicate', name };
    seen.add(name);
  }
  return null;
}

export const isSkillLinkerPath = (value: unknown): value is string => typeof value === 'string' && ABSOLUTE_PATH.test(value);
