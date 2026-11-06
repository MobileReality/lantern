import fs from 'node:fs';
import path from 'node:path';
import { MAP_DIR, MAX_GOTCHA, encodePath, toPosix } from './lib.mjs';

export const LANG_DIR = '.lantern/lang';
export const LANG_CODE = /^[A-Za-z][\w-]*$/;
export const FEATURES_LANG_NAME = 'features.json';
export const PLATFORMS_LANG_NAME = 'platforms.json';
export const SYSTEMS_LANG_NAME = 'systems.json';
export const AREAS_LANG_NAME = 'areas.json';

export function isSectionLangFile(rel, code) {
    const prefix = `${LANG_DIR}/${code}/sections/`;
    return rel.startsWith(prefix) && !rel.slice(prefix.length).includes('/') && !rel.endsWith('.lantern.json');
}

export function langFileFor(mapFile, code) {
    return `${LANG_DIR}/${code}/${mapFile.slice(MAP_DIR.length + 1)}.json`;
}

export function platformsLangFile(code) {
    return `${LANG_DIR}/${code}/${PLATFORMS_LANG_NAME}`;
}

export function featuresLangFile(code) {
    return `${LANG_DIR}/${code}/${FEATURES_LANG_NAME}`;
}

export function systemsLangFile(code) {
    return `${LANG_DIR}/${code}/${SYSTEMS_LANG_NAME}`;
}

export function areasLangFile(code) {
    return `${LANG_DIR}/${code}/${AREAS_LANG_NAME}`;
}

export function keyName(recordPath) {
    return encodePath(recordPath.slice(recordPath.lastIndexOf('/') + 1));
}

export function recordTexts(record) {
    const n = keyName(record.path);
    const texts = [
        { key: n, kind: 'purpose', inline: record.purpose, where: record.where, required: true },
        { key: `${n} gotcha`, kind: 'gotcha', inline: record.gotcha ?? '', where: record.gotchaWhere ?? record.where },
    ];
    if (record.seeAlso) texts.push({ key: `${n} see-also`, kind: 'see-also', inline: record.seeAlsoNote, where: record.seeAlsoWhere });
    for (const rel of record.relations) texts.push({ key: `${n} ${rel.arrow} ${rel.token}`, kind: 'relation', inline: rel.label, where: rel.where });
    return texts;
}

export function listLangs(root) {
    const dir = path.join(path.resolve(root), LANG_DIR);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && LANG_CODE.test(e.name))
        .map((e) => e.name)
        .sort();
}

export function parseLangFile(text, file) {
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        return { text: {}, error: `${file}: not valid JSON (${e.message})` };
    }
    const bad = (reason) => ({ text: {}, error: `${file}: ${reason}; expected {"text": {"<key>": "<text>"}}` });
    if (!json || typeof json !== 'object' || Array.isArray(json)) return bad('not an object');
    const table = json.text ?? {};
    if (typeof table !== 'object' || Array.isArray(table)) return bad('"text" is not an object');
    for (const [k, v] of Object.entries(table)) if (typeof v !== 'string') return bad(`value of "${k}" is not a string`);
    // A "model" field from older maps is ignored: the map records no model.
    return { text: table, error: null };
}

export function loadLang(root, code) {
    const absRoot = path.resolve(root);
    const base = path.join(absRoot, LANG_DIR, code);
    const files = new Map();
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(abs);
            else if (entry.name.endsWith('.json')) {
                const rel = toPosix(path.relative(absRoot, abs));
                if (isSectionLangFile(rel, code) || rel === platformsLangFile(code) || rel === systemsLangFile(code) || rel === areasLangFile(code)) continue;
                files.set(rel, parseLangFile(fs.readFileSync(abs, 'utf8'), rel));
            }
        }
    };
    walk(base);
    return files;
}

export function loadLangs(root) {
    return new Map(listLangs(root).map((code) => [code, loadLang(root, code)]));
}

export function textOf(langs, code, langFile, key) {
    const table = langs.get(code)?.get(langFile)?.text;
    return table && Object.hasOwn(table, key) && table[key] !== '' ? table[key] : null;
}

export function primaryText(langs, primary, mapFile, text) {
    return textOf(langs, primary, langFileFor(mapFile, primary), text.key) ?? (text.inline || null);
}

export function primaryFeatureText(langs, primary, id, inline) {
    return textOf(langs, primary, featuresLangFile(primary), id) ?? (inline || null);
}

export function langFileOf(slot, code) {
    return slot.mapFile ? langFileFor(slot.mapFile, code) : featuresLangFile(code);
}

export function textSlots(records, features, langs, primary) {
    const slots = [];
    for (const record of records) {
        const name = keyName(record.path);
        for (const t of recordTexts(record)) {
            const projectKey = record.path + t.key.slice(name.length);
            slots.push({ ...t, projectKey, mapFile: record.file, primary: primaryText(langs, primary, record.file, t) });
        }
    }
    for (const [id, desc] of features ?? []) {
        slots.push({ key: id, projectKey: id, kind: 'feature', inline: desc, mapFile: null, where: `.lantern/features (${id})`, primary: primaryFeatureText(langs, primary, id, desc) });
    }
    return slots;
}

export function primaryLangFileOk(langs, primary, mapFile) {
    const parsed = langs.get(primary)?.get(langFileFor(mapFile, primary));
    if (!parsed) return true;
    return !parsed.error;
}

export function recordTextsDone(langs, primary, record) {
    if (!primaryLangFileOk(langs, primary, record.file)) return false;
    return recordTexts(record).every((t) => !t.required || primaryText(langs, primary, record.file, t));
}

function coverage(slots, langs, code) {
    const wanted = slots.filter((s) => s.primary);
    const missing = wanted.filter((s) => !textOf(langs, code, langFileOf(s, code), s.key));
    const pct = wanted.length ? ((100 * (wanted.length - missing.length)) / wanted.length).toFixed(1) : '100.0';
    return { wanted, missing, pct };
}

export function missingTexts(slots, langs, code) {
    return coverage(slots, langs, code).missing;
}

function checkPrimaryTexts(ctx) {
    const { slots, langs, primary, errors, warnings } = ctx;
    const shadowed = new Map();
    for (const slot of slots) {
        const file = langFileOf(slot, primary);
        if (!slot.primary) {
            if (slot.required) errors.push(`${slot.where}: no ${primary} text for "${slot.key}" (write it in ${file})`);
            else if (slot.kind === 'feature') warnings.push(`${slot.where}: feature has no ${primary} description (${file})`);
            continue;
        }
        if (slot.kind === 'gotcha' && slot.primary.length > MAX_GOTCHA) {
            warnings.push(`${slot.where}: gotcha is ${slot.primary.length} chars; keep it one line under ${MAX_GOTCHA}`);
        }
        if (slot.inline && textOf(langs, primary, file, slot.key)) shadowed.set(file, (shadowed.get(file) ?? 0) + 1);
    }
    for (const [file, n] of shadowed) warnings.push(`${file}: ${n} text(s) also inline in the map; the lang file wins — run migrate-lang.mjs`);
}

function checkOrphans(ctx, code, files) {
    const { slots, primary, warnings } = ctx;
    const valid = new Map();
    for (const slot of slots) {
        const file = langFileOf(slot, code);
        if (!valid.has(file)) valid.set(file, new Set());
        if (code === primary || slot.primary) valid.get(file).add(slot.key);
    }
    for (const [file, parsed] of files) {
        if (parsed.error) continue;
        const keys = valid.get(file);
        if (!keys) {
            const mapFile = file === featuresLangFile(code) ? '.lantern/features' : `${MAP_DIR}/${file.slice(`${LANG_DIR}/${code}/`.length, -'.json'.length)}`;
            warnings.push(`orphan file: ${file} (no ${mapFile} or no records in it)`);
            continue;
        }
        for (const key of Object.keys(parsed.text)) {
            if (!keys.has(key)) warnings.push(`orphan key: ${file}: "${key}"${code === primary ? '' : ` (no record or no ${primary} text for it)`}`);
        }
    }
}

function reportCoverage(ctx) {
    const { slots, langs, primary, warnings, summary } = ctx;
    summary.push(`texts ${primary} (primary): ${slots.filter((s) => s.primary).length}`);
    for (const code of langs.keys()) {
        if (code === primary) continue;
        const { wanted, missing, pct } = coverage(slots, langs, code);
        summary.push(`texts ${code}: ${wanted.length - missing.length}/${wanted.length} (${pct}%)`);
        if (missing.length) warnings.push(`language ${code}: ${missing.length} of ${wanted.length} texts missing (${pct}% translated) — lang-todo.mjs ${code} lists them`);
    }
}

export function checkTexts(root, records, features, primary) {
    const langs = loadLangs(root);
    const ctx = { langs, primary, slots: textSlots(records, features, langs, primary), errors: [], warnings: [], summary: [] };
    for (const [code, files] of langs) {
        for (const parsed of files.values()) if (parsed.error) (code === primary ? ctx.errors : ctx.warnings).push(parsed.error);
    }
    checkPrimaryTexts(ctx);
    for (const [code, files] of langs) checkOrphans(ctx, code, files);
    reportCoverage(ctx);
    return ctx;
}
