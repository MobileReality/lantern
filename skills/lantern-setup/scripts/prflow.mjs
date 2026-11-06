import { decodePath, encodePath, hasControlCharacter } from './lib.mjs';

export const FLOW_KINDS = ['actor', 'action', 'subject', 'interaction', 'consequence'];
export const FLOW_TEXT_MAX = 80;
export const FLOW_MAX_STORIES = 5;
export const FLOW_MAX_STEPS = 6;
export const FLOW_MAX_FILES = 6;
export const FLOW_TAGS = ['story', 'step', 'below', 'file'];
export const CONSEQUENCE_ARROW = '=>';

export function flowTextProblem(text, what) {
    if (text === '') return `${what} is empty`;
    if (hasControlCharacter(text)) return `${what} contains a control character (one line, no tabs)`;
    if ([...text].length > FLOW_TEXT_MAX) return `${what} is ${[...text].length} characters, the cap is ${FLOW_TEXT_MAX}`;
    return null;
}

function consequenceOf(text) {
    const cut = text.indexOf(` ${CONSEQUENCE_ARROW} `);
    if (cut === -1) return { problem: `a consequence is "<old text> ${CONSEQUENCE_ARROW} <new text>"` };
    const old = text.slice(0, cut).trim();
    const next = text.slice(cut + CONSEQUENCE_ARROW.length + 2).trim();
    const problem = flowTextProblem(old, 'the old text') ?? flowTextProblem(next, 'the new text');
    return problem ? { problem } : { step: { kind: 'consequence', old, new: next } };
}

function stepFromLine(raw) {
    const cut = raw.search(/\s/);
    const kind = cut === -1 ? raw : raw.slice(0, cut);
    const text = cut === -1 ? '' : raw.slice(cut).trim();
    if (kind === '') return { problem: `must be "<kind> <text>" with kind ${FLOW_KINDS.join(', ')}` };
    if (!FLOW_KINDS.includes(kind)) return { problem: `unknown kind "${kind}" (known: ${FLOW_KINDS.join(', ')})` };
    if (kind === 'consequence') return consequenceOf(text);
    const problem = flowTextProblem(text, `the ${kind} text`);
    return problem ? { problem } : { step: { kind, text } };
}

function fileRefProblem(step, raw, listed) {
    if (raw === '') return 'must be "#file <path>"';
    if (/\s/.test(raw)) return 'takes one path and nothing after it (encode a space as %20)';
    const target = decodePath(raw);
    if (!listed.has(target)) return `names ${raw}, which is not a file line of this record`;
    const files = step.files ?? [];
    if (files.includes(target)) return `names ${raw} twice on one step`;
    if (files.length >= FLOW_MAX_FILES) return `has more than ${FLOW_MAX_FILES} files on one step`;
    step.files = [...files, target];
    return null;
}

export function parseFlowLines(lines, listed = new Set()) {
    const errors = [];
    const stories = [];
    let story = null;
    let below = false;
    let last = null;
    let skipFiles = false;
    const finish = () => {
        if (story && story.steps.length === 0) errors.push(`${story.where}: story "${story.title}" has no #step line`);
    };
    for (const { tag, raw, where } of lines) {
        if (tag === 'file') {
            if (!story) errors.push(`${where}: #file before any #story`);
            else if (!last && !skipFiles) errors.push(`${where}: #file before any #step`);
            else if (last) {
                const problem = fileRefProblem(last, raw, listed);
                if (problem) errors.push(`${where}: #file ${problem}`);
            }
            continue;
        }
        last = null;
        skipFiles = false;
        if (tag === 'story') {
            finish();
            below = false;
            const problem = flowTextProblem(raw, 'the story title');
            if (problem) {
                errors.push(`${where}: #story ${problem}`);
                story = null;
                continue;
            }
            if (stories.length >= FLOW_MAX_STORIES) errors.push(`${where}: more than ${FLOW_MAX_STORIES} stories`);
            story = { title: raw, steps: [], below: [], where };
            stories.push(story);
            continue;
        }
        if (!story) {
            errors.push(`${where}: #${tag} before any #story`);
            continue;
        }
        skipFiles = true;
        if (tag === 'step' && below) {
            errors.push(`${where}: #step after #below (the row under comes last)`);
            continue;
        }
        if (tag === 'below') below = true;
        const parsed = stepFromLine(raw);
        if (parsed.problem) {
            errors.push(`${where}: #${tag} ${parsed.problem}`);
            continue;
        }
        const row = tag === 'step' ? story.steps : story.below;
        if (row.length >= FLOW_MAX_STEPS) errors.push(`${where}: more than ${FLOW_MAX_STEPS} #${tag} lines in story "${story.title}"`);
        else {
            row.push(parsed.step);
            last = parsed.step;
            skipFiles = false;
        }
    }
    finish();
    return { stories: stories.map(({ title, steps, below: under }) => ({ title, steps, below: under })), errors };
}

function linesOfStep(tag, step) {
    const text = `#${tag} ${step.kind} ${step.kind === 'consequence' ? `${step.old} ${CONSEQUENCE_ARROW} ${step.new}` : step.text}`;
    return [text, ...(step.files ?? []).map((file) => `#file ${encodePath(file)}`)];
}

export function flowRecordLines(stories) {
    return stories.flatMap((story) => [`#story ${story.title}`, ...story.steps.flatMap((s) => linesOfStep('step', s)), ...story.below.flatMap((s) => linesOfStep('below', s))]);
}

const fold = (text) => text.replace(/\s+/g, ' ').trim();
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function rawOfStep(step) {
    if (!isObject(step) || typeof step.kind !== 'string') return { problem: 'each step is an object {"kind", "text"}, or {"kind": "consequence", "old", "new"}' };
    if (step.kind !== 'consequence') return typeof step.text === 'string' ? { raw: `${step.kind} ${fold(step.text)}` } : { problem: `the ${step.kind} step needs a string "text"` };
    if (typeof step.old !== 'string' || typeof step.new !== 'string') return { problem: 'a consequence needs a string "old" and a string "new"' };
    if (step.old.includes(CONSEQUENCE_ARROW)) return { problem: `the old text of a consequence cannot contain "${CONSEQUENCE_ARROW}"` };
    return { raw: `consequence ${fold(step.old)} ${CONSEQUENCE_ARROW} ${fold(step.new)}` };
}

function filesOfStep(step) {
    if (step.files === undefined) return { raws: [] };
    if (!Array.isArray(step.files) || step.files.some((file) => typeof file !== 'string')) return { problem: 'a step\'s "files" is an array of changed-file paths' };
    return { raws: step.files.map((file) => encodePath(file.trim())) };
}

export function flowFromJson(value, listed = new Set()) {
    if (!Array.isArray(value)) return { stories: [], errors: ['a flow is a JSON array of stories {"title", "steps", "below"}'] };
    const errors = [];
    const lines = [];
    value.forEach((story, index) => {
        const where = `story ${index + 1}`;
        if (!isObject(story) || typeof story.title !== 'string') {
            errors.push(`${where}: must be an object with a string "title", a "steps" array and an optional "below" array`);
            return;
        }
        lines.push({ tag: 'story', raw: fold(story.title), where });
        for (const [tag, name] of [['step', 'steps'], ['below', 'below']]) {
            const row = story[name] ?? [];
            if (!Array.isArray(row)) {
                errors.push(`${where}: "${name}" must be an array of steps`);
                continue;
            }
            for (const step of row) {
                const made = rawOfStep(step);
                const refs = made.problem ? {} : filesOfStep(step);
                if (made.problem || refs.problem) errors.push(`${where}: ${made.problem ?? refs.problem}`);
                else lines.push({ tag, raw: made.raw, where }, ...refs.raws.map((raw) => ({ tag: 'file', raw, where })));
            }
        }
    });
    if (errors.length) return { stories: [], errors };
    return parseFlowLines(lines, listed);
}

