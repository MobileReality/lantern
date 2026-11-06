#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadRoles, skillDir } from './lib.mjs';

const args = process.argv.slice(2);
const flagAt = args.indexOf('--file');
const file = flagAt === -1 ? path.join(skillDir(), 'example-web', 'locales.json') : args[flagAt + 1];

const locales = JSON.parse(fs.readFileSync(file, 'utf8'));
const problems = [];
const en = locales.en;
if (!en) {
    console.error(`${file}: no "en" locale`);
    process.exit(1);
}

const enKeys = new Set(Object.keys(en));
for (const role of loadRoles()) {
    for (const part of ['name', 'desc']) {
        if (!enKeys.has(`role.${role}.${part}`)) problems.push(`en: no entry for role "${role}" (role.${role}.${part})`);
    }
}
for (const [lang, table] of Object.entries(locales)) {
    if (lang === 'en') continue;
    const keys = new Set(Object.keys(table));
    for (const k of enKeys) if (!keys.has(k)) problems.push(`${lang}: missing key ${k}`);
    for (const k of keys) if (!enKeys.has(k)) problems.push(`${lang}: extra key ${k} (not in en)`);
    const slots = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of keys) {
        if (enKeys.has(k) && slots(table[k]) !== slots(en[k])) problems.push(`${lang}: ${k} placeholders differ from en`);
    }
}
for (const [lang, table] of Object.entries(locales)) {
    for (const [k, v] of Object.entries(table)) {
        if (typeof v !== 'string' || v === '') problems.push(`${lang}: ${k} is not a non-empty string`);
    }
}

if (problems.length) {
    console.error(`${problems.length} problem(s) in ${file}:\n  ${problems.join('\n  ')}`);
    process.exit(1);
}
console.log(`${file}: ${Object.keys(locales).join(', ')} ok, ${enKeys.size} keys each`);
