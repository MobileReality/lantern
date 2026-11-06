import { ITEM_STATUS, TARGET_KIND } from '@skills/lantern-plan/scripts/plan-format.mjs';
import type { PlanItemStatus, PlanTargetKind } from '@main/lantern-plan-types';
import type { LanternPrState } from '@main/lantern-types';
import { VIEW } from '@shared/lantern-plan-messages';
import type { PlanMessageCode } from '@shared/lantern-plan-messages';

const STATUS_TEXT: Record<PlanItemStatus, PlanMessageCode> = {
  [ITEM_STATUS.PLANNED]: VIEW.STATUS_PLANNED,
  [ITEM_STATUS.IN_PROGRESS]: VIEW.STATUS_IN_PROGRESS,
  [ITEM_STATUS.IMPLEMENTED]: VIEW.STATUS_IMPLEMENTED,
  [ITEM_STATUS.VERIFIED]: VIEW.STATUS_VERIFIED,
};

const PR_STATE_TEXT: Record<LanternPrState, PlanMessageCode> = {
  open: VIEW.PR_STATE_OPEN,
  merged: VIEW.PR_STATE_MERGED,
  closed: VIEW.PR_STATE_CLOSED,
  declined: VIEW.PR_STATE_DECLINED,
};

const KIND_TEXT: Record<PlanTargetKind, PlanMessageCode> = {
  [TARGET_KIND.AREA]: VIEW.KIND_AREA,
  [TARGET_KIND.FEATURE]: VIEW.KIND_FEATURE,
  [TARGET_KIND.FILE]: VIEW.KIND_FILE,
  [TARGET_KIND.NEW]: VIEW.KIND_NEW,
};

export { KIND_TEXT, PR_STATE_TEXT, STATUS_TEXT };
