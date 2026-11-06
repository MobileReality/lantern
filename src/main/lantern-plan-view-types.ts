import type { PlanApprovalState, PlanImpact, PlanItemStatus, PlanTouch } from './lantern-plan-types';
import type { LanternFlowStory, LanternPrState } from './lantern-types';

type PlanLifecycle = 'draft' | 'approved' | 'stale';

interface PlanSectionMark {
  section: string;
  state: PlanApprovalState;
  by?: string;
  date?: string;
}

interface PlanPrRef {
  id: string;
  title: string;
  url: string;
  branch: string;
  state: LanternPrState;
}

interface PlanItemView {
  id: string;
  title: string;
  accept: string | null;
  touches: PlanTouch[];
  status: PlanItemStatus;
  blocked: boolean;
  prs: PlanPrRef[];
}

interface PlanQuestionView {
  id: string;
  stage: string;
  text: string;
  answer: { by: string; text: string } | null;
  touches: PlanTouch[];
  explain: string[];
  flow: LanternFlowStory[];
}

interface PlanStageView {
  id: string;
  title: string;
  touches: PlanTouch[];
  approval: PlanSectionMark;
  blocked: boolean;
  done: boolean;
  items: PlanItemView[];
  questions: PlanQuestionView[];
}

interface LanternPlanView {
  slug: string;
  title: string;
  opened: string | null;
  goal: string[];
  scope: { in: string[]; out: string[] };
  impact: PlanImpact[];
  risks: string[];
  lifecycle: PlanLifecycle;
  approved: { by: string; date: string } | null;
  sections: PlanSectionMark[];
  stages: PlanStageView[];
  total: number;
  finished: number;
  problems: string[];
}

export type { LanternPlanView, PlanItemView, PlanLifecycle, PlanPrRef, PlanQuestionView, PlanSectionMark, PlanStageView };
