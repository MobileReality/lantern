#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { message } from './messages.mjs';

export const DELIVERY = Object.freeze({ pr: 'pr', push: 'push', local: 'local' });

export const PREFERENCE_VALUES = Object.freeze({ delivery: Object.values(DELIVERY) });

export const PREFERENCES_FOLDER = '.claude';
export const PREFERENCES_FILE = 'lantern-preferences.json';

export const EXIT = Object.freeze({ ok: 0, failed: 1, usage: 2 });

const PROJECT_FLAG = '--project';
const JSON_INDENT = 2;

export class PreferenceError extends Error {}

export const preferencesPath = (project) => join(resolve(project), PREFERENCES_FOLDER, PREFERENCES_FILE);

const knownKeys = () => Object.keys(PREFERENCE_VALUES).join(', ');
const allowedValues = (key) => PREFERENCE_VALUES[key].join(', ');

function readFileText(file) {
    try {
        return readFileSync(file, 'utf8');
    } catch (cause) {
        if (cause.code === 'ENOENT') return null;
        throw new PreferenceError(message('preferences.unreadable', { file, reason: cause.message }));
    }
}

export function readPreferences(project) {
    const file = preferencesPath(project);
    const text = readFileText(file);
    if (text === null) return {};
    let data;
    try {
        data = JSON.parse(text);
    } catch (cause) {
        throw new PreferenceError(message('preferences.unreadable', { file, reason: cause.message }));
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new PreferenceError(message('preferences.notAnObject', { file }));
    return data;
}

function assertKey(key) {
    if (!Object.hasOwn(PREFERENCE_VALUES, key)) throw new PreferenceError(message('preferences.badKey', { key, known: knownKeys() }));
}

export function storedPreference(project, key) {
    assertKey(key);
    const value = readPreferences(project)[key];
    if (value === undefined) return null;
    if (!PREFERENCE_VALUES[key].includes(value)) throw new PreferenceError(message('preferences.storedInvalid', { file: preferencesPath(project), value: String(value), values: allowedValues(key) }));
    return value;
}

export function setPreference(project, key, value) {
    assertKey(key);
    if (!PREFERENCE_VALUES[key].includes(value)) throw new PreferenceError(message('preferences.badValue', { value: String(value), values: allowedValues(key) }));
    const data = { ...readPreferences(project), [key]: value };
    const file = preferencesPath(project);
    mkdirSync(join(resolve(project), PREFERENCES_FOLDER), { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, JSON_INDENT)}\n`);
    return file;
}

const COMMANDS = Object.freeze({
    get: { positionals: 1, run: (project, [key]) => storedPreference(project, key) ?? message('preferences.unset') },
    set: { positionals: 2, run: (project, [key, value]) => message('preferences.saved', { key, value, file: setPreference(project, key, value) }) },
});

function splitArgs(argv) {
    const at = argv.indexOf(PROJECT_FLAG);
    if (at === -1) return { rest: argv, project: process.cwd() };
    return { rest: [...argv.slice(0, at), ...argv.slice(at + 2)], project: argv[at + 1] };
}

export function run(argv, write = { out: (text) => console.log(text), err: (text) => console.error(text) }) {
    const { rest, project } = splitArgs(argv);
    const [name, ...positionals] = rest;
    const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
    const usage = message('preferences.usage', { values: PREFERENCE_VALUES.delivery.join('|') });
    if (!command || !project || positionals.length !== command.positionals) {
        write.err(usage);
        return EXIT.usage;
    }
    try {
        write.out(command.run(project, positionals));
        return EXIT.ok;
    } catch (error) {
        if (!(error instanceof PreferenceError)) throw error;
        write.err(error.message);
        return EXIT.failed;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = run(process.argv.slice(2));
