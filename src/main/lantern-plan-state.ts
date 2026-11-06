import { createHash } from 'node:crypto';
import { DIGEST_LENGTH, ITEM_STATUS, PR_STATE, SECTION, SECTION_STATE, TAG, isPathKind, tagLine } from '@skills/lantern-plan/scripts/plan-format.mjs';
import { encodePath } from './lantern-parse';
import type { LanternPlan, PlanApprovalState, PlanItemStatus, PlanStage, PlanTargetKind, PlanTouch } from './lantern-plan-types';
import type { LanternPrState } from './lantern-types';

interface PlanLink {
  item: string;
  state: LanternPrState;
}

type StatusRule = [PlanItemStatus, (itemId: string, verified: Set<string>, links: PlanLink[]) => boolean];

const targetToken = (kind: PlanTargetKind, target: string) => (isPathKind(kind) ? encodePath(target) : target);

const touchLines = (touches: PlanTouch[]) => touches.map((t) => tagLine(TAG.TOUCH, t.kind, targetToken(t.kind, t.target)));

function stageLines(stage: PlanStage) {
  const items = stage.items.flatMap((i) => [tagLine(TAG.ITEM, i.id, i.title), ...touchLines(i.touches), ...(i.accept === null ? [] : [tagLine(TAG.ACCEPT, i.accept)])]);
  return [tagLine(TAG.STAGE, stage.id, stage.title), ...touchLines(stage.touches), ...items, ...stage.questions.map((q) => tagLine(TAG.QUESTION, q.id, q.text))];
}

const textLines = (tag: string, texts: string[]) => texts.map((text) => tagLine(tag, text));

const SECTION_LINES: Record<string, (plan: LanternPlan) => string[]> = {
  [SECTION.TITLE]: (plan) => (plan.title === '' ? [] : [tagLine(TAG.TITLE, plan.title)]),
  [SECTION.GOAL]: (plan) => textLines(TAG.GOAL, plan.goal),
  [SECTION.SCOPE]: (plan) => [...textLines(TAG.SCOPE_IN, plan.scope.in), ...textLines(TAG.SCOPE_OUT, plan.scope.out)],
  [SECTION.IMPACT]: (plan) => plan.impact.map((e) => tagLine(TAG.IMPACT, e.kind, targetToken(e.kind, e.target), e.reason)),
  [SECTION.RISKS]: (plan) => textLines(TAG.RISK, plan.risks),
};

function planSectionIds(plan: LanternPlan) {
  return [SECTION.TITLE, SECTION.GOAL, SECTION.SCOPE, SECTION.IMPACT, ...plan.stages.map((s) => s.id), SECTION.RISKS];
}

function planSectionLines(plan: LanternPlan, section: string): string[] {
  if (Object.hasOwn(SECTION_LINES, section)) return SECTION_LINES[section](plan);
  const found = plan.stages.find((s) => s.id === section);
  return found ? stageLines(found) : [];
}

function planSectionDigest(plan: LanternPlan, section: string) {
  return createHash('sha256').update(planSectionLines(plan, section).join('\n')).digest('hex').slice(0, DIGEST_LENGTH);
}

function planApprovalStates(plan: LanternPlan): { section: string; state: PlanApprovalState; by?: string; date?: string }[] {
  return planSectionIds(plan).map((section) => {
    const approval = plan.approvals.find((a) => a.section === section);
    if (!approval) return { section, state: SECTION_STATE.PENDING };
    return { section, state: approval.digest === planSectionDigest(plan, section) ? SECTION_STATE.APPROVED : SECTION_STATE.STALE, by: approval.by, date: approval.date };
  });
}

function isPlanApproved(plan: LanternPlan) {
  return plan.approved !== null && planApprovalStates(plan).every((s) => s.state === SECTION_STATE.APPROVED);
}

const hasLink = (links: PlanLink[], state: LanternPrState) => links.some((l) => l.state === state);

const STATUS_RULES: StatusRule[] = [
  [ITEM_STATUS.VERIFIED, (itemId, verified) => verified.has(itemId)],
  [ITEM_STATUS.IN_PROGRESS, (itemId, verified, links) => hasLink(links, PR_STATE.OPEN)],
  [ITEM_STATUS.IMPLEMENTED, (itemId, verified, links) => hasLink(links, PR_STATE.MERGED)],
];

function planItemStatuses(plan: LanternPlan, links: PlanLink[]) {
  const verified = new Set(plan.verified.map((v) => v.item));
  const statuses = new Map<string, PlanItemStatus>();
  for (const stage of plan.stages) {
    for (const planned of stage.items) {
      const own = links.filter((l) => l.item === planned.id);
      const rule = STATUS_RULES.find(([, applies]) => applies(planned.id, verified, own));
      statuses.set(planned.id, rule ? rule[0] : ITEM_STATUS.PLANNED);
    }
  }
  return statuses;
}

export { isPlanApproved, planApprovalStates, planItemStatuses, planSectionDigest, planSectionIds, planSectionLines };
