import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extraProblemMessage, offProblemMessage } from '@shared/extension-problem';
import { EXTENSION_SCOPE, EXTENSION_SLOTS, EXTENSIONS_FILE, EXTENSIONS_FOLDER, type ExtensionScope, type ExtensionSlot, extraProblem, isExtensionScope, isExtensionSlot, isLockedSkill, isSkillLinkerPath, mergeExtras, OFF_KEY, SKILL_LINKER_KEY, SKILL_LINKER_STATE, type SkillLinkerState } from '@shared/extension-slots';
import { msg } from '@shared/lang/messages';
import { alwaysOnSkills, BUNDLED_SKILLS, switchableSkills } from '@skills/lantern-delegate/scripts/bundled-skills.mjs';
import { projectRootOf } from '@skills/lantern-delegate/scripts/extensions.mjs';
import { resolveLinkerPath, resolveSkillLinker, SKILL_LINKER_SOURCE, SKILLS_REPO_ENV } from '@skills/lantern-delegate/scripts/skill-linker.mjs';

export type ExtensionSlots = Record<ExtensionSlot, string[]>;

export interface ExtensionsPanel {
  slots: ExtensionSlots;
  projectSlots: ExtensionSlots;
  projectRoot: string | null;
  projectError: string | null;
  alwaysOn: ExtensionSlots;
  switchable: ExtensionSlots;
  off: ExtensionSlots;
  locked: string[];
  installed: string[];
  skillLinker: string | null;
  skillLinkerState: SkillLinkerState;
  skillLinkerProblem: string | null;
  skillLinkerPath: string | null;
  skillLinkerFromRepo: boolean;
  error: string | null;
}

const MISSING_FILE = 'ENOENT';
const JSON_INDENT = 2;

export class ExtensionsError extends Error {}

export const extensionsPath = (home: string = os.homedir()): string => path.join(home, EXTENSIONS_FOLDER, EXTENSIONS_FILE);

export const projectExtensionsPath = (projectRoot: string): string => path.join(projectRoot, EXTENSIONS_FOLDER, EXTENSIONS_FILE);

export function projectRootFor(project: unknown, home: string = os.homedir()): string | null {
  if (typeof project !== 'string' || !project) return null;
  const root = projectRootOf(project);
  return projectExtensionsPath(root) === extensionsPath(path.resolve(home)) ? null : root;
}

const slotsBy = (build: (slot: ExtensionSlot) => string[]): ExtensionSlots => Object.fromEntries(EXTENSION_SLOTS.map((slot) => [slot, build(slot)])) as ExtensionSlots;

const emptySlots = (): ExtensionSlots => slotsBy(() => []);

const lockedSkills = (): string[] => [...BUNDLED_SKILLS];

const alwaysOnSlots = (): ExtensionSlots => slotsBy(alwaysOnSkills);

const switchableSlots = (): ExtensionSlots => slotsBy((slot) => [...switchableSkills(slot)]);

function assertExtras(names: readonly string[]): void {
  const problem = extraProblemMessage(names, BUNDLED_SKILLS);
  if (problem) throw new ExtensionsError(problem);
}

function readObject(file: string): Record<string, unknown> {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === MISSING_FILE) return {};
    throw new ExtensionsError(msg('extensions.unreadable', { file, reason: (err as Error).message }));
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new ExtensionsError(msg('extensions.invalidJson', { file, reason: (err as Error).message }));
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ExtensionsError(msg('extensions.notObject', { file }));
  return data as Record<string, unknown>;
}

const readData = (home: string): Record<string, unknown> => readObject(extensionsPath(home));

const withoutLocked = (names: unknown[]): unknown[] => names.filter((name) => !(typeof name === 'string' && isLockedSkill(name, BUNDLED_SKILLS)));

function readOff(data: Record<string, unknown>, home: string): { off: ExtensionSlots; dropped: string[] } {
  const off = emptySlots();
  const dropped = new Set<string>();
  const value = data[OFF_KEY];
  if (value === undefined) return { off, dropped: [] };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ExtensionsError(msg('extensions.offNotObject', { file: extensionsPath(home) }));
  for (const slot of EXTENSION_SLOTS) {
    const names = (value as Record<string, unknown>)[slot];
    if (names === undefined) continue;
    if (!Array.isArray(names)) throw new ExtensionsError(msg('extensions.slotNotList', { slot: `${OFF_KEY}.${slot}` }));
    const allowed = switchableSkills(slot);
    const kept = names.filter((name): name is string => typeof name === 'string' && allowed.includes(name));
    for (const name of names) if (!kept.includes(name)) dropped.add(String(name));
    off[slot] = [...new Set(kept)];
  }
  return { off, dropped: [...dropped] };
}

interface Checked {
  slots: ExtensionSlots;
  dropped: string[];
  off: ExtensionSlots;
  droppedOff: string[];
}

function readSlots(data: Record<string, unknown>): { slots: ExtensionSlots; dropped: string[] } {
  const slots = emptySlots();
  const dropped = new Set<string>();
  for (const slot of EXTENSION_SLOTS) {
    const value = data[slot];
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw new ExtensionsError(msg('extensions.slotNotList', { slot }));
    const kept = withoutLocked(value);
    for (const name of value) if (!kept.includes(name)) dropped.add(String(name));
    assertExtras(kept as string[]);
    slots[slot] = kept as string[];
  }
  return { slots, dropped: [...dropped] };
}

function readChecked(home: string): Checked {
  const data = readData(home);
  const { slots, dropped } = readSlots(data);
  const switchedOff = readOff(data, home);
  return { slots, dropped, off: switchedOff.off, droppedOff: switchedOff.dropped };
}

export const readExtensions = (home: string = os.homedir()): ExtensionSlots => readChecked(home).slots;

export const readSwitchedOff = (home: string = os.homedir()): ExtensionSlots => readChecked(home).off;

export function readProjectExtensions(projectRoot: string): { slots: ExtensionSlots; dropped: string[] } {
  return readSlots(readObject(projectExtensionsPath(projectRoot)));
}

function writeAtomic(file: string, data: Record<string, unknown>): void {
  const tmp = `${file}.lantern-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, JSON_INDENT)}\n`);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function writeData(home: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.join(home, EXTENSIONS_FOLDER), { recursive: true });
  writeAtomic(extensionsPath(home), data);
}

function assertProjectFolderSafe(projectRoot: string): void {
  if (!fs.statSync(projectRoot, { throwIfNoEntry: false })?.isDirectory()) throw new ExtensionsError(msg('extensions.projectNotAFolder', { folder: projectRoot }));
  const folder = path.join(projectRoot, EXTENSIONS_FOLDER);
  for (const target of [folder, projectExtensionsPath(projectRoot)]) {
    const entry = fs.lstatSync(target, { throwIfNoEntry: false });
    if (entry && !(target === folder ? entry.isDirectory() : entry.isFile())) throw new ExtensionsError(msg('extensions.projectUnsafe', { folder: target }));
  }
}

export function writeProjectExtensions(slot: string, names: readonly string[], projectRoot: string): void {
  if (!isExtensionSlot(slot)) throw new ExtensionsError(msg('extensions.unknownSlot', { slot }));
  if (!Array.isArray(names)) throw new ExtensionsError(msg('extensions.slotNotList', { slot }));
  assertExtras(names);
  assertProjectFolderSafe(projectRoot);
  const data: Record<string, unknown> = { ...readObject(projectExtensionsPath(projectRoot)), [slot]: [...names] };
  for (const other of EXTENSION_SLOTS) if (Array.isArray(data[other])) data[other] = withoutLocked(data[other]);
  fs.mkdirSync(path.join(projectRoot, EXTENSIONS_FOLDER), { recursive: true });
  writeAtomic(projectExtensionsPath(projectRoot), data);
}

export function writeExtensions(slot: string, names: readonly string[], home: string = os.homedir()): void {
  if (!isExtensionSlot(slot)) throw new ExtensionsError(msg('extensions.unknownSlot', { slot }));
  assertExtras(names);
  const data: Record<string, unknown> = { ...readData(home), [slot]: [...names] };
  for (const other of EXTENSION_SLOTS) if (Array.isArray(data[other])) data[other] = withoutLocked(data[other]);
  writeData(home, data);
}

function assertOff(slot: string, names: readonly string[]): void {
  if (!isExtensionSlot(slot)) throw new ExtensionsError(msg('extensions.unknownSlot', { slot }));
  const problem = offProblemMessage(names, switchableSkills(slot));
  if (problem) throw new ExtensionsError(problem);
}

export function writeSwitchedOff(slot: string, names: readonly string[], home: string = os.homedir()): void {
  assertOff(slot, names);
  const data = readData(home);
  const current = data[OFF_KEY];
  const others = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : {};
  writeData(home, { ...data, [OFF_KEY]: { ...others, [slot]: [...names] } });
}

type Params = Record<string, string>;

const LINKER_PROBLEM: Record<string, (params: Params) => string> = {
  missing: (params) => msg('extensions.linkerProblem.missing', params),
  notFile: (params) => msg('extensions.linkerProblem.notFile', params),
  notExecutable: (params) => msg('extensions.linkerProblem.notExecutable', params),
  noCore: (params) => msg('extensions.linkerProblem.noCore', params),
  folderNoExecutable: (params) => msg('extensions.linkerProblem.folderNoExecutable', params),
  folderNoCore: (params) => msg('extensions.linkerProblem.folderNoCore', params),
  folderSeveral: (params) => msg('extensions.linkerProblem.folderSeveral', params),
};

const linkerProblemText = (kind: string, params: Params): string | null => LINKER_PROBLEM[kind]?.(params) ?? null;

function linkerState(skillLinker: string | null, home: string): { state: SkillLinkerState; problem: string | null; path: string | null; fromRepo: boolean } {
  const resolved = resolveSkillLinker({ env: { [SKILLS_REPO_ENV]: process.env[SKILLS_REPO_ENV] }, home });
  if (resolved.path) return { state: SKILL_LINKER_STATE.initialized, problem: null, path: resolved.path, fromRepo: resolved.source === SKILL_LINKER_SOURCE.repo };
  if (skillLinker === null) return { state: SKILL_LINKER_STATE.unset, problem: null, path: null, fromRepo: false };
  return { state: SKILL_LINKER_STATE.invalid, path: null, fromRepo: false, problem: (resolved.problemKind ? linkerProblemText(resolved.problemKind, resolved.problemParams ?? {}) : null) ?? resolved.problem ?? null };
}

interface ProjectPart {
  projectSlots: ExtensionSlots;
  projectError: string | null;
}

function projectPart(projectRoot: string | null): ProjectPart {
  if (!projectRoot) return { projectSlots: emptySlots(), projectError: null };
  try {
    const { slots, dropped } = readProjectExtensions(projectRoot);
    return { projectSlots: slots, projectError: dropped.length ? msg('extensions.projectDroppedLocked', { file: projectExtensionsPath(projectRoot), names: dropped.join(', ') }) : null };
  } catch (err) {
    return { projectSlots: emptySlots(), projectError: (err as Error).message };
  }
}

function panelAfter(installed: string[], home: string, failure: unknown, projectRoot: string | null = null): ExtensionsPanel {
  const failed = failure instanceof Error ? failure.message : null;
  const project = { projectRoot, ...projectPart(projectRoot) };
  try {
    const skillLinker = readSkillLinker(home);
    const linker = linkerState(skillLinker, home);
    const { slots, dropped, off, droppedOff } = readChecked(home);
    const droppedTexts = [...(dropped.length ? [msg('extensions.droppedLocked', { names: dropped.join(', ') })] : []), ...(droppedOff.length ? [msg('extensions.droppedOff', { names: droppedOff.join(', ') })] : [])];
    const error = failed ?? (droppedTexts.length ? droppedTexts.join(' ') : null);
    return { slots, ...project, alwaysOn: alwaysOnSlots(), switchable: switchableSlots(), off, locked: lockedSkills(), installed, skillLinker, skillLinkerState: linker.state, skillLinkerProblem: linker.problem, skillLinkerPath: linker.path, skillLinkerFromRepo: linker.fromRepo, error };
  } catch (err) {
    return { slots: emptySlots(), ...project, alwaysOn: alwaysOnSlots(), switchable: switchableSlots(), off: emptySlots(), locked: lockedSkills(), installed, skillLinker: null, skillLinkerState: SKILL_LINKER_STATE.unset, skillLinkerProblem: null, skillLinkerPath: null, skillLinkerFromRepo: false, error: failed ?? (err as Error).message };
  }
}

export const loadExtensionsPanel = (installed: string[], home: string = os.homedir(), project: unknown = null): ExtensionsPanel => panelAfter(installed, home, null, projectRootFor(project, home));

interface ScopeTarget {
  project?: unknown;
  scope?: unknown;
}

function scopeOf(scope: unknown): ExtensionScope {
  if (scope === undefined) return EXTENSION_SCOPE.global;
  if (!isExtensionScope(scope)) throw new ExtensionsError(msg('extensions.unknownScope', { scope: String(scope) }));
  return scope;
}

function rootForScope(scope: ExtensionScope, projectRoot: string | null): string | null {
  if (scope === EXTENSION_SCOPE.global) return null;
  if (!projectRoot) throw new ExtensionsError(msg('extensions.noProjectScope'));
  return projectRoot;
}

function writeScope(scope: ExtensionScope, slot: string, names: readonly string[], home: string, projectRoot: string | null): void {
  const root = rootForScope(scope, projectRoot);
  if (root) writeProjectExtensions(slot, names, root);
  else writeExtensions(slot, names, home);
}

export function saveExtensionsSlot(slot: unknown, names: unknown, installed: string[], home: string = os.homedir(), off?: unknown, target: ScopeTarget = {}): ExtensionsPanel {
  const projectRoot = projectRootFor(target.project, home);
  try {
    const scope = scopeOf(target.scope);
    if (!Array.isArray(names)) throw new ExtensionsError(msg('extensions.slotNotList', { slot: String(slot) }));
    if (off !== undefined && !Array.isArray(off)) throw new ExtensionsError(msg('extensions.slotNotList', { slot: `${OFF_KEY}.${String(slot)}` }));
    if (off !== undefined) assertOff(String(slot), off);
    writeScope(scope, String(slot), names, home, projectRoot);
    if (off !== undefined) writeSwitchedOff(String(slot), off, home);
    return panelAfter(installed, home, null, projectRoot);
  } catch (err) {
    return panelAfter(installed, home, err, projectRoot);
  }
}

export function moveExtension(slot: unknown, name: unknown, from: unknown, to: unknown, installed: string[], home: string = os.homedir(), project: unknown = null): ExtensionsPanel {
  const projectRoot = projectRootFor(project, home);
  try {
    if (!isExtensionSlot(slot)) throw new ExtensionsError(msg('extensions.unknownSlot', { slot: String(slot) }));
    const source = scopeOf(from);
    const destination = scopeOf(to);
    rootForScope(source, projectRoot);
    rootForScope(destination, projectRoot);
    const lists = { [EXTENSION_SCOPE.global]: readExtensions(home)[slot], [EXTENSION_SCOPE.project]: projectRoot ? readProjectExtensions(projectRoot).slots[slot] : [] };
    if (typeof name !== 'string' || !lists[source].includes(name)) throw new ExtensionsError(msg('extensions.moveMissing', { name: String(name), scope: source, slot }));
    if (source !== destination) {
      writeScope(destination, slot, mergeExtras(lists[destination], [name]), home, projectRoot);
      writeScope(source, slot, lists[source].filter((taken) => taken !== name), home, projectRoot);
    }
    return panelAfter(installed, home, null, projectRoot);
  } catch (err) {
    return panelAfter(installed, home, err, projectRoot);
  }
}

const SKILLS_FOLDER = path.join('.claude', 'skills');
const SKILL_FILE = 'SKILL.md';
const EXISTS_CODE = 'EEXIST';

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function writeNewSkill(project: string, name: string, content: string): void {
  const skills = path.join(project, SKILLS_FOLDER);
  fs.mkdirSync(skills, { recursive: true });
  const dir = path.join(skills, name);
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === EXISTS_CODE) throw new ExtensionsError(msg('extensions.skillExists', { name }));
    throw err;
  }
  fs.writeFileSync(path.join(dir, SKILL_FILE), content);
}

export function createExtensionSkill(request: unknown, installed: string[], home: string = os.homedir()): ExtensionsPanel {
  const { project, slot, name, content, scope } = (request ?? {}) as Record<string, unknown>;
  const projectRoot = projectRootFor(project, home);
  try {
    if (!isExtensionSlot(slot)) throw new ExtensionsError(msg('extensions.unknownSlot', { slot: String(slot) }));
    if (typeof project !== 'string' || !isDirectory(project)) throw new ExtensionsError(msg('extensions.noProject'));
    if (typeof name !== 'string' || typeof content !== 'string') throw new ExtensionsError(msg('extensions.badSkill'));
    const target = scopeOf(scope);
    rootForScope(target, projectRoot);
    const taken = target === EXTENSION_SCOPE.global ? readExtensions(home)[slot] : readProjectExtensions(projectRoot as string).slots[slot];
    const names = [...taken, name];
    assertExtras(names);
    const written = content.trim() !== '';
    if (written) writeNewSkill(project, name, content);
    else if (!installed.includes(name)) throw new ExtensionsError(msg('extensions.emptyContent', { name }));
    writeScope(target, slot, names, home, projectRoot);
    return panelAfter(written ? [...new Set([...installed, name])].sort() : installed, home, null, projectRoot);
  } catch (err) {
    return panelAfter(installed, home, err, projectRoot);
  }
}

function assertSkillLinker(value: unknown): asserts value is string {
  if (!isSkillLinkerPath(value)) throw new ExtensionsError(msg('extensions.skillLinkerPath', { value: String(value) }));
}

export function readSkillLinker(home: string = os.homedir()): string | null {
  const value = readData(home)[SKILL_LINKER_KEY];
  if (value === undefined) return null;
  assertSkillLinker(value);
  return value;
}

export function writeSkillLinker(value: string, home: string = os.homedir()): void {
  assertSkillLinker(value);
  writeData(home, { ...readData(home), [SKILL_LINKER_KEY]: value });
}

export function clearSkillLinker(home: string = os.homedir()): void {
  const { [SKILL_LINKER_KEY]: _removed, ...rest } = readData(home);
  writeData(home, rest);
}

export function saveSkillLinker(value: unknown, installed: string[], home: string = os.homedir(), project: unknown = null): ExtensionsPanel {
  const projectRoot = projectRootFor(project, home);
  try {
    if (value === null || value === '') clearSkillLinker(home);
    else writeSkillLinker(isSkillLinkerPath(value) ? (resolveLinkerPath(value).path ?? value) : (value as string), home);
    return panelAfter(installed, home, null, projectRoot);
  } catch (err) {
    return panelAfter(installed, home, err, projectRoot);
  }
}

interface ExtensionsList {
  slots: ExtensionSlots;
  skillLinker: string | null;
}

export function readExtensionsList(file: string): ExtensionsList {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ExtensionsError(msg('extensions.importUnreadable', { file, reason: (err as Error).message }));
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ExtensionsError(msg('extensions.notObject', { file }));
  const record = data as Record<string, unknown>;
  const slots = emptySlots();
  for (const slot of EXTENSION_SLOTS) {
    const names = record[slot];
    if (names === undefined) continue;
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) throw new ExtensionsError(msg('extensions.importBadSlot', { file, slot }));
    slots[slot] = [...names];
  }
  const skillLinker = record[SKILL_LINKER_KEY] ?? null;
  if (skillLinker !== null) assertSkillLinker(skillLinker);
  return { slots, skillLinker };
}

export function importExtensionsList(file: string, installed: string[], home: string = os.homedir(), project: unknown = null): ExtensionsPanel {
  const projectRoot = projectRootFor(project, home);
  try {
    const list = readExtensionsList(file);
    const current = readExtensions(home);
    const data = readData(home);
    for (const slot of EXTENSION_SLOTS) {
      const added = list.slots[slot].filter((name) => !current[slot].includes(name) && !extraProblem([name], BUNDLED_SKILLS));
      if (added.length) data[slot] = [...current[slot], ...new Set(added)];
    }
    if (list.skillLinker !== null) data[SKILL_LINKER_KEY] = list.skillLinker;
    writeData(home, data);
    return panelAfter(installed, home, null, projectRoot);
  } catch (err) {
    return panelAfter(installed, home, err, projectRoot);
  }
}
