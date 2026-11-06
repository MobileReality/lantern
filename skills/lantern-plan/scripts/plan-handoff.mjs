import { isPlanApproved, unapprovedSections } from './plan-approval.mjs';
import { LINE, say } from './plan-messages.mjs';

export const MAX_DELEGATES = 3;

function itemBrief(plan, itemId) {
    const stage = plan.stages.find((s) => s.items.some((i) => i.id === itemId));
    const item = stage.items.find((i) => i.id === itemId);
    return { id: item.id, stage: stage.id, title: item.title, touches: [...stage.touches, ...item.touches], accept: item.accept };
}

const APPROVAL_BLOCKS = [
    [(plan) => plan.approved !== null, LINE.BLOCK_SECTIONS_LOST],
    [(plan, open) => open.length > 0, LINE.BLOCK_SECTIONS_OPEN],
    [() => true, LINE.BLOCK_RUN_APPROVE],
];

function blockers(plan, checked) {
    const reasons = [];
    if (!isPlanApproved(plan)) {
        const open = unapprovedSections(plan).map((s) => `${s.section} (${s.state})`);
        const [, code] = APPROVAL_BLOCKS.find(([applies]) => applies(plan, open));
        reasons.push(say(code, { open: open.join(', ') }));
    }
    reasons.push(...checked.errors.map((text) => say(LINE.BLOCK_CHECK, { text })));
    return reasons;
}

export function handoffOf(plan, status, checked) {
    const reasons = blockers(plan, checked);
    const next = status.next;
    const items = reasons.length || !next ? [] : next.ready.map((id) => itemBrief(plan, id));
    return {
        ok: reasons.length === 0,
        slug: plan.slug,
        reasons,
        done: next === null,
        stage: next?.stage ?? null,
        items,
        ask: reasons.length || !next ? [] : next.ask,
        waiting: next?.waiting ?? [],
        maxDelegates: MAX_DELEGATES,
    };
}

const NEXT_SUMMARIES = [
    [(r) => r.done, (r) => say(LINE.HANDOFF_NEXT_DONE)],
    [(r) => r.items.length > 0, (r) => say(LINE.HANDOFF_NEXT_READY, { stage: r.stage, ready: r.items.map((item) => item.id).join(', ') })],
    [(r) => r.ask.length > 0, (r) => say(LINE.HANDOFF_NEXT_ASK, { stage: r.stage, count: r.ask.length })],
    [() => true, (r) => say(LINE.HANDOFF_NEXT_WAITING, { stage: r.stage })],
];

export const nextSummary = (result) => NEXT_SUMMARIES.find(([applies]) => applies(result))[1](result);

function itemLines(slug, item) {
    const impacted = item.touches.map((t) => `${t.kind} ${t.target}`).join(', ');
    return [
        say(LINE.HANDOFF_ITEM, item),
        say(LINE.HANDOFF_IMPACTED, { impacted: impacted || say(LINE.NONE_NAMED) }),
        say(LINE.HANDOFF_VERIFY, { accept: item.accept }),
        say(LINE.HANDOFF_RECORD, { slug, id: item.id }),
    ];
}

const TAIL_BLOCKS = [
    [(r) => r.items.length > 0, (r) => [say(LINE.HANDOFF_DELEGATE, { max: r.maxDelegates }), ...r.items.flatMap((item) => itemLines(r.slug, item))]],
    [(r) => r.ask.length > 0, (r) => [say(LINE.HANDOFF_ASK, { stage: r.stage }), ...r.ask.map((q) => say(LINE.HANDOFF_QUESTION, q)), say(LINE.HANDOFF_RECORD_ANSWER, { slug: r.slug })]],
    [(r) => r.waiting.length > 0, (r) => [say(LINE.HANDOFF_WAITING, { waiting: r.waiting.join(', ') })]],
    [(r) => !r.items.length && !r.ask.length && !r.waiting.length, () => [say(LINE.HANDOFF_NOTHING_READY)]],
];

export function handoffLines(result) {
    if (!result.ok) return [say(LINE.HANDOFF_BLOCKED, { slug: result.slug }), ...result.reasons.map((text) => say(LINE.INDENT, { text }))];
    if (result.done) return [say(LINE.HANDOFF_DONE, { slug: result.slug })];
    return [say(LINE.HANDOFF_READY, { slug: result.slug, stage: result.stage }), ...TAIL_BLOCKS.filter(([applies]) => applies(result)).flatMap(([, lines]) => lines(result))];
}
