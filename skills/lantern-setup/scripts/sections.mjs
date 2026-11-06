import fs from 'node:fs';
import path from 'node:path';
import { containsSymbol, decodePath } from './lib.mjs';
import { LANG_DIR, listLangs, parseLangFile } from './texts.mjs';

export const SECTIONS_DIR = '.lantern/sections';
export const SECTION_HEADER = 'lantern-section 1';
export const SECTION_EXT = '.section';
export const SECTION_ID = /^[a-z][a-z0-9-]*$/;
const TOKEN = /^[A-Za-z0-9_$][\w$.:-]*$/;
const TYPE_TOKEN = /^[^\s@]+$/;
const PLATFORM_LINE = /^#platform[ \t]+(\S+)[ \t]*$/;

const REQUIRED = 'required';
const OPTIONAL = 'optional';

export const SCHEMA = {
    rbac: {
        role: { args: ['role'], text: REQUIRED },
        res: { args: ['res'], text: REQUIRED },
        cell: {
            args: ['role', 'res', 'access'],
            key: ['role', 'res'],
            enums: { access: ['allow', 'deny', 'cond'] },
            text: (a) => (a.access === 'cond' ? REQUIRED : OPTIONAL),
            refs: { role: 'role', res: 'res' },
        },
        source: { args: ['id'], text: REQUIRED },
        guard: { args: ['id'], text: REQUIRED },
    },
    states: {
        machine: { args: ['machine'], text: REQUIRED },
        state: { args: ['machine', 'state'], flags: ['initial', 'terminal'], text: REQUIRED, refs: { machine: 'machine' } },
        tr: { args: ['machine', 'from', 'to'], text: REQUIRED, refs: { machine: 'machine' }, stateRefs: ['from', 'to'] },
    },
    db: {
        entity: {
            args: ['entity', 'kind', 'origin'],
            key: ['entity'],
            enums: { kind: ['table', 'collection', 'view', 'document', 'other'], origin: ['declared', 'inferred'] },
            text: REQUIRED,
        },
        field: {
            args: ['entity', 'field', 'type', 'origin'],
            key: ['entity', 'field'],
            enums: { origin: ['declared', 'inferred'] },
            text: OPTIONAL,
            refs: { entity: 'entity' },
        },
        rel: {
            args: ['entity', 'field', 'kind', 'target'],
            key: ['entity', 'field', 'target'],
            enums: { kind: ['ref', 'fk', 'embed'] },
            text: OPTIONAL,
            refs: { entity: 'entity', target: 'entity' },
        },
        own: { args: ['entity'], text: null, refs: { entity: 'entity' } },
    },
    facts: {
        item: { args: ['id'], text: REQUIRED, extra: [{ suffix: 'note', text: OPTIONAL }] },
    },
};

const SECTION_KEYS = { title: (type) => (type === 'facts' ? REQUIRED : OPTIONAL), intro: () => OPTIONAL };

export function sectionLangFile(id, code) {
    return `${LANG_DIR}/${code}/sections/${id}.json`;
}

export function listSectionFiles(root) {
    const dir = path.join(path.resolve(root), SECTIONS_DIR);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(SECTION_EXT))
        .map((e) => e.name)
        .sort();
}

function parseCite(token) {
    const hash = token.indexOf('#');
    const rawPath = hash === -1 ? token : token.slice(0, hash);
    return { token, path: decodePath(rawPath), symbol: hash === -1 ? null : token.slice(hash + 1) };
}

function parseItem(spec, kind, tokens, where, errors) {
    const at = tokens.indexOf('@');
    const head = at === -1 ? tokens : tokens.slice(0, at);
    const citeTokens = at === -1 ? [] : tokens.slice(at + 1);
    const flags = spec.flags ?? [];
    const positional = head.slice(0, spec.args.length);
    const extra = head.slice(spec.args.length);
    if (positional.length < spec.args.length || (extra.length && !flags.length)) {
        errors.push(`${where}: "${kind}" takes ${spec.args.map((a) => `<${a}>`).join(' ')}${flags.length ? ` [${flags.join('] [')}]` : ''} @ <path[#symbol]>...`);
        return null;
    }
    const args = {};
    spec.args.forEach((name, i) => {
        args[name] = positional[i];
    });
    for (const [name, value] of Object.entries(args)) {
        const allowed = spec.enums?.[name];
        if (allowed && !allowed.includes(value)) errors.push(`${where}: ${name} "${value}" must be one of ${allowed.join(', ')}`);
        else if (!allowed && !(name === 'type' ? TYPE_TOKEN : TOKEN).test(value)) errors.push(`${where}: ${name} "${value}" is not a valid id`);
    }
    for (const flag of extra) if (!flags.includes(flag)) errors.push(`${where}: unknown flag "${flag}" (allowed: ${flags.join(', ')})`);
    if (!citeTokens.length) errors.push(`${where}: "${kind}" cites no file; add "@ <path[#symbol]>" — an item without evidence is not written`);
    const keyArgs = (spec.key ?? spec.args).map((name) => args[name]);
    return {
        kind,
        args,
        flags: extra.filter((f) => flags.includes(f)),
        cites: citeTokens.map(parseCite),
        key: `${kind} ${keyArgs.join(' ')}`,
        where,
    };
}

export function parseSection(text, file) {
    const id = path.basename(file, SECTION_EXT);
    const errors = [];
    const items = [];
    let sawHeader = false;
    let type = null;
    let platform = null;
    if (!SECTION_ID.test(id)) errors.push(`${file}: section id "${id}" must be lowercase kebab-case`);
    text.split(/\r?\n/).forEach((line, index) => {
        const where = `${file}:${index + 1}`;
        if (!line.trim()) return;
        if (!sawHeader) {
            if (line.trim() !== SECTION_HEADER) errors.push(`${where}: first line must be "${SECTION_HEADER}"`);
            sawHeader = true;
            return;
        }
        if (line.startsWith('#')) {
            if (type === null) {
                type = line.slice(1).trim();
                if (!Object.hasOwn(SCHEMA, type)) errors.push(`${where}: unknown section type "${type}" (known: ${Object.keys(SCHEMA).join(', ')})`);
                return;
            }
            const scope = PLATFORM_LINE.exec(line);
            if (scope) {
                if (platform !== null) errors.push(`${where}: second #platform line`);
                platform = scope[1];
                return;
            }
            if (/^#platform(\s|$)/.test(line)) errors.push(`${where}: platform line must be "#platform <platform-id>"`);
            return;
        }
        if (type === null) {
            errors.push(`${where}: item before the "# <type>" line`);
            return;
        }
        const schema = SCHEMA[type];
        if (!schema) return;
        const tokens = line.trim().split(/\s+/);
        const spec = schema[tokens[0]];
        if (!spec) {
            errors.push(`${where}: "${tokens[0]}" is not an item of a ${type} section (${Object.keys(schema).join(', ')})`);
            return;
        }
        const item = parseItem(spec, tokens[0], tokens.slice(1), where, errors);
        if (item) items.push(item);
    });
    if (!sawHeader) errors.push(`${file}: empty section file`);
    else if (type === null) errors.push(`${file}: no "# <type>" line`);
    return { id, file, type, platform, items, errors };
}

export function loadSections(root) {
    const sections = [];
    const errors = [];
    for (const name of listSectionFiles(root)) {
        const file = `${SECTIONS_DIR}/${name}`;
        const parsed = parseSection(fs.readFileSync(path.join(root, file), 'utf8'), file);
        sections.push(parsed);
        errors.push(...parsed.errors);
    }
    return { sections, errors };
}

export function sectionSlots(section) {
    const schema = SCHEMA[section.type];
    if (!schema) return [];
    const slots = Object.entries(SECTION_KEYS).map(([key, need]) => ({ key, need: need(section.type), where: section.file }));
    for (const item of section.items) {
        const spec = schema[item.kind];
        const need = typeof spec.text === 'function' ? spec.text(item.args) : spec.text;
        if (need) slots.push({ key: item.key, need, where: item.where });
        for (const extra of spec.extra ?? []) slots.push({ key: `${item.key} ${extra.suffix}`, need: extra.text, where: item.where });
    }
    return slots;
}

export function loadSectionTexts(root, sections) {
    const out = new Map();
    for (const code of listLangs(root)) {
        const files = new Map();
        for (const section of sections) {
            const file = sectionLangFile(section.id, code);
            const abs = path.join(root, file);
            if (fs.existsSync(abs)) files.set(section.id, { file, ...parseLangFile(fs.readFileSync(abs, 'utf8'), file) });
        }
        out.set(code, files);
    }
    return out;
}

export function sectionText(texts, code, sectionId, key) {
    const table = texts.get(code)?.get(sectionId)?.text;
    return table && Object.hasOwn(table, key) && table[key] !== '' ? table[key] : null;
}

function checkStructure(section, byPath, readContent, errors, warnings) {
    const schema = SCHEMA[section.type];
    const declared = {};
    const statesOf = new Map();
    const keys = new Map();
    for (const item of section.items) {
        if (keys.has(item.key)) errors.push(`${item.where}: duplicate "${item.key}" (first at ${keys.get(item.key)})`);
        else keys.set(item.key, item.where);
        const spec = schema[item.kind];
        if (!spec.refs && spec.args.length === 1) {
            declared[item.kind] ??= new Set();
            declared[item.kind].add(item.args[spec.args[0]]);
        }
        if (section.type === 'db' && item.kind === 'entity') {
            declared.entity ??= new Set();
            declared.entity.add(item.args.entity);
        }
        if (item.kind === 'state') {
            if (!statesOf.has(item.args.machine)) statesOf.set(item.args.machine, new Map());
            statesOf.get(item.args.machine).set(item.args.state, item);
        }
        for (const cite of item.cites) {
            if (!byPath.has(cite.path)) {
                errors.push(`${item.where}: cites ${cite.path}, which is not a mapped file`);
                continue;
            }
            if (cite.symbol === null) continue;
            if (!cite.symbol) errors.push(`${item.where}: empty #symbol after ${cite.path}`);
            const content = readContent(cite.path);
            if (content !== null && cite.symbol && !containsSymbol(content.toString('utf8'), cite.symbol)) {
                errors.push(`${item.where}: symbol "${cite.symbol}" not found in ${cite.path}`);
            }
        }
    }
    for (const item of section.items) {
        const spec = schema[item.kind];
        for (const [arg, kind] of Object.entries(spec.refs ?? {})) {
            const value = item.args[arg];
            if (!declared[kind]?.has(value)) errors.push(`${item.where}: ${arg} "${value}" is not a declared ${kind} (declare it with a "${kind}" item)`);
        }
        for (const arg of spec.stateRefs ?? []) {
            const value = item.args[arg];
            if (!statesOf.get(item.args.machine)?.has(value)) errors.push(`${item.where}: ${arg} "${value}" is not a declared state of ${item.args.machine}`);
        }
    }
    if (section.type === 'rbac') {
        const cells = new Set(section.items.filter((i) => i.kind === 'cell').map((i) => `${i.args.role} ${i.args.res}`));
        const gaps = [];
        for (const role of declared.role ?? []) for (const res of declared.res ?? []) if (!cells.has(`${role} ${res}`)) gaps.push(`${role}×${res}`);
        if (gaps.length) warnings.push(`${section.file}: matrix has no cell for ${gaps.join(', ')}`);
    }
    if (section.type === 'states') {
        for (const machine of declared.machine ?? []) {
            const states = [...(statesOf.get(machine)?.values() ?? [])];
            if (!states.length) warnings.push(`${section.file}: machine ${machine} declares no state`);
            else if (!states.some((s) => s.flags.includes('initial'))) warnings.push(`${section.file}: machine ${machine} has no initial state`);
        }
    }
}

function checkTexts(section, texts, primary, errors, warnings) {
    const slots = sectionSlots(section);
    const valid = new Set(slots.map((s) => s.key));
    for (const [code, files] of texts) {
        const parsed = files.get(section.id);
        if (!parsed) continue;
        if (parsed.error) {
            (code === primary ? errors : warnings).push(parsed.error);
            continue;
        }
        for (const key of Object.keys(parsed.text)) {
            const hasPrimary = code === primary || sectionText(texts, primary, section.id, key);
            if (!valid.has(key) || !hasPrimary) warnings.push(`orphan key: ${parsed.file}: "${key}"`);
        }
    }
    for (const slot of slots) {
        if (slot.need === REQUIRED && !sectionText(texts, primary, section.id, slot.key)) {
            errors.push(`${slot.where}: no ${primary} text for "${slot.key}" (write it in ${sectionLangFile(section.id, primary)})`);
        }
    }
    const wanted = slots.filter((s) => sectionText(texts, primary, section.id, s.key));
    const coverage = [];
    for (const code of texts.keys()) {
        if (code === primary) continue;
        const have = wanted.filter((s) => sectionText(texts, code, section.id, s.key)).length;
        coverage.push(`${code} ${have}/${wanted.length}`);
    }
    return coverage;
}

function counts(section) {
    const order = Object.keys(SCHEMA[section.type] ?? {});
    const n = {};
    for (const item of section.items) n[item.kind] = (n[item.kind] ?? 0) + 1;
    return order.filter((k) => n[k]).map((k) => `${k} ${n[k]}`).join(', ') || 'no items';
}

export function checkSections(root, byPath, readContent, primary, platformIds = null) {
    const { sections } = loadSections(root);
    const result = { sections, errors: [], warnings: [], summary: [] };
    if (!sections.length) return result;
    const texts = loadSectionTexts(root, sections);
    for (const section of sections) {
        const errors = [...section.errors];
        const warnings = [];
        if (section.platform !== null && !platformIds?.includes(section.platform)) {
            errors.push(`${section.file}: #platform "${section.platform}" is not a declared platform (declared: ${platformIds?.join(', ') || 'none'})`);
        }
        let coverage = [];
        if (SCHEMA[section.type]) {
            checkStructure(section, byPath, readContent, errors, warnings);
            coverage = checkTexts(section, texts, primary, errors, warnings);
        }
        const status = errors.length ? `FAIL ${errors.length}` : 'OK';
        const langs = coverage.length ? `; texts ${coverage.join(', ')}` : '';
        result.summary.push(`section ${section.id} (${section.type ?? '?'}): ${counts(section)}${langs} — ${status}`);
        result.errors.push(...errors);
        result.warnings.push(...warnings);
    }
    return result;
}
