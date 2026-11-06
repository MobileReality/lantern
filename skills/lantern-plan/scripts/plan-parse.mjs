import path from 'node:path';
import { decodePath } from '../../lantern-setup/scripts/lib.mjs';
import { DIGEST, ID_LINE, ITEM_ID, LIMITS, PLAN_EXT, PLAN_HEADER, PLAN_LEVEL, QUESTION_ID, SLUG, STAGE_ID, TAG, TAG_LINE, TARGET_KINDS, WHO, isIsoDate, isPathKind } from './plan-format.mjs';
import { FLOW_TAGS, createFlowReader } from './plan-flow.mjs';
import { ERROR, NOUN, WARNING, located, say } from './plan-messages.mjs';
import { emptyPlan, textProblem } from './plan-model.mjs';

const UNENCODED_PERCENT = /%(?!20|23|25)/;
const KEEPS_QUESTION = new Set([TAG.QUESTION, TAG.ANSWER, TAG.TOUCH, TAG.EXPLAIN, ...FLOW_TAGS]);
const readFlowLine = createFlowReader({ say, ERROR, NOUN, decodePath });

function splitWord(raw) {
    const cut = raw.search(/\s/);
    return cut === -1 ? [raw, ''] : [raw.slice(0, cut), raw.slice(cut).trim()];
}

function pushText(list, raw, noun, cap, max) {
    const problem = textProblem(raw, noun, cap) ?? (list.length >= max ? say(ERROR.TOO_MANY_LINES, { max, what: say(noun) }) : null);
    if (problem) return problem;
    list.push(raw);
    return null;
}

const TARGET_RULES = [
    [(kind) => !TARGET_KINDS.includes(kind), (kind) => say(ERROR.UNKNOWN_KIND, { kind, known: TARGET_KINDS.join(', ') })],
    [(kind, token) => token === '', (kind) => say(ERROR.TARGET_MISSING, { kind })],
    [(kind, token) => isPathKind(kind) && UNENCODED_PERCENT.test(token), (kind, token) => say(ERROR.BAD_PERCENT, { token })],
];

function targetOf(kind, token) {
    const rule = TARGET_RULES.find(([broken]) => broken(kind, token));
    if (rule) return { problem: rule[1](kind, token) };
    return { target: isPathKind(kind) ? decodePath(token) : token };
}

function touchOf(raw) {
    const [kind, rest] = splitWord(raw);
    const [token, extra] = splitWord(rest);
    if (extra) return { problem: say(ERROR.TOUCH_SHAPE) };
    const parsed = targetOf(kind, token);
    return parsed.problem ? parsed : { touch: { kind, target: parsed.target } };
}

function addTouch(owner, touch) {
    if (!owner) return say(ERROR.TOUCH_ORPHAN);
    if (owner.touches.some((t) => t.kind === touch.kind && t.target === touch.target)) return say(ERROR.TOUCH_DUPLICATE, touch);
    owner.touches.push(touch);
    return null;
}

const ANSWER_RULES = [
    [(question) => !question, () => say(ERROR.ANSWER_ORPHAN)],
    [(question) => question.answer, (question) => say(ERROR.ANSWER_DUPLICATE, { id: question.id })],
    [(question, by) => !WHO.test(by), () => say(ERROR.ANSWER_WHO)],
];

function answerProblem(question, by, text) {
    const rule = ANSWER_RULES.find(([broken]) => broken(question, by));
    return rule ? rule[1](question) : textProblem(text, NOUN.ANSWER, LIMITS.answer);
}

function approvalProblem(level, by, date, digest) {
    if (!WHO.test(by) || !isIsoDate(date)) return say(ERROR.APPROVED_SHAPE);
    if (level) return digest === '' ? null : say(ERROR.APPROVED_LEVEL_DIGEST);
    return DIGEST.test(digest) ? null : say(ERROR.APPROVED_DIGEST);
}

function setPlanApproval(plan, by, date) {
    if (plan.approved) return say(ERROR.APPROVED_PLAN_DUPLICATE);
    plan.approved = { by, date };
    return null;
}

function singleton(ctx, key, value) {
    if (ctx.seen.has(key)) return say(ERROR.SINGLETON_DUPLICATE, { tag: key });
    ctx.seen.add(key);
    ctx.plan[key] = value;
    return null;
}

const HANDLERS = {
    [TAG.TITLE]: (ctx, raw) => textProblem(raw, NOUN.TITLE, LIMITS.title) ?? singleton(ctx, TAG.TITLE, raw),
    [TAG.OPENED]: (ctx, raw) => (isIsoDate(raw) ? singleton(ctx, TAG.OPENED, raw) : say(ERROR.OPENED_DATE)),
    [TAG.GOAL]: (ctx, raw) => pushText(ctx.plan.goal, raw, NOUN.GOAL, LIMITS.goal, LIMITS.goalLines),
    [TAG.SCOPE_IN]: (ctx, raw) => pushText(ctx.plan.scope.in, raw, NOUN.SCOPE_IN, LIMITS.scope, LIMITS.scopeLines),
    [TAG.SCOPE_OUT]: (ctx, raw) => pushText(ctx.plan.scope.out, raw, NOUN.SCOPE_OUT, LIMITS.scope, LIMITS.scopeLines),
    [TAG.RISK]: (ctx, raw) => pushText(ctx.plan.risks, raw, NOUN.RISK, LIMITS.risk, LIMITS.risks),
    [TAG.IMPACT](ctx, raw) {
        const [kind, rest] = splitWord(raw);
        const [token, reason] = splitWord(rest);
        const parsed = targetOf(kind, token);
        const problem = parsed.problem ?? textProblem(reason, NOUN.REASON, LIMITS.reason);
        if (problem) return problem;
        if (ctx.plan.impact.some((e) => e.kind === kind && e.target === parsed.target)) return say(ERROR.IMPACT_DUPLICATE, { kind, target: parsed.target });
        ctx.plan.impact.push({ kind, target: parsed.target, reason });
        return null;
    },
    [TAG.STAGE](ctx, raw) {
        const [id, title] = splitWord(raw);
        const problem = STAGE_ID.test(id) ? textProblem(title, NOUN.STAGE_TITLE, LIMITS.title) : say(ERROR.STAGE_ID, { id });
        if (problem) return problem;
        if (ctx.plan.stages.some((s) => s.id === id)) return say(ERROR.STAGE_DUPLICATE, { id });
        ctx.stage = { id, title, touches: [], items: [], questions: [] };
        ctx.plan.stages.push(ctx.stage);
        ctx.owner = ctx.stage;
        ctx.question = null;
        return null;
    },
    [TAG.ITEM](ctx, raw) {
        const [id, title] = splitWord(raw);
        const match = ITEM_ID.exec(id);
        if (!ctx.stage) return say(ERROR.ITEM_ORPHAN);
        const problem = match ? textProblem(title, NOUN.ITEM_TITLE, LIMITS.title) : say(ERROR.ITEM_ID, { id, stage: ctx.stage.id });
        if (problem) return problem;
        if (ctx.plan.stages.some((s) => s.items.some((i) => i.id === id))) return say(ERROR.ITEM_DUPLICATE, { id });
        if (`s${match[1]}` !== ctx.stage.id) return say(ERROR.ITEM_STAGE, { id, stage: ctx.stage.id });
        ctx.owner = { id, title, touches: [], accept: null };
        ctx.stage.items.push(ctx.owner);
        ctx.question = null;
        return null;
    },
    [TAG.TOUCH](ctx, raw) {
        const parsed = touchOf(raw);
        return parsed.problem ?? addTouch(ctx.owner ?? ctx.question, parsed.touch);
    },
    [TAG.ACCEPT](ctx, raw) {
        const item = ctx.owner !== ctx.stage ? ctx.owner : null;
        if (!item) return say(ERROR.ACCEPT_ORPHAN);
        if (item.accept !== null) return say(ERROR.ACCEPT_DUPLICATE);
        const problem = textProblem(raw, NOUN.ACCEPT, LIMITS.accept);
        if (problem) return problem;
        item.accept = raw;
        return null;
    },
    [TAG.QUESTION](ctx, raw) {
        const [id, text] = splitWord(raw);
        if (!ctx.stage) return say(ERROR.QUESTION_ORPHAN);
        const problem = QUESTION_ID.test(id) ? textProblem(text, NOUN.QUESTION, LIMITS.question) : say(ERROR.QUESTION_ID, { id, stage: ctx.stage.id });
        if (problem) return problem;
        if (ctx.plan.stages.some((s) => s.questions.some((q) => q.id === id))) return say(ERROR.QUESTION_DUPLICATE, { id });
        if (id.slice(0, id.indexOf('.')) !== ctx.stage.id) return say(ERROR.QUESTION_STAGE, { id, stage: ctx.stage.id });
        ctx.question = { id, text, answer: null, touches: [], explain: [], flow: [] };
        ctx.stage.questions.push(ctx.question);
        ctx.owner = null;
        return null;
    },
    [TAG.ANSWER](ctx, raw) {
        const [by, text] = splitWord(raw);
        const problem = answerProblem(ctx.question, by, text);
        if (problem) return problem;
        ctx.question.answer = { by, text };
        return null;
    },
    [TAG.EXPLAIN]: (ctx, raw) => (ctx.question ? pushText(ctx.question.explain, raw, NOUN.EXPLAIN, LIMITS.explain, LIMITS.explainLines) : say(ERROR.QUESTION_LINE_ORPHAN)),
    ...Object.fromEntries(FLOW_TAGS.map((tag) => [tag, (ctx, raw) => (ctx.question ? readFlowLine(ctx.question, tag, raw) : say(ERROR.QUESTION_LINE_ORPHAN))])),
    [TAG.APPROVED](ctx, raw) {
        const [section, rest] = splitWord(raw);
        const [by, rest2] = splitWord(rest);
        const [date, digest] = splitWord(rest2);
        const level = section === PLAN_LEVEL;
        const problem = approvalProblem(level, by, date, digest);
        if (problem) return problem;
        if (level) return setPlanApproval(ctx.plan, by, date);
        if (ctx.plan.approvals.some((a) => a.section === section)) return say(ERROR.APPROVED_DUPLICATE, { section });
        ctx.plan.approvals.push({ section, by, date, digest });
        return null;
    },
    [TAG.VERIFIED](ctx, raw) {
        const [item, rest] = splitWord(raw);
        const [by, date] = splitWord(rest);
        if (!ITEM_ID.test(item) || !WHO.test(by) || !isIsoDate(date)) return say(ERROR.VERIFIED_SHAPE);
        if (ctx.plan.verified.some((v) => v.item === item)) return say(ERROR.VERIFIED_DUPLICATE, { item });
        ctx.plan.verified.push({ item, by, date });
        return null;
    },
};

export function parsePlan(text, file) {
    const errors = [];
    const warnings = [];
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const name = path.basename(file);
    const slug = name.endsWith(PLAN_EXT) ? name.slice(0, -PLAN_EXT.length) : null;
    if (slug === null || !SLUG.test(slug)) errors.push(located(file, say(ERROR.FILE_NAME)));
    if (lines[0]?.trim() !== PLAN_HEADER) errors.push(located(`${file}:1`, say(ERROR.FIRST_LINE, { header: PLAN_HEADER })));
    const ctx = { plan: emptyPlan(slug ?? ''), seen: new Set(), stage: null, owner: null, question: null };
    let id = null;
    lines.forEach((raw, index) => {
        const line = raw.trim();
        if (index === 0 || line === '') return;
        const where = `${file}:${index + 1}`;
        if (!line.startsWith('#')) {
            errors.push(located(where, say(ERROR.NOT_PLAN_LINE, { line })));
            return;
        }
        if (id === null) {
            const idLine = ID_LINE.exec(line);
            if (idLine) id = idLine[1];
            else errors.push(located(where, say(ERROR.FIRST_HASH_LINE, { slug: slug ?? say(NOUN.SLUG_PLACEHOLDER) })));
            return;
        }
        const tag = TAG_LINE.exec(line);
        if (!tag) {
            errors.push(located(where, say(ERROR.NOT_TAG_LINE, { line })));
            return;
        }
        const handler = Object.hasOwn(HANDLERS, tag[1]) ? HANDLERS[tag[1]] : null;
        if (!handler) {
            warnings.push(located(where, say(WARNING.UNKNOWN_TAG, { tag: tag[1] })));
            return;
        }
        const problem = handler(ctx, tag[2] ?? '');
        if (problem) errors.push(located(where, say(ERROR.TAGGED, { tag: tag[1], text: problem })));
        if (!KEEPS_QUESTION.has(tag[1])) ctx.question = null;
    });
    if (id === null) errors.push(located(file, say(ERROR.MISSING_ID_LINE, { slug: slug ?? say(NOUN.SLUG_PLACEHOLDER) })));
    else if (slug !== null && id !== slug) errors.push(located(file, say(ERROR.ID_MISMATCH, { id, name })));
    return { plan: ctx.plan, errors, warnings };
}
