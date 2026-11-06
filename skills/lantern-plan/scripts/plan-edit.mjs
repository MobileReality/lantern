import { unapprovedSections } from './plan-approval.mjs';
import { PLAN_LEVEL, SCOPE_SIDE, SECTION, TAG, TARGET_KINDS } from './plan-format.mjs';
import { ERROR, NOUN, say } from './plan-messages.mjs';
import { allItems, emptyPlan, sectionIds } from './plan-model.mjs';
import { sectionDigest } from './plan-write.mjs';

export class PlanEditError extends Error {}

const FLOW_KIND = 'flow';

function need(condition, code, params = {}) {
    if (!condition) throw new PlanEditError(say(code, params));
}

export function newPlan({ slug, title, goals, today }) {
    const plan = emptyPlan(slug);
    plan.title = title;
    plan.opened = today;
    plan.goal = goals;
    return plan;
}

function stageOf(plan, id) {
    const stage = plan.stages.find((s) => s.id === id);
    need(stage, ERROR.EDIT_NO_STAGE, { id, slug: plan.slug, stages: plan.stages.map((s) => s.id).join(', ') || say(NOUN.NONE_YET) });
    return stage;
}

function questionOf(plan, id) {
    const question = plan.stages.flatMap((s) => s.questions).find((q) => q.id === id);
    need(question, ERROR.EDIT_NO_QUESTION, { id, slug: plan.slug });
    return question;
}

function parseTouch(spec) {
    const cut = spec.indexOf(':');
    const kind = cut === -1 ? '' : spec.slice(0, cut);
    need(TARGET_KINDS.includes(kind), ERROR.EDIT_TOUCH_SPEC, { spec });
    return { kind, target: spec.slice(cut + 1) };
}

const ADDERS = {
    [TAG.GOAL]: (plan, [text]) => plan.goal.push(text),
    [SECTION.SCOPE](plan, [side, text]) {
        need(Object.values(SCOPE_SIDE).includes(side), ERROR.EDIT_SCOPE_SIDE);
        plan.scope[side].push(text);
    },
    [TAG.IMPACT](plan, [kind, target, reason]) {
        need(TARGET_KINDS.includes(kind), ERROR.EDIT_IMPACT_KIND);
        plan.impact.push({ kind, target, reason });
    },
    [TAG.STAGE]: (plan, [title]) => plan.stages.push({ id: `s${plan.stages.length + 1}`, title, touches: [], items: [], questions: [] }),
    [TAG.ITEM](plan, [stageId, title], flags) {
        const stage = stageOf(plan, stageId);
        const touches = (flags.touch ?? []).map(parseTouch);
        stage.items.push({ id: `${stage.id}.${stage.items.length + 1}`, title, touches, accept: flags.accept ?? null });
    },
    [TAG.TOUCH](plan, [owner, kind, target]) {
        const holder = [...plan.stages.flatMap((s) => s.items), ...plan.stages.flatMap((s) => s.questions)].find((each) => each.id === owner) ?? stageOf(plan, owner);
        holder.touches.push(parseTouch(`${kind}:${target}`));
    },
    [TAG.QUESTION](plan, [stageId, text]) {
        const stage = stageOf(plan, stageId);
        stage.questions.push({ id: `${stage.id}.q${stage.questions.length + 1}`, text, answer: null, touches: [], explain: [], flow: [] });
    },
    [TAG.ANSWER](plan, [questionId, by, text]) {
        questionOf(plan, questionId).answer = { by, text };
    },
    [TAG.EXPLAIN](plan, [questionId, text], flags) {
        const question = questionOf(plan, questionId);
        if (flags.replace) question.explain = [];
        question.explain.push(text);
    },
    [FLOW_KIND](plan, [questionId], flags) {
        const question = questionOf(plan, questionId);
        need(flags.flowStories, ERROR.EDIT_FLOW_NEEDS_FILE);
        question.flow = flags.replace ? flags.flowStories : [...question.flow, ...flags.flowStories];
    },
    [TAG.RISK]: (plan, [text]) => plan.risks.push(text),
};

export const ADD_KINDS = Object.keys(ADDERS);

const ARITY = { [TAG.GOAL]: 1, [SECTION.SCOPE]: 2, [TAG.IMPACT]: 3, [TAG.STAGE]: 1, [TAG.ITEM]: 2, [TAG.TOUCH]: 3, [TAG.QUESTION]: 2, [TAG.ANSWER]: 3, [TAG.EXPLAIN]: 2, [FLOW_KIND]: 1, [TAG.RISK]: 1 };

export function addToPlan(plan, kind, args, flags = {}) {
    need(Object.hasOwn(ADDERS, kind), ERROR.EDIT_ADD_WHAT, { kinds: ADD_KINDS.join(', ') });
    need(args.length >= ARITY[kind], ERROR.EDIT_ADD_ARITY, { kind, arity: ARITY[kind] });
    const fixed = args.slice(0, ARITY[kind] - 1);
    const text = args.slice(ARITY[kind] - 1).join(' ').trim();
    need(text !== '', ERROR.EDIT_ADD_EMPTY, { kind });
    ADDERS[kind](plan, [...fixed, text], flags);
    return plan;
}

export function approveSection(plan, section, by, date) {
    if (section === PLAN_LEVEL) {
        const open = unapprovedSections(plan);
        need(open.length === 0, ERROR.EDIT_NOT_READY, { open: open.map((s) => `${s.section} (${s.state})`).join(', ') });
        plan.approved = { by, date };
        return plan;
    }
    need(sectionIds(plan).includes(section), ERROR.EDIT_NO_SECTION, { section, sections: sectionIds(plan).join(', '), level: PLAN_LEVEL });
    plan.approvals = [...plan.approvals.filter((a) => a.section !== section), { section, by, date, digest: sectionDigest(plan, section) }];
    plan.approved = null;
    return plan;
}

export function markVerified(plan, itemId, by, date) {
    need(allItems(plan).some((item) => item.id === itemId), ERROR.EDIT_NO_ITEM, { id: itemId, slug: plan.slug });
    plan.verified = [...plan.verified.filter((v) => v.item !== itemId), { item: itemId, by, date }];
    return plan;
}
