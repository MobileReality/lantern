import fs from 'node:fs';
import path from 'node:path';
import { FEATURES_FILE, PLUMBING_NOTE_NAME, listMapFiles, parseMapFile } from './lib.mjs';
import { featuresLangFile, keyName, langFileFor, listLangs, systemsLangFile } from './texts.mjs';
import { SYSTEMS_FILE, loadSystems, renderSystems } from './vocabulary.mjs';

const RELATION_HEAD = /^(\s*[<>=@]\s+)\S+/;

export class Edits {
    constructor(root) {
        this.root = root;
        this.pending = new Map();
    }

    read(rel) {
        if (this.pending.has(rel)) return this.pending.get(rel);
        const abs = path.join(this.root, rel);
        return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    }

    write(rel, text) {
        if (text !== this.read(rel)) this.pending.set(rel, text);
    }

    changedFiles() {
        return [...this.pending.keys()].sort();
    }

    commit() {
        for (const [rel, text] of this.pending) fs.writeFileSync(path.join(this.root, rel), text);
    }
}

function splitLines(text) {
    return text.split(/(?<=\n)/);
}

function lineIndexOf(where) {
    return Number(where.slice(where.lastIndexOf(':') + 1)) - 1;
}

function endingOf(line) {
    return /\r?\n$/.exec(line)?.[0] ?? '';
}

function applyLineOps(lines, { replace, remove, insertAfter }) {
    const out = [];
    lines.forEach((line, index) => {
        if (!remove.has(index)) out.push(replace.get(index) ?? line);
        if (insertAfter.has(index)) out.push(`${insertAfter.get(index)}${endingOf(line) || '\n'}`);
    });
    return out.join('');
}

function newOps() {
    return { replace: new Map(), remove: new Set(), insertAfter: new Map() };
}

function serialise(json, original) {
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const indent = /\n([ \t]+)"/.exec(original)?.[1] ?? ' ';
    return JSON.stringify(json, null, indent).replace(/\n/g, eol) + (original.endsWith('\n') ? eol : '');
}

export function rewriteTable(edits, rel, transform) {
    const original = edits.read(rel);
    if (original === null) return;
    let json;
    try {
        json = JSON.parse(original);
    } catch {
        return;
    }
    const before = json.text ?? {};
    const after = transform(before);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    edits.write(rel, serialise({ ...json, text: after }, original));
}

function remapKeys(table, keyMap) {
    const out = {};
    for (const [key, value] of Object.entries(table)) {
        const mapped = keyMap.has(key) ? keyMap.get(key) : key;
        if (mapped === null || (Object.hasOwn(out, mapped) && out[mapped] !== '')) continue;
        out[mapped] = value;
    }
    return out;
}

function moveKey(table, from, to) {
    if (!Object.hasOwn(table, from)) return table;
    if (to !== null && !Object.hasOwn(table, to)) return remapKeys(table, new Map([[from, to]]));
    return Object.fromEntries(Object.entries(table).filter(([key]) => key !== from));
}

function parsedMapFiles(edits) {
    return listMapFiles(edits.root).map((file) => {
        const text = edits.read(file);
        return { file, text, records: parseMapFile(text, file).records };
    });
}

function planRelation(relation, mapping) {
    const isMapped = relation.external !== null && mapping.has(relation.external);
    const target = isMapped ? mapping.get(relation.external) : undefined;
    if (isMapped && target === null) return { dropped: true };
    const token = isMapped ? `ext:${target}` : relation.token;
    return { isMapped, token, identity: `${relation.arrow} ${token}` };
}

function planExternals(records, mapping) {
    const ops = newOps();
    const keyMap = new Map();
    let changed = 0;
    for (const record of records) {
        const name = keyName(record.path);
        const seen = new Map();
        for (const relation of record.relations) {
            const line = lineIndexOf(relation.where);
            const oldKey = `${name} ${relation.arrow} ${relation.token}`;
            const planned = planRelation(relation, mapping);
            if (planned.dropped) {
                ops.remove.add(line);
                keyMap.set(oldKey, null);
                changed += 1;
                continue;
            }
            if (planned.isMapped) keyMap.set(oldKey, `${name} ${planned.identity}`);
            if (seen.has(planned.identity) && (planned.isMapped || seen.get(planned.identity))) {
                ops.remove.add(line);
                changed += 1;
            } else if (planned.isMapped) {
                ops.replace.set(line, planned.token);
                changed += 1;
            }
            seen.set(planned.identity, seen.get(planned.identity) || planned.isMapped);
        }
    }
    return { ops, keyMap, changed };
}

function materialiseReplacements(lines, ops) {
    for (const [index, token] of ops.replace) ops.replace.set(index, lines[index].replace(RELATION_HEAD, (_, head) => head + token));
}

export function retagExternals(edits, mapping) {
    let relations = 0;
    for (const { file, text, records } of parsedMapFiles(edits)) {
        const lines = splitLines(text);
        const { ops, keyMap, changed } = planExternals(records, mapping);
        if (!changed) continue;
        materialiseReplacements(lines, ops);
        edits.write(file, applyLineOps(lines, ops));
        relations += changed;
        for (const code of listLangs(edits.root)) rewriteTable(edits, langFileFor(file, code), (table) => remapKeys(table, keyMap));
    }
    return relations;
}

const PLUMBING_LINE = `#${PLUMBING_NOTE_NAME}`;
export const PLUMBING = Symbol('plumbing');

function planTag(record, wanted, lines, ops) {
    if (wanted === PLUMBING) {
        if (record.plumbing && record.feature === null) return false;
        if (record.feature !== null) ops.replace.set(lineIndexOf(record.featureWhere), `${PLUMBING_LINE}${endingOf(lines[lineIndexOf(record.featureWhere)])}`);
        else ops.insertAfter.set(lineIndexOf(record.where), PLUMBING_LINE);
        return true;
    }
    if (wanted === record.feature) return false;
    if (record.plumbing) ops.remove.add(lineIndexOf(record.plumbingWhere));
    if (record.feature !== null) {
        const line = lineIndexOf(record.featureWhere);
        if (wanted === null) ops.remove.add(line);
        else ops.replace.set(line, `#feature ${wanted}${endingOf(lines[line])}`);
    } else if (wanted !== null) ops.insertAfter.set(lineIndexOf(record.where), `#feature ${wanted}`);
    else if (!record.plumbing) return false;
    return true;
}

export function retagTags(edits, decide) {
    let tags = 0;
    for (const { file, text, records } of parsedMapFiles(edits)) {
        const lines = splitLines(text);
        const ops = newOps();
        for (const record of records) {
            const wanted = decide(record);
            if (wanted !== undefined && planTag(record, wanted, lines, ops)) tags += 1;
        }
        if (ops.remove.size || ops.replace.size || ops.insertAfter.size) edits.write(file, applyLineOps(lines, ops));
    }
    return tags;
}

function retagIdList(edits, file, old, replacement, alreadyListed) {
    const text = edits.read(file);
    if (text === null) return false;
    const lines = splitLines(text);
    const index = lines.findIndex((line) => line.trim().split(/\s+/)[0] === old && !line.startsWith('#'));
    if (index === -1) return false;
    const ops = newOps();
    if (replacement === null || alreadyListed) ops.remove.add(index);
    else ops.replace.set(index, lines[index].replace(old, replacement));
    edits.write(file, applyLineOps(lines, ops));
    return true;
}

export function retagFeatureDeclaration(edits, old, replacement, declared) {
    const listed = retagIdList(edits, FEATURES_FILE, old, replacement, declared.has(replacement));
    for (const code of listLangs(edits.root)) rewriteTable(edits, featuresLangFile(code), (table) => moveKey(table, old, replacement));
    return listed;
}

export function retagSystemDeclaration(edits, old, replacement) {
    const { systems } = loadSystems(edits.root);
    if (!systems) return false;
    const next = [...systems].filter((id) => id !== old);
    if (replacement !== null && systems.has(old)) next.push(replacement);
    if (systems.has(old)) edits.write(SYSTEMS_FILE, renderSystems(edits.root, next));
    for (const code of listLangs(edits.root)) rewriteTable(edits, systemsLangFile(code), (table) => moveKey(table, old, replacement));
    return systems.has(old);
}
