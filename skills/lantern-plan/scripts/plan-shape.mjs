import { TAG } from './plan-format.mjs';
import { approvalProblems } from './plan-approval.mjs';
import { ERROR, NOUN, WARNING, say } from './plan-messages.mjs';
import { allItems } from './plan-model.mjs';

const REQUIRED_PARTS = [
    [TAG.TITLE, (plan) => plan.title === ''],
    [TAG.OPENED, (plan) => !plan.opened],
    [TAG.GOAL, (plan) => plan.goal.length === 0],
    [TAG.SCOPE_IN, (plan) => plan.scope.in.length === 0],
    [TAG.IMPACT, (plan) => plan.impact.length === 0],
    [TAG.STAGE, (plan) => plan.stages.length === 0],
];

const requiredParts = (plan) => REQUIRED_PARTS.filter(([, missing]) => missing(plan)).map(([tag]) => say(ERROR.PART_MISSING, { part: `#${tag}` }));

function sequenceProblems(ids, expected, what) {
    const wrong = ids.findIndex((id, index) => id !== expected(index + 1));
    return wrong === -1 ? [] : [say(ERROR.SEQUENCE, { what, id: ids[wrong], position: wrong + 1, expected: expected(wrong + 1) })];
}

const STAGE_RULES = [
    [(stage, index) => stage.id !== `s${index + 1}`, (stage, index) => say(ERROR.STAGE_ORDER, { id: stage.id, position: index + 1, expected: `s${index + 1}` })],
    [(stage) => stage.items.length === 0, (stage) => say(ERROR.STAGE_NO_ITEM, { id: stage.id })],
];

const flowProblems = (stage) => stage.questions.flatMap((q) => q.flow.filter((story) => story.steps.length === 0).map((story) => say(ERROR.FLOW_STORY_NO_STEP, { id: q.id, title: story.title })));

function stageProblems(stage, index) {
    const own = STAGE_RULES.filter(([broken]) => broken(stage, index)).map(([, message]) => message(stage, index));
    return [
        ...own,
        ...flowProblems(stage),
        ...sequenceProblems(stage.items.map((i) => i.id), (n) => `${stage.id}.${n}`, say(NOUN.ITEMS_OF, { id: stage.id })),
        ...sequenceProblems(stage.questions.map((q) => q.id), (n) => `${stage.id}.q${n}`, say(NOUN.QUESTIONS_OF, { id: stage.id })),
    ];
}

const ITEM_RULES = [
    [(item) => item.accept === null, ERROR.ITEM_NO_ACCEPT],
    [(item) => item.touches.length === 0, ERROR.ITEM_NO_TOUCH],
];

const itemProblems = (plan) => allItems(plan).flatMap((item) => ITEM_RULES.filter(([broken]) => broken(item)).map(([, code]) => say(code, { id: item.id })));

function verifiedProblems(plan) {
    const ids = new Set(allItems(plan).map((i) => i.id));
    return plan.verified.filter((v) => !ids.has(v.item)).map((v) => say(ERROR.VERIFIED_NO_ITEM, { item: v.item }));
}

export function shapeProblems(plan) {
    const approvals = approvalProblems(plan);
    const errors = [...requiredParts(plan), ...plan.stages.flatMap(stageProblems), ...itemProblems(plan), ...verifiedProblems(plan), ...approvals.errors];
    const warnings = [...approvals.warnings, ...(plan.scope.out.length === 0 ? [say(WARNING.NO_SCOPE_OUT)] : [])];
    return { errors, warnings };
}
