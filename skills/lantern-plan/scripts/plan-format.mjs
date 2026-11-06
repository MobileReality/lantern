import { NUMBER_PATTERN, PLAN_TAG, SLUG_PATTERN } from '../../lantern-setup/scripts/plan-ref.mjs';

export { ISO_DATE, PLAN_DIR, PLAN_EXT, PLAN_REF, isIsoDate } from '../../lantern-setup/scripts/plan-ref.mjs';

export const PLAN_HEADER = 'lantern-plan 1';
export const PLAN_LEVEL = 'plan';
export const DIGEST_LENGTH = 12;

export const TAG = Object.freeze({
    TITLE: 'title',
    OPENED: 'opened',
    GOAL: 'goal',
    SCOPE_IN: 'scope-in',
    SCOPE_OUT: 'scope-out',
    IMPACT: 'impact',
    STAGE: 'stage',
    ITEM: 'item',
    TOUCH: 'touch',
    ACCEPT: 'accept',
    QUESTION: 'question',
    ANSWER: 'answer',
    EXPLAIN: 'explain',
    STORY: 'story',
    STEP: 'step',
    BELOW: 'below',
    FILE: 'file',
    RISK: 'risk',
    APPROVED: 'approved',
    VERIFIED: 'verified',
    PLAN: PLAN_TAG,
});

export const SECTION = Object.freeze({ TITLE: 'title', GOAL: 'goal', SCOPE: 'scope', IMPACT: 'impact', RISKS: 'risks' });
export const SCOPE_SIDE = Object.freeze({ IN: 'in', OUT: 'out' });
export const TARGET_KIND = Object.freeze({ AREA: 'area', FEATURE: 'feature', FILE: 'file', NEW: 'new' });
export const ITEM_STATUS = Object.freeze({ PLANNED: 'planned', IN_PROGRESS: 'in progress', IMPLEMENTED: 'implemented', VERIFIED: 'verified' });
export const SECTION_STATE = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', STALE: 'stale' });
export const PLAN_STATE = Object.freeze({ DRAFT: 'draft', APPROVED: 'approved', BROKEN: 'broken' });
export const PR_STATE = Object.freeze({ OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' });
export const TARGET_KINDS = Object.freeze(Object.values(TARGET_KIND));

export const SLUG = new RegExp(`^${SLUG_PATTERN}$`);
export const STAGE_ID = new RegExp(`^s(${NUMBER_PATTERN})$`);
export const ITEM_ID = new RegExp(`^s(${NUMBER_PATTERN})\\.(${NUMBER_PATTERN})$`);
export const QUESTION_ID = new RegExp(`^s(${NUMBER_PATTERN})\\.q(${NUMBER_PATTERN})$`);
export const WHO = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;
export const DIGEST = new RegExp(`^[0-9a-f]{${DIGEST_LENGTH}}$`);
export function hasControlCharacter(text) {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code <= 0x1f || code === 0x7f) return true;
    }
    return false;
}
export const TAG_LINE = /^#([a-z][a-z-]*)(?:[ \t]+(.*?))?[ \t]*$/;
export const ID_LINE = /^#[ \t]+(\S+)[ \t]*$/;

export const LIMITS = Object.freeze({
    title: 100,
    goalLines: 3,
    goal: 200,
    scopeLines: 8,
    scope: 160,
    reason: 160,
    accept: 160,
    question: 200,
    answer: 2000,
    explain: 200,
    explainLines: 4,
    risk: 160,
    risks: 10,
});

export const isPathKind = (kind) => kind === TARGET_KIND.FILE || kind === TARGET_KIND.NEW;

export const tagLine = (tag, ...parts) => [`#${tag}`, ...parts].join(' ');
