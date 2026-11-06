import fs from 'node:fs';
import path from 'node:path';
import { parseIgnore } from './ignore.mjs';
import { listLangs, parseLangFile, platformsLangFile } from './texts.mjs';

export const PLATFORMS_FILE = '.lantern/platforms';
export const KINDS = ['web', 'backend', 'mobile', 'desktop', 'infra', 'other'];
export const SHARED = 'shared';
const RESERVED = new Set([SHARED, 'all']);
const ID = /^[a-z][a-z0-9-]*$/;

export function parsePlatforms(text, file = PLATFORMS_FILE) {
    const platforms = [];
    const errors = [];
    const seen = new Map();
    text.split(/\r?\n/).forEach((line, index) => {
        const where = `${file}:${index + 1}`;
        if (!line.trim() || line.trimStart().startsWith('#')) return;
        const [id, kind, ...globs] = line.trim().split(/\s+/);
        if (!ID.test(id)) errors.push(`${where}: platform id "${id}" must be lowercase kebab-case`);
        else if (RESERVED.has(id)) errors.push(`${where}: "${id}" is reserved (files no rule claims are "${SHARED}" automatically)`);
        else if (seen.has(id)) errors.push(`${where}: duplicate platform id "${id}" (first at ${seen.get(id)})`);
        else seen.set(id, where);
        if (!KINDS.includes(kind)) errors.push(`${where}: unknown kind "${kind ?? ''}" for "${id}" (kinds: ${KINDS.join(', ')})`);
        if (!globs.length) errors.push(`${where}: "${id}" has no path rule; add at least one glob`);
        const rules = [];
        for (const raw of globs) {
            if (raw.startsWith('!')) {
                errors.push(`${where}: "${raw}": negated rules are not supported; list the specific platform first`);
                continue;
            }
            const [rule] = parseIgnore(raw.endsWith('/') ? `${raw}**` : raw, '');
            if (rule) rules.push({ glob: raw, regex: rule.regex, wins: 0 });
        }
        platforms.push({ id, kind, where, rules });
    });
    return { platforms, errors };
}

export function loadPlatforms(root) {
    const file = path.join(root, PLATFORMS_FILE);
    if (!fs.existsSync(file)) return { platforms: null, errors: [] };
    return parsePlatforms(fs.readFileSync(file, 'utf8'));
}

export function resolvePlatform(platforms, rel, count = false) {
    for (const platform of platforms) {
        for (const rule of platform.rules) {
            if (!rule.regex.test(rel)) continue;
            if (count) rule.wins += 1;
            return platform.id;
        }
    }
    return SHARED;
}

export function platformTexts(root) {
    return new Map(listLangs(root).map((code) => {
        const file = platformsLangFile(code);
        const abs = path.join(root, file);
        return [code, fs.existsSync(abs) ? { file, ...parseLangFile(fs.readFileSync(abs, 'utf8'), file) } : null];
    }));
}

export function platformLabel(parsed, id) {
    const table = parsed?.text;
    return table && Object.hasOwn(table, id) && table[id] !== '' ? table[id] : null;
}

export function checkPlatforms(root, mapped, enumerated, primary) {
    const result = { platforms: null, of: new Map(), errors: [], warnings: [], summary: [] };
    const { platforms, errors } = loadPlatforms(root);
    const texts = platformTexts(root);
    result.errors.push(...errors);
    if (!platforms) {
        for (const parsed of texts.values()) if (parsed) result.warnings.push(`orphan file: ${parsed.file} (no ${PLATFORMS_FILE})`);
        return result;
    }
    result.platforms = platforms;
    const files = new Set([...enumerated, ...mapped]);
    for (const rel of files) resolvePlatform(platforms, rel, true);
    const counts = new Map([...platforms.map((p) => [p.id, 0]), [SHARED, 0]]);
    for (const rel of new Set(mapped)) {
        const id = resolvePlatform(platforms, rel);
        result.of.set(rel, id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = result.of.size;
    for (const platform of platforms) {
        for (const rule of platform.rules) {
            if (!rule.wins) result.warnings.push(`${platform.where}: rule "${rule.glob}" of ${platform.id} wins no file (matches nothing, or an earlier platform claims it)`);
        }
    }

    const primaryFile = texts.get(primary);
    for (const platform of platforms) {
        if (platform.kind === 'other' && !platformLabel(primaryFile, platform.id)) {
            result.errors.push(`${platform.where}: kind "other" needs a label; write "${platform.id}" in ${platformsLangFile(primary)}`);
        }
    }
    const ids = new Set(platforms.map((p) => p.id));
    for (const [code, parsed] of texts) {
        if (!parsed) continue;
        if (parsed.error) {
            (code === primary ? result.errors : result.warnings).push(parsed.error);
            continue;
        }
        for (const key of Object.keys(parsed.text)) {
            if (!ids.has(key) || (code !== primary && !platformLabel(primaryFile, key))) result.warnings.push(`orphan key: ${parsed.file}: "${key}"`);
        }
    }
    const wanted = platforms.filter((p) => platformLabel(primaryFile, p.id));
    for (const [code, parsed] of texts) {
        if (code === primary) continue;
        const missing = wanted.filter((p) => !platformLabel(parsed, p.id));
        if (missing.length) result.warnings.push(`language ${code}: ${missing.length} of ${wanted.length} platform labels missing (${missing.map((p) => p.id).join(', ')})`);
    }

    for (const platform of platforms) {
        const n = counts.get(platform.id);
        result.summary.push(`platform ${platform.id} (${platform.kind}): ${n} file${n === 1 ? '' : 's'}`);
        if (!n) result.warnings.push(`${platform.where}: platform ${platform.id} has no mapped file`);
    }
    if (counts.get(SHARED)) result.summary.push(`platform ${SHARED}: ${counts.get(SHARED)} file${counts.get(SHARED) === 1 ? '' : 's'} (no rule claims them)`);
    result.summary.push(`platforms: ${platforms.length} declared, ${total} files`);
    return result;
}
