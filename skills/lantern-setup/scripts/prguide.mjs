import { decodePath, encodePath, hasControlCharacter } from './lib.mjs';

export const GUIDE_TAGS = ['guide', 'risk', 'gstep', 'gwhy', 'ghunk', 'gpseudo'];
export const GUIDE_RISK_LEVELS = ['low', 'medium', 'high'];
export const GUIDE_STEP_MODES = ['careful', 'skim'];
export const GUIDE_MAX_STEPS = 8;
export const GUIDE_MAX_HUNKS_PER_STEP = 60;
export const GUIDE_MAX_PSEUDO_LINES = 8;
export const GUIDE_SUMMARY_MAX = 160;
export const GUIDE_RISK_WHY_MAX = 160;
export const GUIDE_TITLE_MAX = 60;
export const GUIDE_WHY_MAX = 240;
export const GUIDE_WHY_MAX_SENTENCES = 2;
export const GUIDE_PSEUDO_MAX = 100;

const SIDE_SIGN = { old: '-', new: '+' };
const RANGE = /^([+-])(\d+)(?:-(\d+))?$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fold = (text) => text.replace(/\s+/g, ' ').trim();

function lineProblem(text, what, max) {
    if (text === '') return `${what} is empty`;
    if (hasControlCharacter(text)) return `${what} contains a control character (one line, no tabs)`;
    if ([...text].length > max) return `${what} is ${[...text].length} characters, the cap is ${max}`;
    return null;
}

export function sentenceCount(text) {
    return text.split(/(?<=[.!?])\s+/).filter((part) => part !== '').length;
}

function whyProblem(text) {
    const problem = lineProblem(text, 'the why', GUIDE_WHY_MAX);
    if (problem) return problem;
    const sentences = sentenceCount(text);
    return sentences > GUIDE_WHY_MAX_SENTENCES ? `the why is ${sentences} sentences, the cap is ${GUIDE_WHY_MAX_SENTENCES}` : null;
}

function refProblem(ref) {
    if (ref.side === undefined) return null;
    if (!Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 1) return 'a line range is whole numbers from line 1';
    if (ref.end < ref.start) return `the range ${ref.start}-${ref.end} ends before it starts`;
    return null;
}

export function hunkRefLine(ref) {
    const path = encodePath(ref.path);
    if (ref.side === undefined) return path;
    return `${path} ${SIDE_SIGN[ref.side]}${ref.start}${ref.end === ref.start ? '' : `-${ref.end}`}`;
}

export function parseHunkRef(raw, listed = null) {
    const parts = raw.split(/\s+/).filter((part) => part !== '');
    if (parts.length === 0) return { problem: 'must be "#ghunk <path>" or "#ghunk <path> +<from>-<to>" (-<from>-<to> for old lines)' };
    if (parts.length > 2) return { problem: 'takes a path and at most one range (encode a space in the path as %20)' };
    const path = decodePath(parts[0]);
    if (listed && !listed.has(path)) return { problem: `names ${parts[0]}, which is not a file line of this record` };
    if (parts.length === 1) return { ref: { path } };
    const match = RANGE.exec(parts[1]);
    if (!match) return { problem: `range "${parts[1]}" must be +<from>-<to> (new lines) or -<from>-<to> (old lines), "-<n>" for one line` };
    const start = Number(match[2]);
    const end = match[3] === undefined ? start : Number(match[3]);
    const ref = { path, side: match[1] === '+' ? 'new' : 'old', start, end };
    const problem = refProblem(ref);
    return problem ? { problem } : { ref };
}

function sameRef(a, b) {
    return a.path === b.path && a.side === b.side && a.start === b.start && a.end === b.end;
}

export function parseGuideLines(lines, listed = null) {
    const errors = [];
    if (lines.length === 0) return { guide: null, errors };
    let summary = null;
    let risk = null;
    const steps = [];
    let step = null;
    const finishStep = () => {
        if (!step) return;
        if (step.why === null) errors.push(`${step.where}: step "${step.title}" has no #gwhy line`);
        if (step.hunks.length === 0) errors.push(`${step.where}: step "${step.title}" has no #ghunk line`);
    };
    for (const { tag, raw, where } of lines) {
        if (tag === 'guide') {
            const problem = lineProblem(raw, 'the summary', GUIDE_SUMMARY_MAX);
            if (summary !== null) errors.push(`${where}: #guide appears more than once`);
            else if (problem) errors.push(`${where}: #guide ${problem}`);
            else summary = raw;
            continue;
        }
        if (tag === 'risk') {
            const cut = raw.search(/\s/);
            const level = cut === -1 ? raw : raw.slice(0, cut);
            const why = cut === -1 ? '' : raw.slice(cut).trim();
            const problem = !GUIDE_RISK_LEVELS.includes(level) ? `level must be one of ${GUIDE_RISK_LEVELS.join(', ')}, got "${level}"` : lineProblem(why, 'the risk why', GUIDE_RISK_WHY_MAX);
            if (risk !== null) errors.push(`${where}: #risk appears more than once`);
            else if (problem) errors.push(`${where}: #risk ${problem}`);
            else risk = { level, why };
            continue;
        }
        if (tag === 'gstep') {
            finishStep();
            step = null;
            const cut = raw.search(/\s/);
            const mode = cut === -1 ? raw : raw.slice(0, cut);
            const title = cut === -1 ? '' : raw.slice(cut).trim();
            const problem = !GUIDE_STEP_MODES.includes(mode) ? `must be "#gstep <${GUIDE_STEP_MODES.join('|')}> <title>", got mode "${mode}"` : lineProblem(title, 'the title', GUIDE_TITLE_MAX);
            if (problem) {
                errors.push(`${where}: #gstep ${problem}`);
                continue;
            }
            if (steps.length >= GUIDE_MAX_STEPS) errors.push(`${where}: more than ${GUIDE_MAX_STEPS} steps`);
            step = { title, careful: mode === 'careful', why: null, hunks: [], pseudo: [], where };
            steps.push(step);
            continue;
        }
        if (!step) {
            errors.push(`${where}: #${tag} before any #gstep`);
            continue;
        }
        if (tag === 'gwhy') {
            const problem = whyProblem(raw);
            if (step.why !== null) errors.push(`${where}: #gwhy appears more than once in step "${step.title}"`);
            else if (problem) errors.push(`${where}: #gwhy ${problem}`);
            else step.why = raw;
        } else if (tag === 'ghunk') {
            const parsed = parseHunkRef(raw, listed);
            if (parsed.problem) errors.push(`${where}: #ghunk ${parsed.problem}`);
            else if (step.hunks.some((ref) => sameRef(ref, parsed.ref))) errors.push(`${where}: #ghunk repeats a hunk of step "${step.title}"`);
            else if (step.hunks.length >= GUIDE_MAX_HUNKS_PER_STEP) errors.push(`${where}: more than ${GUIDE_MAX_HUNKS_PER_STEP} #ghunk lines in step "${step.title}"`);
            else step.hunks.push(parsed.ref);
        } else {
            const problem = lineProblem(raw, 'the pseudocode line', GUIDE_PSEUDO_MAX);
            if (!step.careful) errors.push(`${where}: #gpseudo only on a careful step ("${step.title}" is skim)`);
            else if (problem) errors.push(`${where}: #gpseudo ${problem}`);
            else if (step.pseudo.length >= GUIDE_MAX_PSEUDO_LINES) errors.push(`${where}: more than ${GUIDE_MAX_PSEUDO_LINES} #gpseudo lines in step "${step.title}"`);
            else step.pseudo.push(raw);
        }
    }
    finishStep();
    const first = lines[0].where;
    if (summary === null) errors.push(`${first}: a guide needs a #guide summary line`);
    if (risk === null) errors.push(`${first}: a guide needs a #risk line`);
    if (steps.length === 0) errors.push(`${first}: a guide needs at least one #gstep`);
    if (errors.length) return { guide: null, errors };
    return {
        guide: {
            summary,
            risk,
            steps: steps.map(({ title, why, careful, hunks, pseudo }) => ({ title, why, careful, hunks, ...(pseudo.length ? { pseudo } : {}) })),
        },
        errors,
    };
}

export function guideRecordLines(guide) {
    return [
        `#guide ${guide.summary}`,
        `#risk ${guide.risk.level} ${guide.risk.why}`,
        ...guide.steps.flatMap((step) => [
            `#gstep ${step.careful ? 'careful' : 'skim'} ${step.title}`,
            `#gwhy ${step.why}`,
            ...step.hunks.map((ref) => `#ghunk ${hunkRefLine(ref)}`),
            ...(step.pseudo ?? []).map((line) => `#gpseudo ${line}`),
        ]),
    ];
}

function refFromJson(value) {
    if (typeof value === 'string') return value.trim() === '' ? { problem: 'a hunk path is empty' } : { ref: { path: value.trim() } };
    if (!isObject(value) || typeof value.path !== 'string' || value.path.trim() === '') return { problem: 'a hunk is a path string, or {"path", "side": "old"|"new", "start", "end"}' };
    const path = value.path.trim();
    if (value.side === undefined) return { ref: { path } };
    if (value.side !== 'old' && value.side !== 'new') return { problem: `a hunk's side is "old" or "new", got ${JSON.stringify(value.side)}` };
    const ref = { path, side: value.side, start: value.start, end: value.end ?? value.start };
    const problem = refProblem(ref);
    return problem ? { problem } : { ref };
}

export function guideFromJson(value, listed = null) {
    if (!isObject(value)) return { guide: null, errors: ['a guide is a JSON object {"summary", "risk": {"level", "why"}, "steps": [...]}'] };
    const errors = [];
    const lines = [];
    const where = 'guide';
    if (typeof value.summary !== 'string') errors.push('the guide needs a string "summary"');
    else lines.push({ tag: 'guide', raw: fold(value.summary), where });
    if (!isObject(value.risk) || typeof value.risk.level !== 'string' || typeof value.risk.why !== 'string') errors.push('the guide needs "risk": {"level": "low|medium|high", "why": "<one line>"}');
    else lines.push({ tag: 'risk', raw: `${value.risk.level} ${fold(value.risk.why)}`.trim(), where });
    if (!Array.isArray(value.steps)) errors.push('the guide needs a "steps" array');
    else
        value.steps.forEach((step, index) => {
            const at = `step ${index + 1}`;
            if (!isObject(step) || typeof step.title !== 'string' || typeof step.why !== 'string' || typeof step.careful !== 'boolean' || !Array.isArray(step.hunks)) {
                errors.push(`${at}: must be {"title": string, "why": string, "careful": boolean, "hunks": [...], "pseudo": [...]}`);
                return;
            }
            if (step.pseudo !== undefined && (!Array.isArray(step.pseudo) || step.pseudo.some((line) => typeof line !== 'string'))) {
                errors.push(`${at}: "pseudo" is an array of strings`);
                return;
            }
            const refs = step.hunks.map(refFromJson);
            const bad = refs.find((made) => made.problem);
            if (bad) {
                errors.push(`${at}: ${bad.problem}`);
                return;
            }
            lines.push({ tag: 'gstep', raw: `${step.careful ? 'careful' : 'skim'} ${fold(step.title)}`, where: at });
            lines.push({ tag: 'gwhy', raw: fold(step.why), where: at });
            for (const { ref } of refs) lines.push({ tag: 'ghunk', raw: hunkRefLine(ref), where: at });
            for (const line of step.pseudo ?? []) lines.push({ tag: 'gpseudo', raw: fold(line), where: at });
        });
    if (errors.length) return { guide: null, errors };
    return parseGuideLines(lines, listed);
}

function overlaps(start, count, ref) {
    return count > 0 && ref.start <= start + count - 1 && ref.end >= start;
}

export function refCoversHunk(ref, hunk) {
    if (ref.path !== hunk.path) return false;
    if (ref.side === undefined) return true;
    return ref.side === 'old' ? overlaps(hunk.oldStart, hunk.oldCount, ref) : overlaps(hunk.newStart, hunk.newCount, ref);
}

export function guideCoverage(hunks, guide) {
    const missed = [];
    const doubled = [];
    for (const hunk of hunks) {
        const owners = guide.steps.flatMap((step, index) => (step.hunks.some((ref) => refCoversHunk(ref, hunk)) ? [index] : []));
        if (owners.length === 0) missed.push(hunk);
        else if (owners.length > 1) doubled.push({ hunk, steps: owners });
    }
    const unknown = guide.steps.flatMap((step, index) => step.hunks.filter((ref) => !hunks.some((hunk) => refCoversHunk(ref, hunk))).map((ref) => ({ step: index, ref })));
    return { missed, doubled, unknown, ok: missed.length === 0 && doubled.length === 0 && unknown.length === 0 };
}
