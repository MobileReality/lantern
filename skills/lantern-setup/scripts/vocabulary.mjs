import fs from 'node:fs';
import path from 'node:path';
import { listLangs, parseLangFile, systemsLangFile } from './texts.mjs';

export const SYSTEMS_FILE = '.lantern/systems';
export const SYSTEM_ID = /^[a-z][a-z0-9-]*$/;
export const MAX_SYSTEM_TEXT = 80;
export const TAG = '[vocabulary]';
export const SYSTEMS_HEADER = '# outside systems the project talks to, one id per line; written by systems.mjs, never by hand';

export const CHANNEL_WORDS = new Set(['web', 'mobile', 'api', 'backend', 'frontend', 'desktop', 'bot', 'bots']);
export const GENERIC_WORDS = new Set(['layer', 'tier', 'misc', 'other', 'common', 'core', 'utils', 'util', 'shared', 'infra', 'module', 'modules', 'service', 'services', 'general', 'base', 'stuff']);

const NOISE_TOKENS = new Set(['api', 'sdk', 'client', 'service', 'rest', 'http']);
const REGISTRY_PREFIX = /^(npm|pypi|pip|gem|crates?|cargo|maven|nuget|pub|composer|packagist|go):/i;
const FILE_SUFFIX = /\.(m?js|cjs|ts|py|rb)$/i;

export function nameTokens(id) {
    return id.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function singular(token) {
    return token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}

function coreTokens(id) {
    const all = nameTokens(id).map(singular);
    const kept = all.filter((token) => !NOISE_TOKENS.has(token));
    return kept.length ? kept : all;
}

export function normalisedKey(id) {
    return coreTokens(id).join('-');
}

export function namesId(featureId, otherId) {
    const feature = nameTokens(featureId);
    const other = nameTokens(otherId);
    if (!other.length) return false;
    for (let start = 0; start + other.length <= feature.length; start += 1) {
        if (other.every((token, offset) => feature[start + offset] === token)) return true;
    }
    return false;
}

export function looksLikePackage(id) {
    return id.includes('@') || id.includes('/') || REGISTRY_PREFIX.test(id) || FILE_SUFFIX.test(id);
}

function preferred(a, b, counts) {
    const byUse = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    if (byUse) return byUse;
    return a.length - b.length || (a < b ? -1 : 1);
}

export function nearDuplicateGroups(ids, counts = new Map()) {
    const byKey = new Map();
    for (const id of new Set(ids)) {
        const key = normalisedKey(id);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(id);
    }
    return [...byKey.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([key, group]) => {
            const sorted = group.sort((a, b) => preferred(a, b, counts));
            return { key, keep: sorted[0], ids: sorted };
        })
        .sort((a, b) => (a.key < b.key ? -1 : 1));
}

function isTokenSubset(small, large) {
    return small.length < large.length && small.every((token) => large.includes(token));
}

export function vendorProductPairs(ids) {
    const unique = [...new Set(ids)];
    const pairs = [];
    for (const short of unique) {
        for (const long of unique) {
            if (normalisedKey(short) !== normalisedKey(long) && isTokenSubset(coreTokens(short), coreTokens(long))) pairs.push({ short, long });
        }
    }
    return pairs;
}

export function nearestListed(id, listed) {
    const key = normalisedKey(id);
    const same = listed.find((other) => other !== id && normalisedKey(other) === key);
    if (same) return same;
    const pair = vendorProductPairs([id, ...listed]).find((p) => p.short === id || p.long === id);
    return pair ? (pair.short === id ? pair.long : pair.short) : null;
}

export function loadSystems(root) {
    const file = path.join(root, SYSTEMS_FILE);
    if (!fs.existsSync(file)) return { systems: null, lines: new Map(), errors: [] };
    const systems = new Set();
    const lines = new Map();
    const errors = [];
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
        const where = `${SYSTEMS_FILE}:${index + 1}`;
        const id = line.trim();
        if (!id || id.startsWith('#')) return;
        if (!SYSTEM_ID.test(id)) errors.push(`${where}: system id "${id}" must be one lowercase kebab-case id per line`);
        else if (systems.has(id)) errors.push(`${where}: duplicate system "${id}"`);
        else {
            systems.add(id);
            lines.set(id, index + 1);
        }
    });
    return { systems, lines, errors };
}

function leadingComments(root) {
    const file = path.join(root, SYSTEMS_FILE);
    if (!fs.existsSync(file)) return [SYSTEMS_HEADER];
    const comments = [];
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (line.trim() && !line.startsWith('#')) break;
        if (line.trim()) comments.push(line);
    }
    return comments.length ? comments : [SYSTEMS_HEADER];
}

export function renderSystems(root, ids) {
    const sorted = [...new Set(ids)].sort();
    return `${[...leadingComments(root), ...sorted].join('\n')}\n`;
}

export function saveSystems(root, ids) {
    const file = path.join(root, SYSTEMS_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderSystems(root, ids));
}

export function loadSystemTexts(root, code) {
    const file = path.join(root, systemsLangFile(code));
    if (!fs.existsSync(file)) return { file: systemsLangFile(code), text: {}, error: null, exists: false };
    return { file: systemsLangFile(code), exists: true, ...parseLangFile(fs.readFileSync(file, 'utf8'), systemsLangFile(code)) };
}

export function saveSystemTexts(root, code, table) {
    const file = path.join(root, systemsLangFile(code));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ text: table }, null, 1)}\n`);
}

export function collectExternals(records) {
    const used = new Map();
    for (const record of records) {
        for (const relation of record.relations) {
            if (relation.external === null || relation.external === '') continue;
            if (!used.has(relation.external)) used.set(relation.external, []);
            used.get(relation.external).push({ where: relation.where, path: record.path });
        }
    }
    return used;
}

export function useCounts(used) {
    return new Map([...used].map(([id, uses]) => [id, new Set(uses.map((use) => use.path)).size]));
}

function moreSuffix(uses) {
    return uses.length > 1 ? ` (+${uses.length - 1} more use(s), next at ${uses[1].where})` : '';
}

function featureFindings({ features, featureLines, platforms, systemIds }) {
    const findings = [];
    for (const id of features?.keys() ?? []) {
        const where = `.lantern/features:${featureLines.get(id) ?? 1}`;
        for (const platform of platforms ?? []) {
            if (namesId(id, platform.id)) {
                findings.push({ kind: 'feature-platform', id, where, message: `${where}: ${TAG} feature "${id}" is named after platform "${platform.id}"; a feature is a capability, so code realising it on every platform shares one tag (retag.mjs retag-feature ${id} <capability>)` });
                break;
            }
        }
        const system = systemIds.find((sys) => normalisedKey(sys) === normalisedKey(id));
        if (system) findings.push({ kind: 'feature-system', id, where, message: `${where}: ${TAG} feature "${id}" is also an outside system (ext:${system}); name the capability, not the vendor (retag.mjs retag-feature ${id} <capability>)` });
    }
    return findings;
}

function unlistedFindings({ used, systems }) {
    if (!systems) return [];
    const listed = [...systems];
    return [...used].filter(([id]) => !systems.has(id)).map(([id, uses]) => {
        const near = nearestListed(id, listed);
        const hint = near ? ` (did you mean ext:${near}?)` : '';
        return { kind: 'ext-unlisted', id, where: uses[0].where, message: `${uses[0].where}: ${TAG} ext:${id} is not in ${SYSTEMS_FILE}${hint}; reuse a listed id, or run systems.mjs add ${id} --text "<short>" if it is a genuinely new outside system${moreSuffix(uses)}` };
    });
}

function duplicateFindings({ used, systemIds, systemLines }) {
    const counts = useCounts(used);
    return nearDuplicateGroups([...used.keys(), ...systemIds], counts).map((group) => {
        const first = group.ids.map((id) => used.get(id)?.[0]?.where ?? (systemLines.has(id) ? `${SYSTEMS_FILE}:${systemLines.get(id)}` : null)).find(Boolean) ?? SYSTEMS_FILE;
        const others = group.ids.filter((id) => id !== group.keep);
        return { kind: 'ext-near-duplicate', id: group.keep, where: first, message: `${first}: ${TAG} ext ids ${group.ids.join(', ')} look like one system; keep "${group.keep}" (retag.mjs merge-system ${others[0]} ${group.keep})` };
    });
}

function libraryFindings({ used }) {
    return [...used].filter(([id, uses]) => new Set(uses.map((u) => u.path)).size === 1 && looksLikePackage(id)).map(([id, uses]) => ({
        kind: 'ext-library', id, where: uses[0].where, message: `${uses[0].where}: ${TAG} ext:${id} appears once and looks like a package name, probably a library; an ext target is a system the project talks to (retag.mjs drop-system ${id}, or rename-system ${id} <system> if it is a hosted service)`,
    }));
}

export function vocabularyFindings(input) {
    const used = collectExternals(input.records);
    const systemIds = [...(input.systems ?? [])];
    const allSystemIds = [...new Set([...used.keys(), ...systemIds])];
    const ctx = { ...input, used, systemIds: allSystemIds, systemLines: input.systemLines ?? new Map(), featureLines: input.featureLines ?? new Map() };
    return [...featureFindings(ctx), ...unlistedFindings(ctx), ...duplicateFindings(ctx), ...libraryFindings(ctx)];
}

function orphanTextWarnings(root, systems) {
    const warnings = [];
    for (const code of listLangs(root)) {
        const parsed = loadSystemTexts(root, code);
        if (!parsed.exists) continue;
        if (parsed.error) warnings.push(parsed.error);
        else if (!systems) warnings.push(`orphan file: ${parsed.file} (no ${SYSTEMS_FILE})`);
        else for (const key of Object.keys(parsed.text)) if (!systems.has(key)) warnings.push(`orphan key: ${parsed.file}: "${key}"`);
    }
    return warnings;
}

export function checkVocabulary(root, input, strict) {
    const { systems, lines, errors: listErrors } = loadSystems(root);
    const findings = vocabularyFindings({ ...input, systems, systemLines: lines });
    const messages = findings.map((f) => f.message);
    const summary = [findings.length ? `vocabulary: ${findings.length} finding(s)${strict ? ' (errors, --strict)' : ' (warnings)'}` : 'vocabulary: OK'];
    return {
        findings,
        errors: [...listErrors, ...(strict ? messages : [])],
        warnings: [...(strict ? [] : messages), ...orphanTextWarnings(root, systems)],
        summary,
    };
}
