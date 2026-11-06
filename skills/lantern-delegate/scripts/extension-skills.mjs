import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { EXTENSION_SLOT, EXTENSION_SLOTS, ExtensionsError, extensionsPath, mergeExtras, projectExtensionsPath, readExtensionsChecked, readProjectExtensionsChecked } from './extensions.mjs';
import { message } from './messages.mjs';

export const claudeSkillRoots = (cwd, home = homedir()) => [join(cwd, '.claude', 'skills'), join(home, '.claude', 'skills')];

export const skillResolves = (name, roots) => roots.some((root) => existsSync(join(root, name, 'SKILL.md')));

const emptySlots = () => Object.fromEntries(Object.values(EXTENSION_SLOT).map((slot) => [slot, []]));

function readGlobal(home) {
    try {
        const { slots, dropped, off, droppedOff } = readExtensionsChecked(home);
        const warnings = [
            ...(dropped.length ? [message('extensions.droppedLocked', { names: dropped.join(', ') })] : []),
            ...(droppedOff.length ? [message('extensions.droppedOff', { names: droppedOff.join(', ') })] : []),
        ];
        return { slots, off, warnings };
    } catch (cause) {
        if (!(cause instanceof ExtensionsError)) throw cause;
        return { slots: emptySlots(), off: emptySlots(), warnings: [message('extensions.damaged', { reason: cause.message })] };
    }
}

function readProject(projectRoot, home) {
    if (!projectRoot || projectExtensionsPath(resolve(projectRoot)) === extensionsPath(resolve(home))) return { slots: emptySlots(), warnings: [] };
    try {
        const { slots, dropped, file } = readProjectExtensionsChecked(projectRoot);
        return { slots, warnings: dropped.length ? [message('extensions.projectDroppedLocked', { file, names: dropped.join(', ') })] : [] };
    } catch (cause) {
        if (!(cause instanceof ExtensionsError)) throw cause;
        return { slots: emptySlots(), warnings: [message('extensions.projectDamaged', { reason: cause.message })] };
    }
}

export function configuredExtras(home = homedir(), projectRoot = null) {
    const global = readGlobal(home);
    const project = readProject(projectRoot, home);
    const slots = Object.fromEntries(EXTENSION_SLOTS.map((slot) => [slot, mergeExtras(global.slots[slot], project.slots[slot])]));
    return { slots, scopes: { global: global.slots, project: project.slots }, off: global.off, warnings: [...global.warnings, ...project.warnings] };
}

export function resolvedExtras(slot, names, roots) {
    const present = names.filter((name) => skillResolves(name, roots));
    const warnings = names.filter((name) => !present.includes(name)).map((name) => message('extensions.skipped', { slot, name, roots: roots.join(', ') }));
    return { present, warnings };
}
