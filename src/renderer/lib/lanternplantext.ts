import type { PlanTouch } from '@main/lantern-plan-types';
import type { LanternPlanView, PlanItemView, PlanQuestionView, PlanStageView } from '@main/lantern-plan-view-types';
import { VIEW, say } from '@shared/lantern-plan-messages';
import { KIND_TEXT, PR_STATE_TEXT, STATUS_TEXT } from './lanternplanwords';

const INDENT = '  ';

const indented = (level: number, text: string) => `${INDENT.repeat(level)}${text}`;
const bullets = (texts: readonly string[]) => texts.map((text) => say(VIEW.TEXT_BULLET, { text }));
const touchText = (touch: PlanTouch) => say(VIEW.TEXT_TOUCH, { kind: say(KIND_TEXT[touch.kind]), target: touch.target });
const changesLine = (touches: readonly PlanTouch[]) => (touches.length ? [say(VIEW.TEXT_CHANGES, { touches: touches.map(touchText).join(', ') })] : []);

function approvalLine(plan: LanternPlanView) {
  return plan.approved ? say(VIEW.APPROVED_BY, { by: plan.approved.by, date: plan.approved.date }) : say(VIEW.NOT_APPROVED);
}

function headLines(plan: LanternPlanView) {
  const meta = plan.opened ? say(VIEW.META, { slug: plan.slug, date: plan.opened }) : plan.slug;
  const progress = plan.total ? say(VIEW.PROGRESS, { finished: plan.finished, total: plan.total }) : say(VIEW.PROGRESS_NONE);
  return [plan.title, meta, progress, approvalLine(plan)];
}

function section(heading: string, body: readonly string[]) {
  return body.length ? ['', heading, ...body] : [];
}

function scopeLines(plan: LanternPlanView) {
  const inside = plan.scope.in.length ? [say(VIEW.SCOPE_IN), ...bullets(plan.scope.in)] : [];
  const outside = plan.scope.out.length ? [say(VIEW.SCOPE_OUT), ...bullets(plan.scope.out)] : [];
  return section(say(VIEW.HEAD_SCOPE), [...inside, ...outside]);
}

function questionLines(question: PlanQuestionView, level: number) {
  const state = say(question.answer ? VIEW.TEXT_STATE_ANSWERED : VIEW.QUESTION_OPEN);
  const answer = question.answer ? [indented(level + 1, say(VIEW.TEXT_ANSWER, { by: question.answer.by, text: question.answer.text }))] : [];
  return [indented(level, say(VIEW.TEXT_QUESTION, { id: question.id, state, text: question.text })), ...answer];
}

function itemLines(item: PlanItemView, level: number) {
  const prs = item.prs.length ? [say(VIEW.TEXT_PRS, { prs: item.prs.map((pr) => say(VIEW.PR_LINK, { id: pr.id, state: say(PR_STATE_TEXT[pr.state]) })).join(', ') })] : [];
  const accept = item.accept ? [say(VIEW.ACCEPT, { accept: item.accept })] : [];
  const detail = [...accept, ...changesLine(item.touches), ...prs].map((line) => indented(level + 1, line));
  return [indented(level, say(VIEW.TEXT_ITEM, { id: item.id, title: item.title, status: say(STATUS_TEXT[item.status]) })), ...detail];
}

function stageFlags(stage: PlanStageView) {
  const flags = [...(stage.done ? [say(VIEW.STAGE_DONE)] : []), ...(stage.blocked ? [say(VIEW.STAGE_BLOCKED)] : [])];
  return flags.length ? say(VIEW.TEXT_FLAGS, { flags: flags.join(', ') }) : '';
}

function stageLines(stage: PlanStageView) {
  const questions = stage.questions.length ? [indented(1, say(VIEW.HEAD_QUESTIONS)), ...stage.questions.flatMap((question) => questionLines(question, 2))] : [];
  return [
    say(VIEW.TEXT_STAGE, { id: stage.id, title: stage.title, flags: stageFlags(stage) }),
    ...changesLine(stage.touches).map((line) => indented(1, line)),
    ...questions,
    ...stage.items.flatMap((item) => itemLines(item, 1)),
  ];
}

function stagesLines(plan: LanternPlanView) {
  const body = plan.stages.length ? plan.stages.flatMap((stage, index) => (index ? ['', ...stageLines(stage)] : stageLines(stage))) : [say(VIEW.NO_STAGES)];
  return section(say(VIEW.HEAD_STAGES), body);
}

function impactLines(plan: LanternPlanView) {
  const rows = plan.impact.map((entry) => say(VIEW.TEXT_IMPACT, { kind: say(KIND_TEXT[entry.kind]), target: entry.target, reason: entry.reason }));
  return section(say(VIEW.HEAD_IMPACT), bullets(rows));
}

function planText(plan: LanternPlanView) {
  const lines = [
    ...headLines(plan),
    ...section(say(VIEW.HEAD_GOAL), bullets(plan.goal)),
    ...scopeLines(plan),
    ...stagesLines(plan),
    ...impactLines(plan),
    ...section(say(VIEW.HEAD_RISKS), bullets(plan.risks)),
  ];
  return `${lines.join('\n')}\n`;
}

export { planText };
