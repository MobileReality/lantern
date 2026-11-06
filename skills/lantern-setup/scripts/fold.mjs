#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_ALIAS, MAP_DIR, toPosix } from './lib.mjs';
import { LANG_DIR } from './texts.mjs';

const root = path.resolve(process.argv[2] ?? '.');

function aliasedFiles(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) aliasedFiles(abs, out);
        else if (toPosix(path.relative(root, abs)).split('/').includes(CLAUDE_ALIAS)) out.push(abs);
    }
    return out;
}

function pruneEmptyAliases(dir, inside = false) {
    if (!fs.existsSync(dir)) return;
    const within = inside || path.basename(dir) === CLAUDE_ALIAS;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) pruneEmptyAliases(path.join(dir, entry.name), within);
    if (within && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

const bases = [path.join(root, MAP_DIR), path.join(root, LANG_DIR)];
let moved = 0;
for (const base of bases) {
    for (const file of aliasedFiles(base)) {
        const target = path.join(root, ...toPosix(path.relative(root, file)).split('/').map((segment) => (segment === CLAUDE_ALIAS ? '.claude' : segment)));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(file, target);
        console.log(`${toPosix(path.relative(root, file))} -> ${toPosix(path.relative(root, target))}`);
        moved += 1;
    }
    pruneEmptyAliases(base);
}
console.log(moved ? `${moved} file(s) moved out of ${CLAUDE_ALIAS}` : `nothing under ${CLAUDE_ALIAS}`);
