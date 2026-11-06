import fs from 'node:fs';

const MESSAGES = JSON.parse(fs.readFileSync(new URL('./messages.json', import.meta.url), 'utf8'));
const PLACEHOLDER = /\{(\w+)\}/g;

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, USAGE: 2 });

const codesOf = (section) => Object.freeze(Object.fromEntries(Object.keys(MESSAGES[section]).map((key) => [key, `${section}.${key}`])));

export const ERROR = codesOf('error');
export const WARNING = codesOf('warning');
export const LINE = codesOf('line');
export const NOUN = codesOf('noun');

export function say(code, params = {}) {
    const [section, key] = code.split('.');
    const template = MESSAGES[section]?.[key];
    if (template === undefined) throw new Error(`no message ${code}`);
    return template.replace(PLACEHOLDER, (_, name) => {
        if (!Object.hasOwn(params, name)) throw new Error(`message ${code} needs {${name}}`);
        return String(params[name]);
    });
}

export const located = (where, text) => say(LINE.LOCATED, { where, text });

export const plural = (count, one, many) => say(count === 1 ? one : many);
