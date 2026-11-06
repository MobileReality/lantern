import { ITEM_STATUS, PLAN_STATE, PR_STATE } from './plan-format.mjs';
import { isPlanApproved } from './plan-approval.mjs';
import { LINE, say } from './plan-messages.mjs';

export const STATUSES = Object.values(ITEM_STATUS);

const hasLink = (links, state) => links.some((link) => link.state === state);

const STATUS_RULES = [
    [ITEM_STATUS.VERIFIED, (item, verified) => verified.has(item.id)],
    [ITEM_STATUS.IN_PROGRESS, (item, verified, links) => hasLink(links, PR_STATE.OPEN)],
    [ITEM_STATUS.IMPLEMENTED, (item, verified, links) => hasLink(links, PR_STATE.MERGED)],
];

const itemStatus = (item, verified, links) => STATUS_RULES.find(([, applies]) => applies(item, verified, links))?.[0] ?? ITEM_STATUS.PLANNED;

const isFinished = (item) => item.status === ITEM_STATUS.IMPLEMENTED || item.status === ITEM_STATUS.VERIFIED;

function stageStatus(stage, verified, linksByItem) {
    const openQuestions = stage.questions.filter((q) => q.answer === null).map((q) => ({ id: q.id, text: q.text }));
    const items = stage.items.map((item) => {
        const links = linksByItem.get(item.id) ?? [];
        const status = itemStatus(item, verified, links);
        return { id: item.id, title: item.title, status, blocked: status === ITEM_STATUS.PLANNED && openQuestions.length > 0, prs: links.map(({ id, state, branch }) => ({ id, state, branch })) };
    });
    return { id: stage.id, title: stage.title, done: items.every(isFinished), openQuestions, items };
}

function nextStep(stages) {
    const stage = stages.find((s) => !s.done);
    if (!stage) return null;
    return {
        stage: stage.id,
        ready: stage.openQuestions.length === 0 ? stage.items.filter((i) => i.status === ITEM_STATUS.PLANNED).map((i) => i.id) : [],
        waiting: stage.items.filter((i) => i.status === ITEM_STATUS.IN_PROGRESS).map((i) => i.id),
        ask: stage.openQuestions,
    };
}

export function deriveStatus(plan, links) {
    const verified = new Set(plan.verified.map((v) => v.item));
    const linksByItem = new Map();
    for (const link of links) linksByItem.set(link.item, [...(linksByItem.get(link.item) ?? []), link]);
    const stages = plan.stages.map((stage) => stageStatus(stage, verified, linksByItem));
    const items = stages.flatMap((s) => s.items);
    const counts = Object.fromEntries(STATUSES.map((status) => [status, items.filter((i) => i.status === status).length]));
    return { slug: plan.slug, title: plan.title, approved: isPlanApproved(plan), counts, total: items.length, stages, next: nextStep(stages) };
}

function itemLine(item) {
    const prs = item.prs.map((pr) => say(LINE.PR_REF, { id: pr.id, state: pr.state })).join(', ');
    return say(LINE.STATUS_ITEM, {
        id: item.id,
        status: item.status,
        blocked: item.blocked ? say(LINE.BLOCKED_BY_QUESTION) : '',
        title: item.title,
        prs: prs ? say(LINE.PR_LIST, { prs }) : '',
    });
}

const NEXT_RULES = [
    [(next) => next.ready.length > 0, (next) => [say(LINE.NEXT_DELEGATE, { stage: next.stage, ready: next.ready.join(', ') })]],
    [(next) => next.ask.length > 0, (next) => [say(LINE.NEXT_BLOCKED, { stage: next.stage }), ...next.ask.map((q) => say(LINE.QUESTION_ROW, q))]],
    [(next) => next.waiting.length > 0, (next) => [say(LINE.NEXT_WAITING, { waiting: next.waiting.join(', '), stage: next.stage })]],
];

const nextLines = (next) => (next ? NEXT_RULES.filter(([applies]) => applies(next)).flatMap(([, lines]) => lines(next)) : [say(LINE.NEXT_NOTHING)]);

export function formatStatus(status) {
    const { counts } = status;
    const done = counts[ITEM_STATUS.IMPLEMENTED] + counts[ITEM_STATUS.VERIFIED];
    const summary = STATUSES.map((s) => say(LINE.COUNT, { count: counts[s], status: s })).join(', ');
    const lines = [say(LINE.STATUS_HEAD, { slug: status.slug, state: status.approved ? PLAN_STATE.APPROVED : PLAN_STATE.DRAFT, done, total: status.total, summary })];
    for (const stage of status.stages) {
        lines.push(say(LINE.STAGE_HEAD, { id: stage.id, title: stage.title, done: stage.done ? say(LINE.STAGE_DONE) : '' }), ...stage.items.map(itemLine), ...stage.openQuestions.map((q) => say(LINE.OPEN_QUESTION, q)));
    }
    return [...lines, ...nextLines(status.next)];
}
