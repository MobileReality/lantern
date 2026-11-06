#!/usr/bin/env node
// Older maps recorded their writer in `#model` lines and `"model"` fields. Every reader ignores
// them now; run this once for the whole map, in its own commit, so no file is left half migrated.
import fs from 'node:fs';
import path from 'node:path';
import { listMapFiles } from './lib.mjs';
import { SECTIONS_DIR, SECTION_EXT } from './sections.mjs';
import { LANG_DIR } from './texts.mjs';

const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, '.lantern'))) {
    console.error('usage: migrate-model.mjs <project-root>   (the root must contain .lantern/)');
    process.exit(2);
}
const MODEL_LINE = /^#model(\s|$)/;

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs, out);
        else out.push(abs);
    }
    return out;
}

const changed = [];
const sections = walk(path.join(root, SECTIONS_DIR)).filter((file) => file.endsWith(SECTION_EXT));
for (const file of [...listMapFiles(root).map((rel) => path.join(root, rel)), ...sections]) {
    const text = fs.readFileSync(file, 'utf8');
    const kept = text.split('\n').filter((line) => !MODEL_LINE.test(line.replace(/\r$/, '')));
    if (kept.length === text.split('\n').length) continue;
    fs.writeFileSync(file, kept.join('\n'));
    changed.push(file);
}
for (const file of walk(path.join(root, LANG_DIR)).filter((f) => f.endsWith('.json'))) {
    const text = fs.readFileSync(file, 'utf8');
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        continue;
    }
    if (!json || typeof json !== 'object' || Array.isArray(json) || !('model' in json)) continue;
    delete json.model;
    // Re-serialised with the file's own indent and line endings; \u escapes come back as the characters.
    const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? ' ';
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    fs.writeFileSync(file, `${JSON.stringify(json, null, indent).replace(/\n/g, eol)}${eol}`);
    changed.push(file);
}
console.log(changed.length ? `removed model provenance from ${changed.length} file(s)` : 'nothing to migrate: no model provenance');
