import { PLAN_LEVEL, PLAN_STATE, SECTION_STATE } from './plan-format.mjs';
import { ERROR, WARNING, say } from './plan-messages.mjs';
import { sectionIds } from './plan-model.mjs';
import { sectionDigest } from './plan-write.mjs';

export function sectionStates(plan) {
    return sectionIds(plan).map((section) => {
        const approval = plan.approvals.find((a) => a.section === section);
        if (!approval) return { section, state: SECTION_STATE.PENDING };
        const state = approval.digest === sectionDigest(plan, section) ? SECTION_STATE.APPROVED : SECTION_STATE.STALE;
        return { section, state, by: approval.by, date: approval.date };
    });
}

export function unapprovedSections(plan) {
    return sectionStates(plan).filter((s) => s.state !== SECTION_STATE.APPROVED);
}

export function isPlanApproved(plan) {
    return plan.approved !== null && unapprovedSections(plan).length === 0;
}

export function planState(plan) {
    return isPlanApproved(plan) ? PLAN_STATE.APPROVED : PLAN_STATE.DRAFT;
}

const OPEN_REASON = {
    [SECTION_STATE.STALE]: ERROR.OPEN_SECTION_STALE,
    [SECTION_STATE.PENDING]: ERROR.OPEN_SECTION_PENDING,
};

export function approvalProblems(plan) {
    const known = new Set(sectionIds(plan));
    const missing = plan.approvals.filter((a) => !known.has(a.section)).map((a) => say(ERROR.APPROVAL_NO_SECTION, { section: a.section, sections: [...known].join(', ') }));
    if (plan.approved === null) return { errors: missing, warnings: staleWarnings(plan) };
    const open = unapprovedSections(plan).map((s) => say(OPEN_REASON[s.state], { level: PLAN_LEVEL, section: s.section }));
    return { errors: [...missing, ...open], warnings: [] };
}

function staleWarnings(plan) {
    return sectionStates(plan)
        .filter((s) => s.state === SECTION_STATE.STALE)
        .map((s) => say(WARNING.SECTION_CHANGED, { section: s.section, by: s.by, date: s.date }));
}
