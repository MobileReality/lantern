import { hasControlCharacter } from './lib.mjs';

export const DESCRIBE_SECTIONS = ['what', 'before', 'after', 'verified'];
export const DESCRIBE_TEXT_MAX = 400;
export const DESCRIBE_MAX_LINES = 8;
export const DESCRIBE_TAG = 'describe';

const COMMENT = /<!--.*?(?:-->|$)/g;
const COST_MARKER = /delegate:cost/i;
const TABLE_ROW = /^\|/;

export function describeClean(text) {
    const stripped = text.replace(COMMENT, '').replace(/-->/g, '').trim();
    return COST_MARKER.test(stripped) || TABLE_ROW.test(stripped) ? '' : stripped;
}

export function describeTextProblem(text, what) {
    if (text === '') return `${what} is empty`;
    if (hasControlCharacter(text)) return `${what} contains a control character (one line, no tabs)`;
    if ([...text].length > DESCRIBE_TEXT_MAX) return `${what} is ${[...text].length} characters, the cap is ${DESCRIBE_TEXT_MAX}`;
    return null;
}

export function parseDescribeLines(lines) {
    const errors = [];
    const description = {};
    for (const { raw, where } of lines) {
        const cut = raw.search(/\s/);
        const section = cut === -1 ? raw : raw.slice(0, cut);
        const text = cut === -1 ? '' : raw.slice(cut).trim();
        if (section === '') {
            errors.push(`${where}: #describe must be "#describe <section> <text>" with section ${DESCRIBE_SECTIONS.join(', ')}`);
            continue;
        }
        if (!DESCRIBE_SECTIONS.includes(section)) {
            errors.push(`${where}: #describe unknown section "${section}" (known: ${DESCRIBE_SECTIONS.join(', ')})`);
            continue;
        }
        const problem = describeTextProblem(text, `the ${section} text`);
        if (problem) {
            errors.push(`${where}: #describe ${problem}`);
            continue;
        }
        const clean = describeClean(text);
        if (clean === '') continue;
        const kept = description[section] ?? [];
        if (kept.length >= DESCRIBE_MAX_LINES) {
            errors.push(`${where}: more than ${DESCRIBE_MAX_LINES} #describe ${section} lines`);
            continue;
        }
        description[section] = [...kept, clean];
    }
    return { description, errors };
}

export function describeRecordLines(description) {
    return DESCRIBE_SECTIONS.flatMap((section) => (description[section] ?? []).map((text) => `#${DESCRIBE_TAG} ${section} ${text}`));
}

const fold = (text) => text.replace(/\s+/g, ' ').trim();
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function describeFromJson(value) {
    if (!isObject(value)) return { description: {}, errors: [`a description is a JSON object {${DESCRIBE_SECTIONS.map((s) => `"${s}": [...]`).join(', ')}}`] };
    const errors = [];
    const lines = [];
    for (const key of Object.keys(value)) {
        if (!DESCRIBE_SECTIONS.includes(key)) errors.push(`unknown section "${key}" (known: ${DESCRIBE_SECTIONS.join(', ')})`);
    }
    for (const section of DESCRIBE_SECTIONS) {
        const entries = value[section];
        if (entries === undefined) continue;
        if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
            errors.push(`"${section}" must be an array of strings`);
            continue;
        }
        entries.forEach((entry, index) => {
            const folded = fold(entry);
            if (folded !== '' && describeClean(folded) !== folded) errors.push(`"${section}"[${index}] contains a <!-- --> marker, a delegate:cost block or a table row; write plain words`);
            else lines.push({ raw: `${section} ${folded}`, where: `"${section}"[${index}]` });
        });
    }
    if (errors.length) return { description: {}, errors };
    return parseDescribeLines(lines);
}
