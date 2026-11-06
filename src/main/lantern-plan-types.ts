import type { LanternFlowStory } from './lantern-types';
import type { ITEM_STATUS, SECTION_STATE, TARGET_KIND } from '../../skills/lantern-plan/scripts/plan-format.mjs';

type PlanTargetKind = (typeof TARGET_KIND)[keyof typeof TARGET_KIND];
type PlanItemStatus = (typeof ITEM_STATUS)[keyof typeof ITEM_STATUS];
type PlanApprovalState = (typeof SECTION_STATE)[keyof typeof SECTION_STATE];

interface PlanTouch {
  kind: PlanTargetKind;
  target: string;
}

interface PlanImpact extends PlanTouch {
  reason: string;
}

interface PlanItem {
  id: string;
  title: string;
  touches: PlanTouch[];
  accept: string | null;
}

interface PlanQuestion {
  id: string;
  text: string;
  answer: { by: string; text: string } | null;
  touches: PlanTouch[];
  explain: string[];
  flow: LanternFlowStory[];
}

interface PlanStage {
  id: string;
  title: string;
  touches: PlanTouch[];
  items: PlanItem[];
  questions: PlanQuestion[];
}

interface PlanApproval {
  section: string;
  by: string;
  date: string;
  digest: string;
}

interface LanternPlan {
  slug: string;
  title: string;
  opened: string | null;
  goal: string[];
  scope: { in: string[]; out: string[] };
  impact: PlanImpact[];
  stages: PlanStage[];
  risks: string[];
  approvals: PlanApproval[];
  approved: { by: string; date: string } | null;
  verified: { item: string; by: string; date: string }[];
}

interface PlanParseResult {
  plan: LanternPlan | null;
  error: string | null;
  problems: string[];
  ignored: string[];
}

export type { LanternPlan, PlanApproval, PlanApprovalState, PlanImpact, PlanItem, PlanItemStatus, PlanParseResult, PlanQuestion, PlanStage, PlanTargetKind, PlanTouch };
