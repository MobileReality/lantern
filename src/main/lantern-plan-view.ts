import { ITEM_STATUS, SECTION_STATE } from '../../skills/lantern-plan/scripts/plan-format.mjs';
import { isPlanApproved, planApprovalStates, planItemStatuses } from './lantern-plan';
import type { LanternPlan, PlanItem, PlanItemStatus, PlanStage } from './lantern-plan';
import type { LanternPlanView, PlanItemView, PlanLifecycle, PlanPrRef, PlanSectionMark, PlanStageView } from './lantern-plan-view-types';
import type { LanternPr } from './lantern-types';

type StatusOf = ReadonlyMap<string, PlanItemStatus>;

const isFinished = (status: PlanItemStatus | undefined) => status === ITEM_STATUS.IMPLEMENTED || status === ITEM_STATUS.VERIFIED;

const prRef = (pr: LanternPr): PlanPrRef => ({ id: pr.id, title: pr.title, url: pr.url, branch: pr.branch, state: pr.state });

function ticks(plan: LanternPlan, prs: readonly LanternPr[]) {
  return prs.flatMap((pr) => (pr.plans ?? []).filter((ref) => ref.slug === plan.slug).map((ref) => ({ item: ref.item, state: pr.state, pr })));
}

function lifecycleOf(plan: LanternPlan, sections: readonly PlanSectionMark[]): PlanLifecycle {
  if (isPlanApproved(plan)) return 'approved';
  const edited = sections.some((mark) => mark.state === SECTION_STATE.STALE);
  return edited || plan.approved !== null ? 'stale' : 'draft';
}

function itemView(item: PlanItem, status: StatusOf, openQuestions: number, prs: readonly PlanPrRef[]): PlanItemView {
  const own = status.get(item.id) ?? ITEM_STATUS.PLANNED;
  return { id: item.id, title: item.title, accept: item.accept, touches: item.touches, status: own, blocked: own === ITEM_STATUS.PLANNED && openQuestions > 0, prs: [...prs] };
}

function stageView(stage: PlanStage, status: StatusOf, sections: readonly PlanSectionMark[], prsOf: (item: string) => PlanPrRef[]): PlanStageView {
  const open = stage.questions.filter((question) => question.answer === null).length;
  const done = stage.items.length > 0 && stage.items.every((item) => isFinished(status.get(item.id)));
  const approval = sections.find((mark) => mark.section === stage.id) ?? { section: stage.id, state: SECTION_STATE.PENDING };
  return {
    id: stage.id,
    title: stage.title,
    touches: stage.touches,
    approval,
    blocked: open > 0 && !done,
    done,
    items: stage.items.map((item) => itemView(item, status, open, prsOf(item.id))),
    questions: stage.questions.map((question) => ({ id: question.id, stage: stage.id, text: question.text, answer: question.answer, touches: question.touches, explain: question.explain, flow: question.flow })),
  };
}

function planView(plan: LanternPlan, prs: readonly LanternPr[], problems: readonly string[] = []): LanternPlanView {
  const links = ticks(plan, prs);
  const status = planItemStatuses(plan, links);
  const sections: PlanSectionMark[] = planApprovalStates(plan);
  const prsOf = (item: string) => links.filter((link) => link.item === item).map((link) => prRef(link.pr));
  const stages = plan.stages.map((stage) => stageView(stage, status, sections, prsOf));
  const items = stages.flatMap((stage) => stage.items);
  return {
    slug: plan.slug,
    title: plan.title,
    opened: plan.opened,
    goal: plan.goal,
    scope: plan.scope,
    impact: plan.impact,
    risks: plan.risks,
    lifecycle: lifecycleOf(plan, sections),
    approved: plan.approved,
    sections,
    stages,
    total: items.length,
    finished: items.filter((item) => isFinished(item.status)).length,
    problems: [...problems],
  };
}

export { planView };
