#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirOf, loadFeatures, loadMap, readLang } from '../scripts/lib.mjs';
import { SHARED, loadPlatforms, platformLabel, platformTexts, resolvePlatform } from '../scripts/platforms.mjs';
import { SCHEMA, loadSectionTexts, loadSections, sectionSlots, sectionText } from '../scripts/sections.mjs';
import { langFileOf, loadLangs, textOf, textSlots } from '../scripts/texts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function flag(name) {
    const i = args.indexOf(name);
    if (i === -1) return null;
    const [, value] = args.splice(i, 2);
    return value ?? null;
}

const out = flag('--out') ?? '.ai/tmp/lantern.html';
const titleFlag = flag('--title');
const langFlag = flag('--lang');
const root = args[0] ?? '.';

const locales = JSON.parse(fs.readFileSync(path.join(here, 'locales.json'), 'utf8'));
let lang = langFlag ?? readLang(root);
if (!Object.hasOwn(locales, lang)) {
    const available = Object.keys(locales).join(', ');
    if (langFlag) {
        console.error(`unknown language "${lang}"; available: ${available}`);
        process.exit(1);
    }
    console.error(`LANTERN_LANG "${lang}" has no viewer locale (${available}); rendering en`);
    lang = 'en';
}

const { records, errors } = loadMap(root);
if (errors.length) {
    console.error(`${errors.length} problem(s) in the map:\n  ${errors.join('\n  ')}`);
    process.exit(1);
}
const { features, errors: featureErrors } = loadFeatures(root);
if (featureErrors.length) {
    console.error(`${featureErrors.length} problem(s) in .lantern/features:\n  ${featureErrors.join('\n  ')}`);
    process.exit(1);
}
if (records.length === 0) {
    console.error(`no records under ${path.join(root, '.lantern', 'map')}`);
    process.exit(1);
}

const { platforms, errors: platformErrors } = loadPlatforms(root);
if (platformErrors.length) {
    console.error(`${platformErrors.length} problem(s) in .lantern/platforms:\n  ${platformErrors.join('\n  ')}`);
    process.exit(1);
}
const tabbed = platforms !== null && platforms.length >= 2;

const primary = readLang(root);
const langs = loadLangs(root);
const codes = [...new Set([primary, ...langs.keys()])].sort();
const texts = Object.fromEntries(codes.map((c) => [c, { r: {}, f: {} }]));
for (const slot of textSlots(records, features, langs, primary)) {
    if (!slot.primary) continue;
    const kind = slot.mapFile ? 'r' : 'f';
    for (const code of codes) {
        const value = code === primary ? slot.primary : textOf(langs, code, langFileOf(slot, code), slot.key);
        if (value) texts[code][kind][slot.projectKey] = value;
    }
}
const platTexts = tabbed ? platformTexts(root) : null;
if (tabbed) {
    for (const code of codes) {
        texts[code].p = {};
        for (const platform of platforms) {
            const value = platformLabel(platTexts.get(code), platform.id);
            if (value) texts[code].p[platform.id] = value;
        }
    }
}

const nodes = records.map((r) => ({
    path: r.path,
    dir: dirOf(r.path) || '.',
    marker: r.marker,
    owner: r.owner,
    role: r.role,
    hash: r.hash,
    feature: r.feature,
    seeAlso: r.seeAlso ?? [],
    ...(tabbed && { p: resolvePlatform(platforms, r.path) }),
}));

const relations = records.flatMap((r) =>
    r.relations.map((rel) => ({
        from: r.path,
        arrow: rel.arrow,
        to: rel.path,
        ext: rel.external,
        symbol: rel.symbol,
        key: `${r.path} ${rel.arrow} ${rel.token}`,
    })),
);

const SECTION_LOCALE = 'sec.';
const usesInfra = nodes.some((n) => n.role === 'infra');
const localeWanted = (k) => (/^(plat\.|layer\.infra\.)/.test(k) ? tabbed : /^role\.infra\./.test(k) ? tabbed || usesInfra : true);
const pickLocales = (keep) => Object.fromEntries(Object.entries(locales).map(([code, table]) => [code, Object.fromEntries(Object.entries(table).filter(([k]) => keep(k.startsWith(SECTION_LOCALE)) && localeWanted(k)))]));

const { sections, errors: sectionErrors } = loadSections(root);
if (sectionErrors.length) {
    console.error(`${sectionErrors.length} problem(s) in .lantern/sections:\n  ${sectionErrors.join('\n  ')}`);
    process.exit(1);
}
const typeOrder = Object.keys(SCHEMA);
sections.sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || (a.id < b.id ? -1 : 1));

function sectionsData() {
    const sectionTexts = loadSectionTexts(root, sections);
    const sectionCodes = [...new Set([primary, ...sectionTexts.keys()])].sort();
    const out = Object.fromEntries(sectionCodes.map((c) => [c, {}]));
    for (const section of sections) {
        for (const slot of sectionSlots(section)) {
            if (!sectionText(sectionTexts, primary, section.id, slot.key)) continue;
            for (const code of sectionCodes) {
                const value = sectionText(sectionTexts, code, section.id, slot.key);
                if (value) {
                    out[code][section.id] ??= {};
                    out[code][section.id][slot.key] = value;
                }
            }
        }
    }
    return {
        primary,
        sections: sections.map((s) => ({
            id: s.id,
            type: s.type,
            ...(tabbed && { p: s.platform }),
            items: s.items.map((i) => ({ k: i.kind, key: i.key, a: i.args, f: i.flags, c: i.cites.map((c) => (c.symbol ? [c.path, c.symbol] : [c.path])) })),
        })),
        texts: out,
        locales: pickLocales((isSection) => isSection),
    };
}

const data = {
    project: titleFlag ?? path.basename(path.resolve(root)),
    nodes,
    relations,
    features: features ? [...features.keys()] : [],
    primary,
    texts,
    lang,
    locales: pickLocales((isSection) => !isSection),
};
if (tabbed) {
    const used = new Set(nodes.map((n) => n.p));
    data.platforms = [...platforms.map((p) => ({ id: p.id, kind: p.kind })), ...(used.has(SHARED) ? [{ id: SHARED, kind: SHARED }] : [])];
}

function gate(source, on) {
    const out = [];
    let mode = null;
    for (const line of source.split('\n')) {
        const mark = line.trim();
        if (mark === '/*@P*/') mode = 'on';
        else if (mark === '/*@else*/') mode = 'off';
        else if (mark === '/*@end*/') mode = null;
        else if (mode === null || (mode === 'on') === on) out.push(line);
    }
    return out.join('\n');
}

const json = JSON.stringify(data).replace(/</g, '\\u003c');
const template = gate(fs.readFileSync(path.join(here, 'template.html'), 'utf8'), tabbed);
let html = template
    .replace('__LANG__', () => lang.replace(/[^\w-]/g, ''))
    .replace('__TITLE__', () => locales[lang]['page.title'].replace('{project}', () => data.project.replace(/[<>&"]/g, '')))
    .replace('__DATA__', () => json);
if (sections.length) {
    const sectionsJson = JSON.stringify(sectionsData()).replace(/</g, '\\u003c');
    const fragment = gate(fs.readFileSync(path.join(here, 'sections.html'), 'utf8'), tabbed).replace('__SECTIONS__', () => sectionsJson);
    html = html.replace('</main>', () => '<section id="sx"></section></main>').replace('</body>', () => `${fragment}</body>`);
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}: ${nodes.length} files, ${relations.length} relations${sections.length ? `, ${sections.length} sections` : ''}${tabbed ? `, ${platforms.length} platforms` : ''}`);
