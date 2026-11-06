import { SECTION, hasControlCharacter } from './plan-format.mjs';
import { ERROR, say } from './plan-messages.mjs';

export function emptyPlan(slug) {
    return {
        slug,
        title: '',
        opened: null,
        goal: [],
        scope: { in: [], out: [] },
        impact: [],
        stages: [],
        risks: [],
        approvals: [],
        approved: null,
        verified: [],
    };
}

export function sectionIds(plan) {
    return [SECTION.TITLE, SECTION.GOAL, SECTION.SCOPE, SECTION.IMPACT, ...plan.stages.map((stage) => stage.id), SECTION.RISKS];
}

export function allItems(plan) {
    return plan.stages.flatMap((stage) => stage.items.map((item) => ({ ...item, stage: stage.id })));
}

const TEXT_RULES = [
    [(text) => text === '', ERROR.TEXT_EMPTY],
    [(text) => hasControlCharacter(text), ERROR.TEXT_CONTROL],
    [(text, cap) => [...text].length > cap, ERROR.TEXT_TOO_LONG],
];

export function textProblem(text, noun, cap) {
    const rule = TEXT_RULES.find(([broken]) => broken(text, cap));
    return rule ? say(rule[1], { what: say(noun), length: [...text].length, cap }) : null;
}
