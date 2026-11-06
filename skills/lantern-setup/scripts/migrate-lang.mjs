#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { FEATURES_FILE, listMapFiles, loadFeatures, parseMapFile, readLang } from './lib.mjs';
import { LANG_CODE, featuresLangFile, langFileFor, parseLangFile, recordTexts } from './texts.mjs';

const args = process.argv.slice(2);
const langAt = args.indexOf('--lang');
const code = langAt === -1 ? null : args.splice(langAt, 2)[1];
const root = args[0];
if (!root || (code !== null && !LANG_CODE.test(code ?? ''))) {
    console.error('usage: migrate-lang.mjs <project-root> [--lang <code>]');
    process.exit(2);
}
const lang = readLang(root);
if (code !== null && code !== lang) {
    console.error(`--lang ${code} is not the primary language (${lang}); inline text is primary text, so migrating it elsewhere would leave every record without a purpose. Set LANTERN_LANG=${code} first if the map is written in ${code}.`);
    process.exit(2);
}
const abs = (rel) => path.join(root, rel);

function stripText(text) {
    const cut = (line) => {
        const bar = line.indexOf(' | ');
        return bar === -1 ? line : line.slice(0, bar).replace(/[ \t]+$/, '');
    };
    return text.split('\n').flatMap((raw, i) => {
        const cr = raw.endsWith('\r') ? '\r' : '';
        const line = cr ? raw.slice(0, -1) : raw;
        if (i === 0 || !line.trim()) return [raw];
        if (/^#gotcha([ \t]|$)/.test(line)) return [];
        if (line.startsWith('#') && !/^#see-also([ \t]|$)/.test(line)) return [raw];
        return [cut(line) + cr];
    }).join('\n');
}

const writes = [];
const problems = [];

function readExisting(rel) {
    if (!fs.existsSync(abs(rel))) return { text: {} };
    const parsed = parseLangFile(fs.readFileSync(abs(rel), 'utf8'), rel);
    if (parsed.error) problems.push(parsed.error);
    return parsed;
}

function langJson(existing, texts) {
    const out = {};
    out.text = { ...texts, ...existing.text };
    return `${JSON.stringify(out, null, 1)}\n`;
}
let moved = 0;

for (const file of listMapFiles(root)) {
    const text = fs.readFileSync(abs(file), 'utf8');
    const parsed = parseMapFile(text, file);
    if (parsed.errors.length) {
        problems.push(...parsed.errors);
        continue;
    }
    const texts = {};
    for (const record of parsed.records) {
        for (const t of recordTexts(record)) {
            if (!t.inline) continue;
            if (Object.hasOwn(texts, t.key) && texts[t.key] !== t.inline) problems.push(`${t.where}: "${t.key}" has two different texts; drop the duplicate relation first`);
            texts[t.key] = t.inline;
        }
    }
    const count = Object.keys(texts).length;
    if (!count) continue;
    const langFile = langFileFor(file, lang);
    writes.push([file, stripText(text)], [langFile, langJson(readExisting(langFile), texts)]);
    moved += count;
}

const { features, errors: featureErrors } = loadFeatures(root);
problems.push(...featureErrors);
const featureTexts = Object.fromEntries([...(features ?? [])].filter(([, desc]) => desc));
if (Object.keys(featureTexts).length) {
    const text = fs.readFileSync(abs(FEATURES_FILE), 'utf8');
    const stripped = text.split('\n').map((line) => (line.startsWith('#') ? line : line.replace(/[ \t]*\|.*?(\r?)$/, '$1'))).join('\n');
    const langFile = featuresLangFile(lang);
    writes.push([FEATURES_FILE, stripped], [langFile, langJson(readExisting(langFile), featureTexts)]);
    moved += Object.keys(featureTexts).length;
}

if (problems.length) {
    console.error(`nothing written; ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
}
for (const [rel, content] of writes) {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), content);
}
console.log(moved ? `moved ${moved} text(s) into .lantern/lang/${lang}/ (${writes.length / 2} file(s))` : 'nothing to migrate: no inline text');
