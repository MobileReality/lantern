import { TAG, hasControlCharacter } from './plan-format.mjs';

export const FLOW = Object.freeze({
    kinds: Object.freeze(['actor', 'action', 'subject', 'interaction', 'consequence']),
    textMax: 80,
    stories: 5,
    steps: 6,
    files: 6,
    arrow: '=>',
});

export const FLOW_TAGS = Object.freeze([TAG.STORY, TAG.STEP, TAG.BELOW, TAG.FILE]);

const CONSEQUENCE = 'consequence';
const UNENCODED_PERCENT = /%(?!20|23|25)/;

export function createFlowReader({ say, ERROR, NOUN, decodePath }) {
    const states = new WeakMap();

    function textProblem(text, what) {
        if (text === '') return say(ERROR.TEXT_EMPTY, { what });
        if (hasControlCharacter(text)) return say(ERROR.TEXT_CONTROL, { what });
        const length = [...text].length;
        return length > FLOW.textMax ? say(ERROR.TEXT_TOO_LONG, { what, length, cap: FLOW.textMax }) : null;
    }

    function consequenceOf(text) {
        const cut = text.indexOf(` ${FLOW.arrow} `);
        if (cut === -1) return { problem: say(ERROR.FLOW_CONSEQUENCE, { arrow: FLOW.arrow }) };
        const old = text.slice(0, cut).trim();
        const next = text.slice(cut + FLOW.arrow.length + 2).trim();
        const problem = textProblem(old, say(NOUN.FLOW_OLD)) ?? textProblem(next, say(NOUN.FLOW_NEW));
        return problem ? { problem } : { step: { kind: CONSEQUENCE, old, new: next } };
    }

    function stepOf(raw) {
        const cut = raw.search(/\s/);
        const kind = cut === -1 ? raw : raw.slice(0, cut);
        const text = cut === -1 ? '' : raw.slice(cut).trim();
        const known = FLOW.kinds.join(', ');
        if (kind === '') return { problem: say(ERROR.FLOW_KIND_MISSING, { known }) };
        if (!FLOW.kinds.includes(kind)) return { problem: say(ERROR.FLOW_KIND_UNKNOWN, { kind, known }) };
        if (kind === CONSEQUENCE) return consequenceOf(text);
        const problem = textProblem(text, say(NOUN.FLOW_TEXT, { kind }));
        return problem ? { problem } : { step: { kind, text } };
    }

    function attachFile(step, raw) {
        if (raw === '') return say(ERROR.FLOW_FILE_SHAPE);
        if (/\s/.test(raw)) return say(ERROR.FLOW_FILE_WORDS);
        if (UNENCODED_PERCENT.test(raw)) return say(ERROR.BAD_PERCENT, { token: raw });
        const target = decodePath(raw);
        const files = step.files ?? [];
        if (files.includes(target)) return say(ERROR.FLOW_FILE_TWICE, { path: raw });
        if (files.length >= FLOW.files) return say(ERROR.FLOW_FILE_MAX, { max: FLOW.files });
        step.files = [...files, target];
        return null;
    }

    function fileLine(state, raw) {
        if (!state.story) return say(ERROR.FLOW_NO_STORY);
        if (state.last) return attachFile(state.last, raw);
        return state.skip ? null : say(ERROR.FLOW_FILE_NO_STEP);
    }

    function storyLine(question, state, raw) {
        state.below = false;
        const problem = textProblem(raw, say(NOUN.FLOW_STORY_TITLE));
        if (problem) {
            state.story = null;
            return problem;
        }
        state.story = { title: raw, steps: [], below: [] };
        question.flow.push(state.story);
        return question.flow.length > FLOW.stories ? say(ERROR.FLOW_TOO_MANY_STORIES, { max: FLOW.stories }) : null;
    }

    function rowLine(state, tag, raw) {
        if (!state.story) return say(ERROR.FLOW_NO_STORY);
        state.skip = true;
        if (tag === TAG.STEP && state.below) return say(ERROR.FLOW_STEP_AFTER_BELOW);
        if (tag === TAG.BELOW) state.below = true;
        const parsed = stepOf(raw);
        if (parsed.problem) return parsed.problem;
        const row = tag === TAG.STEP ? state.story.steps : state.story.below;
        if (row.length >= FLOW.steps) return say(ERROR.FLOW_TOO_MANY_STEPS, { max: FLOW.steps, tag, title: state.story.title });
        row.push(parsed.step);
        state.last = parsed.step;
        state.skip = false;
        return null;
    }

    return function readFlowLine(question, tag, raw) {
        const state = states.get(question) ?? { story: null, below: false, last: null, skip: false };
        states.set(question, state);
        if (tag === TAG.FILE) return fileLine(state, raw);
        state.last = null;
        state.skip = false;
        return tag === TAG.STORY ? storyLine(question, state, raw) : rowLine(state, tag, raw);
    };
}
