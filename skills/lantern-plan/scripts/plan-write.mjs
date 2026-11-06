import { createHash } from 'node:crypto';
import { encodePath } from '../../lantern-setup/scripts/lib.mjs';
import { flowRecordLines } from '../../lantern-setup/scripts/prflow.mjs';
import { DIGEST_LENGTH, PLAN_HEADER, PLAN_LEVEL, SECTION, TAG, isPathKind, tagLine } from './plan-format.mjs';

const targetToken = (kind, target) => (isPathKind(kind) ? encodePath(target) : target);

const touchLines = (touches) => touches.map((touch) => tagLine(TAG.TOUCH, touch.kind, targetToken(touch.kind, touch.target)));

function itemLines(item) {
    return [tagLine(TAG.ITEM, item.id, item.title), ...touchLines(item.touches), ...(item.accept === null ? [] : [tagLine(TAG.ACCEPT, item.accept)])];
}

function questionLines(question, forDigest) {
    const head = tagLine(TAG.QUESTION, question.id, question.text);
    if (forDigest) return [head];
    const answer = question.answer ? [tagLine(TAG.ANSWER, question.answer.by, question.answer.text)] : [];
    return [head, ...touchLines(question.touches), ...question.explain.map((text) => tagLine(TAG.EXPLAIN, text)), ...flowRecordLines(question.flow), ...answer];
}

export function stageLines(stage, { forDigest = false } = {}) {
    return [tagLine(TAG.STAGE, stage.id, stage.title), ...touchLines(stage.touches), ...stage.items.flatMap(itemLines), ...stage.questions.flatMap((q) => questionLines(q, forDigest))];
}

const textLines = (tag, texts) => texts.map((text) => tagLine(tag, text));

const SECTION_LINES = {
    [SECTION.TITLE]: (plan) => (plan.title === '' ? [] : [tagLine(TAG.TITLE, plan.title)]),
    [SECTION.GOAL]: (plan) => textLines(TAG.GOAL, plan.goal),
    [SECTION.SCOPE]: (plan) => [...textLines(TAG.SCOPE_IN, plan.scope.in), ...textLines(TAG.SCOPE_OUT, plan.scope.out)],
    [SECTION.IMPACT]: (plan) => plan.impact.map((entry) => tagLine(TAG.IMPACT, entry.kind, targetToken(entry.kind, entry.target), entry.reason)),
    [SECTION.RISKS]: (plan) => textLines(TAG.RISK, plan.risks),
};

export function sectionLines(plan, id) {
    if (Object.hasOwn(SECTION_LINES, id)) return SECTION_LINES[id](plan);
    const stage = plan.stages.find((s) => s.id === id);
    return stage ? stageLines(stage, { forDigest: true }) : [];
}

export function sectionDigest(plan, id) {
    return createHash('sha256').update(sectionLines(plan, id).join('\n')).digest('hex').slice(0, DIGEST_LENGTH);
}

function approvalLines(plan) {
    const sections = plan.approvals.map((a) => tagLine(TAG.APPROVED, a.section, a.by, a.date, a.digest));
    const level = plan.approved ? [tagLine(TAG.APPROVED, PLAN_LEVEL, plan.approved.by, plan.approved.date)] : [];
    return [...sections, ...level, ...plan.verified.map((v) => tagLine(TAG.VERIFIED, v.item, v.by, v.date))];
}

export function serializePlan(plan) {
    const head = [PLAN_HEADER, `# ${plan.slug}`, ...sectionLines(plan, SECTION.TITLE), ...(plan.opened ? [tagLine(TAG.OPENED, plan.opened)] : [])];
    const blocks = [head, ...[SECTION.GOAL, SECTION.SCOPE, SECTION.IMPACT].map((id) => sectionLines(plan, id)), ...plan.stages.map((stage) => stageLines(stage)), sectionLines(plan, SECTION.RISKS), approvalLines(plan)];
    return `${blocks.filter((block) => block.length).map((block) => block.join('\n')).join('\n\n')}\n`;
}
