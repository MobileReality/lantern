import { EXTENSION_SCOPE, EXTENSION_SLOTS, type ExtensionScope, type ExtensionSlot, hasLockedPrefix, isLockedSkill, mergeExtras, SKILL_LINKER_STATE, type SkillLinkerState } from '@shared/extension-slots';

export interface ExtrasState {
  slots: Record<ExtensionSlot, string[]>;
  projectSlots: Record<ExtensionSlot, string[]>;
  projectRoot: string | null;
  alwaysOn: Record<ExtensionSlot, string[]>;
  switchable: Record<ExtensionSlot, string[]>;
  off: Record<ExtensionSlot, string[]>;
  locked: string[];
  installed: string[];
}

const byName = (a: string, b: string) => a.localeCompare(b);

export function pickerSkills(state: Pick<ExtrasState, 'installed' | 'locked'> & { skillLinkerState: SkillLinkerState }, repoSkills: readonly string[]): string[] {
  const fromRepo = state.skillLinkerState === SKILL_LINKER_STATE.initialized ? repoSkills : [];
  return [...new Set([...state.installed, ...fromRepo])].filter((name) => !isLockedSkill(name, state.locked)).sort(byName);
}

export interface SlotRows {
  locked: string[];
  switchable: string[];
  off: string[];
}

export function slotRows(slot: ExtensionSlot, state: Pick<ExtrasState, 'alwaysOn' | 'switchable' | 'off' | 'installed'>): SlotRows {
  const locked = [...new Set([...state.alwaysOn[slot], ...state.installed.filter(hasLockedPrefix)])];
  return {
    locked,
    switchable: locked.filter((name) => state.switchable[slot].includes(name)),
    off: state.off[slot],
  };
}

export const hasProjectScope = (state: Pick<ExtrasState, 'projectRoot'>): boolean => state.projectRoot !== null;

export function defaultScope(state: Pick<ExtrasState, 'projectRoot'>, chosen?: ExtensionScope): ExtensionScope {
  if (!hasProjectScope(state)) return EXTENSION_SCOPE.global;
  return chosen ?? EXTENSION_SCOPE.project;
}

export const otherScope = (scope: ExtensionScope): ExtensionScope => (scope === EXTENSION_SCOPE.global ? EXTENSION_SCOPE.project : EXTENSION_SCOPE.global);

export function effectiveExtras(slot: ExtensionSlot, state: Pick<ExtrasState, 'slots' | 'projectSlots'>): string[] {
  return mergeExtras(state.slots[slot], state.projectSlots[slot]);
}

export interface AttachedRow {
  name: string;
  scope: ExtensionScope;
  missing: boolean;
}

export function attachedRows(slot: ExtensionSlot, state: Pick<ExtrasState, 'slots' | 'projectSlots' | 'installed'>): AttachedRow[] {
  const global = state.slots[slot];
  const project = state.projectSlots[slot].filter((name) => !global.includes(name));
  const row = (scope: ExtensionScope) => (name: string): AttachedRow => ({ name, scope, missing: !state.installed.includes(name) });
  return [...global.map(row(EXTENSION_SCOPE.global)), ...project.map(row(EXTENSION_SCOPE.project))];
}

export interface CandidateRow {
  name: string;
  attached: ExtensionScope | null;
  locked: boolean;
  installed: boolean;
}

export function canLinkIntoProject(name: string, state: Pick<ExtrasState, 'projectRoot' | 'installed'>, repoSkills: readonly string[]): boolean {
  return hasProjectScope(state) && !state.installed.includes(name) && repoSkills.includes(name);
}

export function lockedNames(state: Pick<ExtrasState, 'locked' | 'installed'>): string[] {
  return [...new Set([...state.locked, ...state.installed.filter(hasLockedPrefix)])].sort(byName);
}

const matches = (name: string, query: string) => name.toLowerCase().includes(query.trim().toLowerCase());

export function candidateRows(slot: ExtensionSlot, state: ExtrasState & { skillLinkerState: SkillLinkerState }, repoSkills: readonly string[], query: string): CandidateRow[] {
  const attached = new Map(attachedRows(slot, state).map((row) => [row.name, row.scope] as const));
  const free = pickerSkills(state, repoSkills).filter((name) => matches(name, query)).map((name): CandidateRow => ({ name, attached: attached.get(name) ?? null, locked: false, installed: state.installed.includes(name) }));
  const builtIn = query.trim() ? lockedNames(state).filter((name) => matches(name, query)).map((name): CandidateRow => ({ name, attached: null, locked: true, installed: true })) : [];
  return [...free, ...builtIn];
}

export const KEY = { up: 'ArrowUp', down: 'ArrowDown', home: 'Home', end: 'End', enter: 'Enter', remove: 'Delete', back: 'Backspace', escape: 'Escape', left: 'ArrowLeft', right: 'ArrowRight' } as const;

export function nextIndex(key: string, index: number, count: number): number {
  if (count === 0) return -1;
  if (key === KEY.home) return 0;
  if (key === KEY.end) return count - 1;
  if (key === KEY.down) return Math.min(count - 1, index + 1);
  if (key === KEY.up) return Math.max(0, index - 1);
  return index;
}

export const roleAfter = (slot: ExtensionSlot, key: string): ExtensionSlot => {
  const at = EXTENSION_SLOTS.indexOf(slot);
  if (key === KEY.right || key === KEY.down) return EXTENSION_SLOTS[(at + 1) % EXTENSION_SLOTS.length];
  if (key === KEY.left || key === KEY.up) return EXTENSION_SLOTS[(at + EXTENSION_SLOTS.length - 1) % EXTENSION_SLOTS.length];
  if (key === KEY.home) return EXTENSION_SLOTS[0];
  if (key === KEY.end) return EXTENSION_SLOTS[EXTENSION_SLOTS.length - 1];
  return slot;
};

export type SkillRowKind = 'bundled' | 'local' | 'linked' | 'available';

export interface SkillsState {
  linked: string[];
  bundled: string[];
  local: string[];
}

export const BUNDLED_TOOLTIP = 'Installed by Lantern as a copy in .claude/skills, so it cannot be unlinked.';
export const LOCAL_TOOLTIP = 'A folder in .claude/skills that Lantern does not manage.';

const SKIP_REASONS: Record<string, string> = {
  'skipped-bundled': 'is bundled with Lantern, so it was left as it is',
  'skipped-local': 'is a local folder, so it was left as it is',
  'missing-source': 'was not found in the skills repo',
  failed: 'could not be linked',
};

export function skillRowKind(name: string, state: SkillsState): SkillRowKind {
  if (state.bundled.includes(name)) return 'bundled';
  if (state.local.includes(name)) return 'local';
  if (state.linked.includes(name)) return 'linked';
  return 'available';
}

export function isLinkable(name: string, state: SkillsState) {
  return skillRowKind(name, state) === 'available';
}

export function roleSummary(names: string[], state: SkillsState) {
  const kinds = names.map((n) => skillRowKind(n, state));
  return {
    installed: kinds.filter((k) => k !== 'available').length,
    linkable: names.filter((n) => isLinkable(n, state)),
    unlinkable: names.filter((n) => skillRowKind(n, state) === 'linked'),
  };
}

export function linkProblems(results: Record<string, string> | undefined) {
  return Object.entries(results ?? {})
    .filter(([, outcome]) => outcome in SKIP_REASONS)
    .map(([name, outcome]) => `${name} ${SKIP_REASONS[outcome]}.`);
}
