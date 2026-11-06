import fs from 'node:fs';
import path from 'node:path';
import { FEATURE_ID } from './lib.mjs';
import { areasLangFile, parseLangFile } from './texts.mjs';

export const AREAS_FILE = '.lantern/areas';
export const TAG = '[areas]';
export const INDENT = 2;
export const LIMITS = { maxAreas: 7, maxChildren: 7, minComfortAreas: 4, maxComfortAreas: 6 };

const CORE_PREFIX = 'core:';

function indentProblem(indent, id) {
    if (indent.includes('\t')) return `"${id}" is indented with a tab; indent with two spaces per level`;
    if (indent.length % INDENT) return `"${id}" is indented by ${indent.length} spaces; use 0 (area) or ${INDENT} (feature)`;
    if (indent.length > INDENT) return `"${id}" nests deeper than two levels; this version has areas and features only, so flatten it`;
    return null;
}

function idProblem(id) {
    if (id.startsWith(CORE_PREFIX)) return `"${id}" is a ${CORE_PREFIX}* block; foundation blocks stay out of ${AREAS_FILE}, delete the line`;
    if (!FEATURE_ID.test(id)) return `"${id}" must be one lowercase kebab-case id per line`;
    return null;
}

export function parseAreas(text) {
    const areas = [];
    const errors = [];
    text.split(/\r?\n/).forEach((raw, index) => {
        const id = raw.trim();
        if (!id || id.startsWith('#')) return;
        const line = index + 1;
        const indent = raw.slice(0, raw.length - raw.trimStart().length);
        const shape = indentProblem(indent, id);
        if (shape) {
            errors.push({ line, message: shape });
            return;
        }
        const bad = idProblem(id);
        if (bad) errors.push({ line, message: bad });
        if (!indent) {
            areas.push({ id, line, children: [] });
            return;
        }
        if (bad) return;
        if (!areas.length) errors.push({ line, message: `feature "${id}" is indented but no area line comes before it; put an area line above, or unindent it` });
        else areas[areas.length - 1].children.push({ id, line });
    });
    return { areas, errors };
}

export function loadAreas(root) {
    const file = path.join(root, AREAS_FILE);
    if (!fs.existsSync(file)) return { exists: false, areas: [], errors: [] };
    const { areas, errors } = parseAreas(fs.readFileSync(file, 'utf8'));
    return { exists: true, areas, errors: errors.map((e) => ({ line: e.line, message: `${AREAS_FILE}:${e.line}: ${TAG} ${e.message}` })) };
}

export function loadAreaTexts(root, code) {
    const rel = areasLangFile(code);
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) return { file: rel, text: {}, error: null, exists: false };
    return { file: rel, exists: true, ...parseLangFile(fs.readFileSync(file, 'utf8'), rel) };
}
