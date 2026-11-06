#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_ALIAS, claudeAliasOf, dirOf, encodePath, enumerate, hashFile, loadFeatures, loadMap, loadRoles, mapFileFor, readLang } from './lib.mjs';
import { loadPlatforms, resolvePlatform } from './platforms.mjs';
import { runRetag } from './retag-plan.mjs';
import { langFileFor, loadLangs, recordTextsDone } from './texts.mjs';
import { loadSystems } from './vocabulary.mjs';

const MAX_CHUNK_FILES = 25;
const MAX_CHUNK_BYTES = 150_000;
const USAGE = 'usage: plan.mjs <root> [chunks | pending | chunk <id> | status [--json] | retag [status | pending | chunk <id>]]';

function groupByDir(files) {
    const groups = new Map();
    for (const file of files) {
        const dir = dirOf(file.path);
        if (!groups.has(dir)) groups.set(dir, []);
        groups.get(dir).push(file);
    }
    return [...groups.values()];
}

function splitGroup(group) {
    const parts = [];
    let part = [];
    let bytes = 0;
    for (const file of group) {
        if (part.length && (part.length >= MAX_CHUNK_FILES || bytes + file.size > MAX_CHUNK_BYTES)) {
            parts.push(part);
            part = [];
            bytes = 0;
        }
        part.push(file);
        bytes += file.size;
    }
    if (part.length) parts.push(part);
    return parts;
}

function buildChunks(files) {
    const chunks = [];
    let current = { files: [], bytes: 0 };
    const flush = () => {
        if (current.files.length) chunks.push(current);
        current = { files: [], bytes: 0 };
    };
    for (const group of groupByDir(files)) {
        const bytes = group.reduce((sum, f) => sum + f.size, 0);
        const fits = current.files.length + group.length <= MAX_CHUNK_FILES && current.bytes + bytes <= MAX_CHUNK_BYTES;
        if (fits) {
            current.files.push(...group);
            current.bytes += bytes;
            continue;
        }
        flush();
        for (const part of splitGroup(group)) {
            flush();
            current = { files: part, bytes: part.reduce((sum, f) => sum + f.size, 0) };
        }
    }
    flush();
    return chunks.map((chunk, i) => ({
        id: i + 1,
        files: chunk.files,
        bytes: chunk.bytes,
        mapFiles: [...new Set(chunk.files.map((f) => mapFileFor(f.path)))],
    }));
}

function doneSet(root, roles) {
    const done = new Set();
    const langs = loadLangs(root);
    const primary = readLang(root);
    for (const record of loadMap(root).records) {
        if (record.marker !== '.' || !roles.has(record.role)) continue;
        if (!recordTextsDone(langs, primary, record)) continue;
        if (record.file !== mapFileFor(record.path)) continue;
        try {
            if (hashFile(root, record.path) === record.hash) done.add(record.path);
        } catch {}
    }
    return done;
}

function describe(chunk, done) {
    const pending = chunk.files.filter((f) => !done.has(f.path)).length;
    return `chunk ${chunk.id}: ${chunk.files.length} files, ${chunk.bytes} bytes, ${pending} pending -> ${chunk.mapFiles.join(' ')}`;
}

function countFiles(root, rel, suffix) {
    try {
        return fs.readdirSync(path.join(root, rel)).filter((name) => name.endsWith(suffix)).length;
    } catch {
        return 0;
    }
}

function progressOf(root, chunks, done) {
    const sum = (files, pick) => files.reduce((total, f) => total + pick(f), 0);
    const all = chunks.flatMap((c) => c.files);
    const mapped = all.filter((f) => done.has(f.path));
    const nextChunk = chunks.find(isPending);
    const nextFile = nextChunk?.files.find((f) => !done.has(f.path));
    return {
        files: { done: mapped.length, total: all.length },
        bytes: { done: sum(mapped, (f) => f.size), total: sum(all, (f) => f.size) },
        chunks: { done: chunks.filter((c) => !isPending(c)).length, total: chunks.length },
        next: nextChunk ? { id: nextChunk.id, dir: dirOf(nextFile.path) || '.', files: nextChunk.files.length, pending: nextChunk.files.filter((f) => !done.has(f.path)).length } : null,
        features: fs.existsSync(path.join(root, '.lantern', 'features')),
        platforms: fs.existsSync(path.join(root, '.lantern', 'platforms')),
        systems: fs.existsSync(path.join(root, '.lantern', 'systems')),
        sections: countFiles(root, '.lantern/sections', '.section'),
    };
}

function printClaudeAliases(root, chunk) {
    const mapFiles = chunk.mapFiles.filter((file) => claudeAliasOf(file) !== file);
    if (!mapFiles.length) return;
    const primary = readLang(root);
    console.log(`# Write and Edit refuse a path with a .claude folder: write each file below, whole, at the right-hand path (${CLAUDE_ALIAS} for .claude), then run fold.mjs . to move it into place`);
    for (const file of mapFiles) {
        for (const real of [file, langFileFor(file, primary)]) console.log(`#   ${real} -> ${claudeAliasOf(real)}`);
    }
}

function printVocabulary(root) {
    const { features } = loadFeatures(root);
    const { systems } = loadSystems(root);
    if (features) console.log(`# features (read-only, tag only with these): ${[...features.keys()].join(' ')}`);
    if (systems) console.log(`# systems (reuse one of these for every ext: target; a new outside system only via systems.mjs add): ${[...systems].join(' ')}`);
}

const [root = '.', command = 'chunks', arg, arg2] = process.argv.slice(2);
if (command === 'retag') process.exit(runRetag(root, arg, arg2));
const chunks = buildChunks(enumerate(root));
const done = doneSet(root, loadRoles());
const isPending = (chunk) => chunk.files.some((f) => !done.has(f.path));

if (command === 'chunks') {
    for (const chunk of chunks) console.log(describe(chunk, done));
} else if (command === 'pending') {
    const pending = chunks.filter(isPending);
    for (const chunk of pending) console.log(describe(chunk, done));
    if (!pending.length) console.log('ALL DONE');
} else if (command === 'chunk') {
    const chunk = chunks.find((c) => c.id === Number(arg));
    if (!chunk) {
        console.error(`no chunk ${arg}; ${chunks.length} chunks`);
        process.exit(2);
    }
    const { platforms } = loadPlatforms(root);
    console.log(`# chunk ${chunk.id} of ${chunks.length}: path hash bytes status mapfile${platforms ? ' platform' : ''}`);
    for (const file of chunk.files) {
        const status = done.has(file.path) ? 'done' : 'todo';
        console.log(`${encodePath(file.path)} ${hashFile(root, file.path)} ${file.size} ${status} ${mapFileFor(file.path)}${platforms ? ` ${resolvePlatform(platforms, file.path)}` : ''}`);
    }
    printClaudeAliases(root, chunk);
    printVocabulary(root);
} else if (command === 'status' && arg === '--json') {
    console.log(JSON.stringify(progressOf(root, chunks, done)));
} else if (command === 'status') {
    const total = chunks.reduce((sum, c) => sum + c.files.length, 0);
    const doneChunks = chunks.filter((c) => !isPending(c)).length;
    console.log(`files ${done.size}/${total} mapped, chunks ${doneChunks}/${chunks.length} done`);
} else {
    console.error(USAGE);
    process.exit(2);
}
