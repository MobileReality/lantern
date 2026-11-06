import { readFileSync } from 'node:fs';

const TABLE = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8'));

export function message(key, params = {}) {
    const text = key.split('.').reduce((at, part) => (at && typeof at === 'object' ? at[part] : undefined), TABLE);
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (placeholder, name) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));
}
