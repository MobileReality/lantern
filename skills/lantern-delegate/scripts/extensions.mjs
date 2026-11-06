#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { BUNDLED_SKILLS, switchableSkills } from './bundled-skills.mjs';
import { message } from './messages.mjs';

export const EXTENSION_SLOT = Object.freeze({ delegate: 'delegate', orchestrator: 'orchestrator', reviewer: 'reviewer' });
export const EXTENSION_SLOTS = Object.freeze(Object.values(EXTENSION_SLOT));

export const EXTENSION_SCOPE = Object.freeze({ global: 'global', project: 'project' });
export const EXTENSION_SCOPES = Object.freeze(Object.values(EXTENSION_SCOPE));

export const LOCKED_SKILLS = Object.freeze([...BUNDLED_SKILLS]);
export const LOCKED_SKILL_PREFIX = 'lantern-plan';

export const EXTENSIONS_FOLDER = '.claude';
export const EXTENSIONS_FILE = 'lantern-extensions.json';

export const SKILL_LINKER_KEY = 'skillLinker';
export const OFF_KEY = 'off';

const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const JSON_INDENT = 2;
const GIT_ENTRY = '.git';
const WORKTREE_POINTER = /^gitdir:\s*(.+)$/m;
const WORKTREE_GIT_DIR = /^(.*?)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$/;

export class ExtensionsError extends Error {}

export const extensionsPath = (home = homedir()) => join(home, EXTENSIONS_FOLDER, EXTENSIONS_FILE);

export const projectExtensionsPath = (projectRoot) => join(projectRoot, EXTENSIONS_FOLDER, EXTENSIONS_FILE);

export const isLockedSkill = (name) => LOCKED_SKILLS.includes(name) || name.startsWith(LOCKED_SKILL_PREFIX);

const emptySlots = () => Object.fromEntries(EXTENSION_SLOTS.map((slot) => [slot, []]));

export const mergeExtras = (...lists) => [...new Set(lists.flat())];

function nearestGit(dir) {
    let at = dir;
    while (!existsSync(join(at, GIT_ENTRY))) {
        const parent = dirname(at);
        if (parent === at) return null;
        at = parent;
    }
    return at;
}

function mainCheckoutOf(worktreeRoot) {
    const pointer = join(worktreeRoot, GIT_ENTRY);
    try {
        if (!statSync(pointer).isFile()) return null;
        const target = WORKTREE_POINTER.exec(readFileSync(pointer, 'utf8'))?.[1].trim();
        return target ? (WORKTREE_GIT_DIR.exec(resolve(worktreeRoot, target))?.[1] ?? null) : null;
    } catch {
        return null;
    }
}

export function projectRootOf(dir) {
    const start = resolve(dir);
    const top = nearestGit(start);
    const main = top && mainCheckoutOf(top);
    return main ? join(main, relative(top, start)) : start;
}

function assertSlot(slot) {
    if (!EXTENSION_SLOTS.includes(slot)) throw new ExtensionsError(message('extensions.badSlot', { slot: String(slot), slots: EXTENSION_SLOTS.join(', ') }));
}

export function assertExtras(names) {
    const seen = new Set();
    for (const name of names) {
        if (typeof name !== 'string' || !PLAIN_NAME.test(name) || name.includes('..')) throw new ExtensionsError(message('extensions.badName', { name: String(name) }));
        if (isLockedSkill(name)) throw new ExtensionsError(message('extensions.locked', { name }));
        if (seen.has(name)) throw new ExtensionsError(message('extensions.duplicate', { name }));
        seen.add(name);
    }
}

function readFileText(file) {
    try {
        return readFileSync(file, 'utf8');
    } catch (cause) {
        if (cause.code === 'ENOENT') return null;
        throw new ExtensionsError(message('extensions.unreadable', { file, reason: cause.message }));
    }
}

function readObject(file) {
    const text = readFileText(file);
    if (text === null) return {};
    let data;
    try {
        data = JSON.parse(text);
    } catch (cause) {
        throw new ExtensionsError(message('extensions.unreadable', { file, reason: cause.message }));
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ExtensionsError(message('extensions.notAnObject', { file }));
    return data;
}

const readData = (home) => readObject(extensionsPath(home));

function writeAtomic(file, data) {
    const tmp = `${file}.lantern-${process.pid}-${Date.now()}`;
    try {
        writeFileSync(tmp, `${JSON.stringify(data, null, JSON_INDENT)}\n`);
        renameSync(tmp, file);
    } catch (cause) {
        rmSync(tmp, { force: true });
        throw cause;
    }
}

function writeData(home, data) {
    const file = extensionsPath(home);
    mkdirSync(join(home, EXTENSIONS_FOLDER), { recursive: true });
    writeAtomic(file, data);
    return file;
}

const withoutLocked = (names) => names.filter((name) => !(typeof name === 'string' && isLockedSkill(name)));

function readOff(data, home) {
    const off = emptySlots();
    const dropped = [];
    const value = data[OFF_KEY];
    if (value === undefined) return { off, dropped };
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ExtensionsError(message('extensions.offNotAnObject', { file: extensionsPath(home) }));
    for (const slot of EXTENSION_SLOTS) {
        if (value[slot] === undefined) continue;
        if (!Array.isArray(value[slot])) throw new ExtensionsError(message('extensions.notAList', { slot: `${OFF_KEY}.${slot}`, file: extensionsPath(home) }));
        const allowed = switchableSkills(slot);
        const kept = value[slot].filter((name) => typeof name === 'string' && allowed.includes(name));
        dropped.push(...value[slot].filter((name) => !kept.includes(name)).map(String));
        off[slot] = [...new Set(kept)];
    }
    return { off, dropped };
}

function readSlots(data, file) {
    const slots = emptySlots();
    const dropped = [];
    for (const slot of EXTENSION_SLOTS) {
        if (data[slot] === undefined) continue;
        if (!Array.isArray(data[slot])) throw new ExtensionsError(message('extensions.notAList', { slot, file }));
        const kept = withoutLocked(data[slot]);
        dropped.push(...data[slot].filter((name) => !kept.includes(name)));
        assertExtras(kept);
        slots[slot] = kept;
    }
    return { slots, dropped: [...new Set(dropped)] };
}

export function readExtensionsChecked(home = homedir()) {
    const data = readData(home);
    const { slots, dropped } = readSlots(data, extensionsPath(home));
    const switchedOff = readOff(data, home);
    return { slots, dropped, off: switchedOff.off, droppedOff: [...new Set(switchedOff.dropped)] };
}

export const readExtensions = (home = homedir()) => readExtensionsChecked(home).slots;

export const readSwitchedOff = (home = homedir()) => readExtensionsChecked(home).off;

export function readProjectExtensionsChecked(projectRoot) {
    const file = projectExtensionsPath(projectRoot);
    return { file, ...readSlots(readObject(file), file) };
}

export const readProjectExtensions = (projectRoot) => readProjectExtensionsChecked(projectRoot).slots;

export function assertSwitchable(slot, names) {
    const allowed = switchableSkills(slot);
    const seen = new Set();
    for (const name of names) {
        if (typeof name !== 'string' || !allowed.includes(name)) throw new ExtensionsError(message('extensions.notSwitchable', { name: String(name), slot }));
        if (seen.has(name)) throw new ExtensionsError(message('extensions.duplicate', { name }));
        seen.add(name);
    }
}

export function setSwitchedOff(slot, names, home = homedir()) {
    assertSlot(slot);
    if (!Array.isArray(names)) throw new ExtensionsError(message('extensions.notAList', { slot: `${OFF_KEY}.${slot}`, file: extensionsPath(home) }));
    assertSwitchable(slot, names);
    const data = readData(home);
    const current = data[OFF_KEY];
    const others = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : {};
    data[OFF_KEY] = { ...others, [slot]: [...names] };
    return writeData(home, data);
}

export function setExtensions(slot, names, home = homedir()) {
    assertSlot(slot);
    if (!Array.isArray(names)) throw new ExtensionsError(message('extensions.notAList', { slot, file: extensionsPath(home) }));
    assertExtras(names);
    const data = { ...readData(home), [slot]: [...names] };
    for (const other of EXTENSION_SLOTS) if (Array.isArray(data[other])) data[other] = withoutLocked(data[other]);
    return writeData(home, data);
}

function assertProjectFolderSafe(projectRoot) {
    const folder = join(projectRoot, EXTENSIONS_FOLDER);
    if (!statSync(projectRoot, { throwIfNoEntry: false })?.isDirectory()) throw new ExtensionsError(message('extensions.projectNotAFolder', { folder: projectRoot }));
    const entry = lstatSync(folder, { throwIfNoEntry: false });
    if (entry && !entry.isDirectory()) throw new ExtensionsError(message('extensions.projectUnsafe', { folder }));
    const file = lstatSync(projectExtensionsPath(projectRoot), { throwIfNoEntry: false });
    if (file && !file.isFile()) throw new ExtensionsError(message('extensions.projectUnsafe', { folder: projectExtensionsPath(projectRoot) }));
}

export function setProjectExtensions(slot, names, projectRoot) {
    assertSlot(slot);
    const file = projectExtensionsPath(projectRoot);
    if (!Array.isArray(names)) throw new ExtensionsError(message('extensions.notAList', { slot, file }));
    assertExtras(names);
    assertProjectFolderSafe(projectRoot);
    const data = { ...readObject(file), [slot]: [...names] };
    for (const other of EXTENSION_SLOTS) if (Array.isArray(data[other])) data[other] = withoutLocked(data[other]);
    mkdirSync(join(projectRoot, EXTENSIONS_FOLDER), { recursive: true });
    writeAtomic(file, data);
    return file;
}

export function assertSkillLinker(value) {
    if (typeof value !== 'string' || !isAbsolute(value)) throw new ExtensionsError(message('extensions.badSkillLinker', { value: String(value) }));
}

export function readSkillLinker(home = homedir()) {
    const value = readData(home)[SKILL_LINKER_KEY];
    if (value === undefined) return null;
    assertSkillLinker(value);
    return value;
}

export function setSkillLinker(value, home = homedir()) {
    assertSkillLinker(value);
    return writeData(home, { ...readData(home), [SKILL_LINKER_KEY]: value });
}
