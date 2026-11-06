import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOOK_COMMAND = /(^|[\s/\\"'])rtk(\.exe)?\s+hook\s+claude(\s|$)/;

export function hookSettingsFiles(projectDirs = [], home = homedir()) {
    const files = [join(home, '.claude', 'settings.json')];
    for (const dir of projectDirs) files.push(join(dir, '.claude', 'settings.json'), join(dir, '.claude', 'settings.local.json'));
    return [...new Set(files)];
}

function readSettings(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function mentionsHook(node) {
    if (typeof node === 'string') return HOOK_COMMAND.test(node);
    if (Array.isArray(node)) return node.some(mentionsHook);
    if (node && typeof node === 'object') return Object.values(node).some(mentionsHook);
    return false;
}

export function findRtkHooks(projectDirs = [], home = homedir()) {
    const settings = hookSettingsFiles(projectDirs, home).map((file) => ({ file, content: readSettings(file) }));
    if (settings.some(({ content }) => content?.disableAllHooks === true)) return [];
    return settings.filter(({ content }) => mentionsHook(content?.hooks)).map(({ file }) => file);
}
