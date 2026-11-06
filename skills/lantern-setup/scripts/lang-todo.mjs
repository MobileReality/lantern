#!/usr/bin/env node
import { loadFeatures, loadMap, readLang } from './lib.mjs';
import { loadSectionTexts, loadSections, sectionLangFile, sectionSlots, sectionText } from './sections.mjs';
import { loadPlatforms, platformLabel, platformTexts } from './platforms.mjs';
import { LANG_CODE, langFileOf, loadLangs, missingTexts, platformsLangFile, textSlots } from './texts.mjs';

const [code, root = '.'] = process.argv.slice(2);
if (!LANG_CODE.test(code ?? '')) {
    console.error('usage: lang-todo.mjs <code> [root]');
    process.exit(2);
}
const primary = readLang(root);
if (code === primary) {
    console.error(`${code} is the primary language: its texts come from mapping, not translation — run validate.mjs`);
    process.exit(2);
}

const { records, errors } = loadMap(root);
const { features } = loadFeatures(root);
if (errors.length) {
    console.error(`${errors.length} problem(s) in the map; fix them first (validate.mjs):\n  ${errors.join('\n  ')}`);
    process.exit(1);
}
const langs = loadLangs(root);
const missing = missingTexts(textSlots(records, features, langs, primary), langs, code);

const byFile = new Map();
for (const slot of missing) {
    const file = langFileOf(slot, code);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(slot);
}
const { sections } = loadSections(root);
const sectionTexts = loadSectionTexts(root, sections);
let total = missing.length;
for (const section of sections) {
    for (const slot of sectionSlots(section)) {
        const text = sectionText(sectionTexts, primary, section.id, slot.key);
        if (!text || sectionText(sectionTexts, code, section.id, slot.key)) continue;
        const file = sectionLangFile(section.id, code);
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push({ key: slot.key, primary: text });
        total += 1;
    }
}
const { platforms } = loadPlatforms(root);
if (platforms) {
    const texts = platformTexts(root);
    for (const platform of platforms) {
        const text = platformLabel(texts.get(primary), platform.id);
        if (!text || platformLabel(texts.get(code), platform.id)) continue;
        const file = platformsLangFile(code);
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push({ key: platform.id, primary: text });
        total += 1;
    }
}
console.log(`# ${total} text(s) missing in ${code}; ${primary} text shown. Put each in the file's "text" object.`);
for (const [file, slots] of byFile) {
    console.log(file);
    for (const slot of slots) console.log(`  ${JSON.stringify(slot.key)}: ${JSON.stringify(slot.primary)}`);
}
