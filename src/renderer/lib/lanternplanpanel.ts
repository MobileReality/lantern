import { ITEM_STATUS, PLAN_EXT, SECTION, SECTION_STATE, TARGET_KIND, isPathKind } from '@skills/lantern-plan/scripts/plan-format.mjs';
import type { PlanApprovalState, PlanTouch } from '@main/lantern-plan-types';
import type { LanternPlanView, PlanItemView, PlanPrRef, PlanQuestionView, PlanSectionMark, PlanStageView } from '@main/lantern-plan-view-types';
import { VIEW, say } from '@shared/lantern-plan-messages';
import type { PlanMessageCode } from '@shared/lantern-plan-messages';
import { esc } from './lanternctx';
import { fileLabelHtml } from './file-label';
import { namedCounts, planFocus, planPick, touchesOf } from './lanternplanfocus';
import type { PlanPick } from './lanternplanfocus';
import { IMPACT_ORIGIN } from './lanternplanimpact';
import type { ImpactMap } from './lanternplanimpact';
import { askCounts, questionsOf, readyText, splitQuestionText } from './lanternplananswers';
import type { QuestionNote } from './lanternplananswers';
import { KIND_TEXT, PR_STATE_TEXT, STATUS_TEXT } from './lanternplanwords';
import { fixBarHtml } from './lanternplanfix';
import type { PlanFix } from './lanternplanfix';

interface PlanPanelState {
  pick: PlanPick | null;
  selectablePrs: ReadonlySet<string>;
  shown: 'macro' | 'files';
  macroAvailable: boolean;
  folds: ReadonlyMap<string, boolean>;
  map?: ImpactMap | null;
  notes?: ReadonlyMap<string, QuestionNote>;
  copied?: boolean;
  textCopied?: boolean;
  fix?: PlanFix;
}

const RELATED_SHOWN = 20;

const FOLD = { STAGE: 'stage:', IMPACT: 'sec:impact', RISKS: 'sec:risks', APPROVALS: 'sec:approvals', PROBLEMS: 'sec:problems' } as const;
const FOLD_DEFAULT_OPEN: Record<typeof FOLD.IMPACT | typeof FOLD.RISKS | typeof FOLD.APPROVALS | typeof FOLD.PROBLEMS, boolean> = { [FOLD.IMPACT]: false, [FOLD.RISKS]: true, [FOLD.APPROVALS]: false, [FOLD.PROBLEMS]: true };

const STATE_TEXT: Record<PlanApprovalState | 'draft', PlanMessageCode> = {
  [SECTION_STATE.APPROVED]: VIEW.STATE_APPROVED,
  [SECTION_STATE.PENDING]: VIEW.STATE_PENDING,
  [SECTION_STATE.STALE]: VIEW.STATE_STALE,
  draft: VIEW.STATE_DRAFT,
};

const SECTION_TEXT: Record<string, PlanMessageCode> = {
  [SECTION.TITLE]: VIEW.SECTION_TITLE,
  [SECTION.GOAL]: VIEW.SECTION_GOAL,
  [SECTION.SCOPE]: VIEW.SECTION_SCOPE,
  [SECTION.IMPACT]: VIEW.SECTION_IMPACT,
  [SECTION.RISKS]: VIEW.SECTION_RISKS,
};

const stateWord = (state: PlanApprovalState | 'draft') => say(STATE_TEXT[state]);

function approvalTitle(mark: PlanSectionMark) {
  return mark.by && mark.date ? say(VIEW.APPROVAL_BY, { state: stateWord(mark.state), by: mark.by, date: mark.date }) : stateWord(mark.state);
}

function stateBadge(state: PlanApprovalState | 'draft', title = stateWord(state)) {
  return `<span class="pl-state pl-${state}" data-tip="${esc(title)}">${esc(stateWord(state))}</span>`;
}

function touchHtml(touch: PlanTouch) {
  const body = isPathKind(touch.kind) ? fileLabelHtml(touch.target) : `<span class="pl-target">${esc(touch.target)}</span>`;
  return `<li class="pl-touch pl-k-${touch.kind}"><em>${esc(say(KIND_TEXT[touch.kind]))}</em>${body}</li>`;
}

const touchList = (touches: readonly PlanTouch[]) => (touches.length ? `<ul class="pl-touches" aria-label="${esc(say(VIEW.TOUCHES))}">${touches.map(touchHtml).join('')}</ul>` : '');

function prLink(pr: PlanPrRef, state: PlanPanelState) {
  const label = say(VIEW.PR_LINK, { id: pr.id, state: say(PR_STATE_TEXT[pr.state]) });
  if (!state.selectablePrs.has(pr.id)) return `<span class="pl-pr pl-pr-${pr.state}" data-tip="${esc(say(VIEW.PR_NOTE_TITLE, { id: pr.id, title: pr.title }))}">${esc(label)}</span>`;
  return `<button class="pl-pr pl-pr-${pr.state}" data-plan-pr="${esc(pr.id)}" data-tip="${esc(say(VIEW.PR_LINK_TITLE, { id: pr.id, title: pr.title }))}">${esc(label)}</button>`;
}

function itemHtml(item: PlanItemView, state: PlanPanelState) {
  const picked = state.pick?.kind === 'item' && state.pick.item === item.id;
  const accept = item.accept ? `<p class="pl-accept">${esc(say(VIEW.ACCEPT, { accept: item.accept }))}</p>` : '';
  const prs = item.prs.length ? `<p class="pl-prs">${item.prs.map((pr) => prLink(pr, state)).join('')}</p>` : '';
  return (
    `<li class="pl-item${item.blocked ? ' pl-dim' : ''}" data-status="${esc(item.status)}"${item.blocked ? ` data-tip="${esc(say(VIEW.ITEM_BLOCKED))}"` : ''}>` +
    `<button class="pl-pick" data-plan-item="${esc(item.id)}" aria-pressed="${picked}" data-tip="${esc(say(VIEW.ITEM_PICK_TITLE, { id: item.id }))}"><b>${esc(item.id)}</b><span>${esc(item.title)}</span></button>` +
    `<span class="pl-status pl-s-${esc(item.status.replace(' ', '-'))}">${esc(say(STATUS_TEXT[item.status]))}</span>` +
    `${accept}${touchList(item.touches)}${prs}</li>`
  );
}

function questionHtml(question: PlanQuestionView, state: PlanPanelState) {
  const typed = state.notes?.get(question.id)?.answer ?? '';
  const drafted = typed !== '' && typed !== question.answer?.text;
  const tag = question.answer ? '' : `<span class="pl-open-tag">${esc(say(VIEW.QUESTION_OPEN))}</span>`;
  const answer = question.answer ? `<span class="pl-answer">${esc(say(VIEW.QUESTION_ANSWER, { by: question.answer.by, text: question.answer.text }))}</span>` : '';
  const draft = drafted ? `<span class="pl-answer pl-draft">${esc(say(VIEW.QUESTION_DRAFT, { text: typed }))}</span>` : '';
  const { main, fallback } = splitQuestionText(question.text);
  const rest = fallback ? `<span class="pl-qdefault">${esc(fallback)}</span>` : '';
  const open = `<button type="button" class="pl-qopen" data-plan-question="${esc(question.id)}" data-tip="${esc(say(VIEW.QUESTION_OPEN_TITLE, { id: question.id }))}">`;
  return `<li class="pl-question ${question.answer ? 'pl-answered' : 'pl-unanswered'}">${open}<span class="pl-qhead"><b>${esc(question.id)}</b>${tag}</span><span class="pl-qtext">${esc(main)}</span>${rest}${answer}${draft}</button></li>`;
}

function answersBar(plan: LanternPlanView, state: PlanPanelState) {
  if (!questionsOf(plan).length) return '';
  const counts = askCounts(plan, state.notes ?? new Map());
  const progress = say(VIEW.ANSWERS_PROGRESS, { answered: counts.answered, total: counts.total });
  const ready = counts.answers + counts.requests;
  const label = state.copied ? say(VIEW.COPIED) : say(VIEW.COPY);
  return (
    `<div class="pl-askbar" role="group" aria-label="${esc(say(VIEW.ANSWERS_LABEL))}"><p class="pl-askcount"><b>${esc(progress)}</b> <span role="status">${esc(readyText(counts))}</span></p>` +
    `<button type="button" class="lt-cm-pill pl-copy" data-plan-copy data-tip="${esc(say(VIEW.COPY_TITLE))}"${ready ? '' : ' disabled'}>${esc(label)}<span class="lt-cm-count">${ready}</span></button></div>`
  );
}

function openCount(stage: PlanStageView) {
  return stage.questions.filter((question) => question.answer === null).length;
}

function stageFlags(stage: PlanStageView) {
  const open = openCount(stage);
  const questions = say(open === 1 ? VIEW.QUESTIONS_ONE : VIEW.QUESTIONS_MANY, { count: open });
  const blocked = stage.blocked ? `<span class="pl-flag" data-tip="${esc(say(VIEW.STAGE_BLOCKED_TITLE, { questions }))}">${esc(say(VIEW.STAGE_BLOCKED))}</span>` : '';
  const done = stage.done ? `<span class="pl-flag pl-done">${esc(say(VIEW.STAGE_DONE))}</span>` : '';
  return `${done}${blocked}${stateBadge(stage.approval.state, approvalTitle(stage.approval))}`;
}

const finishedStatus = (item: PlanItemView) => item.status === ITEM_STATUS.IMPLEMENTED || item.status === ITEM_STATUS.VERIFIED;

function stageCounts(stage: PlanStageView) {
  const done = stage.items.filter(finishedStatus).length;
  const running = stage.items.filter((item) => item.status === ITEM_STATUS.IN_PROGRESS).length;
  const blocked = stage.items.filter((item) => item.blocked).length;
  return { done, running, blocked, planned: stage.items.length - done - running - blocked };
}

function summaryHtml(stage: PlanStageView) {
  const counts = stageCounts(stage);
  const entries: [string, PlanMessageCode, number][] = [
    ['done', VIEW.SUMMARY_DONE, counts.done],
    ['running', VIEW.SUMMARY_IN_PROGRESS, counts.running],
    ['blocked', VIEW.SUMMARY_BLOCKED, counts.blocked],
    ['planned', VIEW.SUMMARY_PLANNED, counts.planned],
  ];
  const shown = entries.filter(([, , count]) => count > 0).map(([kind, code, count]) => `<li class="pl-sum pl-sum-${kind}">${esc(say(code, { count }))}</li>`);
  const progress = say(VIEW.PROGRESS, { finished: counts.done, total: stage.items.length });
  return `<ul class="pl-summary" aria-label="${esc(progress)}">${shown.join('')}</ul><progress class="pl-progress" max="${stage.items.length}" value="${counts.done}" aria-label="${esc(progress)}"></progress>`;
}

const foldOpen = (state: PlanPanelState, key: string, fallback: boolean) => state.folds.get(key) ?? fallback;

function foldButton(key: string, open: boolean, label: string) {
  const title = say(open ? VIEW.FOLD_HIDE : VIEW.FOLD_SHOW, { what: label });
  return `<button class="pl-fold" data-plan-fold="${esc(key)}" aria-expanded="${open}" data-tip="${esc(title)}">${esc(label)}</button>`;
}

function blockedReason(stage: PlanStageView) {
  if (!stage.blocked) return '';
  const ids = stage.questions.filter((question) => question.answer === null).map((question) => question.id).join(', ');
  return `<p class="pl-reason">${esc(say(VIEW.STAGE_BLOCKED_BY, { ids }))}</p>`;
}

function stageHtml(stage: PlanStageView, state: PlanPanelState, open: boolean) {
  const picked = state.pick?.kind === 'stage' && state.pick.stage === stage.id;
  const key = `${FOLD.STAGE}${stage.id}`;
  const questions = stage.questions.length ? `<div class="pl-qbox"><h4>${esc(say(VIEW.HEAD_QUESTIONS))}</h4><ul class="pl-questions">${stage.questions.map((question) => questionHtml(question, state)).join('')}</ul></div>` : '';
  const title = `<button class="pl-pick" data-plan-stage="${esc(stage.id)}" aria-pressed="${picked}" data-tip="${esc(say(VIEW.STAGE_PICK_TITLE, { id: stage.id }))}"><b>${esc(stage.id)}</b><span>${esc(stage.title)}</span></button>`;
  const fold = `<button class="pl-fold pl-fold-stage" data-plan-fold="${esc(key)}" aria-expanded="${open}" data-tip="${esc(say(open ? VIEW.FOLD_HIDE : VIEW.FOLD_SHOW, { what: stage.id }))}" aria-label="${esc(say(open ? VIEW.FOLD_HIDE : VIEW.FOLD_SHOW, { what: stage.id }))}"></button>`;
  return (
    `<section class="pl-stage${stage.blocked ? ' pl-blocked' : ''}${stage.done ? ' pl-complete' : ''}${open ? ' is-open' : ''}" data-stage="${esc(stage.id)}">` +
    `<header><div class="pl-stage-top">${fold}${title}${stageFlags(stage)}</div><div class="pl-stage-sum">${summaryHtml(stage)}</div>${blockedReason(stage)}</header>` +
    `<div class="pl-stage-body"${open ? '' : ' hidden'}>${touchList(stage.touches)}${questions}<ul class="pl-items">${stage.items.map((item) => itemHtml(item, state)).join('')}</ul></div></section>`
  );
}

const lines = (texts: readonly string[]) => (texts.length ? `<ul class="pl-lines">${texts.map((text) => `<li>${esc(text)}</li>`).join('')}</ul>` : '');

function sectionHtml(state: PlanPanelState, key: keyof typeof FOLD_DEFAULT_OPEN, label: string, body: string) {
  const open = foldOpen(state, key, FOLD_DEFAULT_OPEN[key]);
  return `<section class="pl-sec pl-fold-sec" data-sec="${esc(key)}"><h2>${foldButton(key, open, label)}</h2><div class="pl-sec-body"${open ? '' : ' hidden'}>${body}</div></section>`;
}

const plainSection = (label: string, body: string) => `<section class="pl-sec"><h2>${esc(label)}</h2>${body}</section>`;

const KIND_ORDER = [TARGET_KIND.AREA, TARGET_KIND.FEATURE, TARGET_KIND.FILE, TARGET_KIND.NEW];

function impactRow(entry: LanternPlanView['impact'][number]) {
  const name = isPathKind(entry.kind) ? fileLabelHtml(entry.target) : `<span class="pl-target">${esc(entry.target)}</span>`;
  return `<li class="pl-touch pl-k-${entry.kind}"><em>${esc(say(KIND_TEXT[entry.kind]))}</em><span class="pl-name">${name}</span><small>${esc(entry.reason)}</small></li>`;
}

function impactGroups(plan: LanternPlanView) {
  return KIND_ORDER.flatMap((kind) => {
    const entries = plan.impact.filter((entry) => entry.kind === kind);
    if (!entries.length) return [];
    return [`<h3>${esc(say(VIEW.IMPACT_GROUP, { kind: say(KIND_TEXT[kind]), count: entries.length }))}</h3><ul class="pl-touches pl-impact">${entries.map(impactRow).join('')}</ul>`];
  });
}

function relatedRow(path: string) {
  return `<li class="pl-touch pl-k-related"><em>${esc(say(VIEW.KIND_RELATED))}</em><span class="pl-name">${fileLabelHtml(path)}</span></li>`;
}

function relatedGroup(plan: LanternPlanView, state: PlanPanelState) {
  const related = (planFocus(plan, planPick(plan.slug), state.map ?? null)?.files ?? []).filter((file) => file.origin === IMPACT_ORIGIN.DERIVED);
  if (!related.length) return [];
  const more = related.length > RELATED_SHOWN ? `<p class="pl-none">${esc(say(VIEW.IMPACT_RELATED_MORE, { count: related.length - RELATED_SHOWN }))}</p>` : '';
  return [
    `<h3>${esc(say(VIEW.IMPACT_RELATED, { count: related.length }))}</h3><p class="pl-note">${esc(say(VIEW.IMPACT_RELATED_NOTE))}</p>` +
      `<ul class="pl-touches pl-impact pl-related">${related.slice(0, RELATED_SHOWN).map((file) => relatedRow(file.path)).join('')}</ul>${more}`,
  ];
}

function impactHtml(plan: LanternPlanView, state: PlanPanelState) {
  const picked = state.pick?.kind === 'plan';
  const groups = [...impactGroups(plan), ...relatedGroup(plan, state)];
  const body = groups.length ? groups.join('') : `<p class="pl-none">${esc(say(VIEW.IMPACT_NONE))}</p>`;
  const button = groups.length ? `<button class="pl-pick pl-pick-impact" data-plan-impact aria-pressed="${picked}" data-tip="${esc(say(VIEW.IMPACT_PICK_TITLE))}">${esc(say(VIEW.IMPACT_PICK))}</button>` : '';
  return sectionHtml(state, FOLD.IMPACT, say(VIEW.HEAD_IMPACT), `${button}${body}`);
}

function approvalsHtml(plan: LanternPlanView, state: PlanPanelState) {
  const marks = plan.sections.filter((mark) => Object.hasOwn(SECTION_TEXT, mark.section));
  const rows = marks.map((mark) => `<li data-tip="${esc(approvalTitle(mark))}"><span>${esc(say(SECTION_TEXT[mark.section]))}</span>${stateBadge(mark.state, approvalTitle(mark))}</li>`);
  const approved = marks.filter((mark) => mark.state === SECTION_STATE.APPROVED).length;
  const summary = `<p class="pl-approval-sum"><b>${esc(say(VIEW.APPROVALS_COUNT, { approved, total: marks.length }))}</b> ${esc(overallApproval(plan))}</p>`;
  return sectionHtml(state, FOLD.APPROVALS, say(VIEW.HEAD_APPROVALS), `${summary}<ul class="pl-approvals">${rows.join('')}</ul>`);
}

const overallApproval = (plan: LanternPlanView) => (plan.approved ? say(VIEW.APPROVED_BY, { by: plan.approved.by, date: plan.approved.date }) : say(VIEW.NOT_APPROVED));

function staleNote(plan: LanternPlanView) {
  if (plan.lifecycle !== 'stale') return '';
  const edited = plan.sections.filter((mark) => mark.state === SECTION_STATE.STALE);
  const open = (edited.length ? edited : plan.sections.filter((mark) => mark.state !== SECTION_STATE.APPROVED)).map((mark) => (Object.hasOwn(SECTION_TEXT, mark.section) ? say(SECTION_TEXT[mark.section]) : mark.section));
  return `<p class="pl-edited" role="note">${esc(say(VIEW.STALE_NOTE, { sections: open.join(', ') }))}</p>`;
}

function pickNote(plan: LanternPlanView, state: PlanPanelState) {
  if (!state.pick) return '';
  const named = namedCounts(touchesOf(plan, state.pick));
  const related = planFocus(plan, state.pick, state.map ?? null)?.related.size ?? 0;
  const parts = [
    say(named.areas === 1 ? VIEW.COUNT_AREAS_ONE : VIEW.COUNT_AREAS_MANY, { count: named.areas }),
    say(named.features === 1 ? VIEW.COUNT_FEATURES_ONE : VIEW.COUNT_FEATURES_MANY, { count: named.features }),
    say(named.files === 1 ? VIEW.COUNT_FILES_ONE : VIEW.COUNT_FILES_MANY, { count: named.files }),
    ...(named.fresh ? [say(named.fresh === 1 ? VIEW.COUNT_NEW_ONE : VIEW.COUNT_NEW_MANY, { count: named.fresh })] : []),
    ...(related ? [say(related === 1 ? VIEW.COUNT_RELATED_ONE : VIEW.COUNT_RELATED_MANY, { count: related })] : []),
  ];
  const none = named.areas + named.features + named.files + named.fresh === 0;
  const listed = parts.join(', ');
  const text = none ? say(VIEW.PICK_EMPTY) : state.shown === 'files' && named.files + named.fresh === 0 ? `${say(VIEW.PICK_FILES_NONE, { named: listed })}${state.macroAvailable ? ` ${say(VIEW.MACRO_HINT)}` : ''}` : say(VIEW.PICK_NOTE, { named: listed });
  return `<p class="pl-pickrow" role="status">${esc(text)} <button class="pl-clear" data-plan-clear>${esc(say(VIEW.PICK_CLEAR))}</button></p>`;
}

function problemsNote(plan: LanternPlanView, state: PlanPanelState) {
  if (!plan.problems.length) return '';
  const label = say(plan.problems.length === 1 ? VIEW.PROBLEMS_ONE : VIEW.PROBLEMS_MANY, { count: plan.problems.length });
  const open = foldOpen(state, FOLD.PROBLEMS, FOLD_DEFAULT_OPEN[FOLD.PROBLEMS]);
  const title = esc(say(open ? VIEW.FOLD_HIDE : VIEW.FOLD_SHOW, { what: say(VIEW.HEAD_PROBLEMS) }));
  const fold = `<button type="button" class="pl-fold" data-plan-fold="${FOLD.PROBLEMS}" aria-expanded="${open}" data-tip="${title}">${esc(label)}</button>`;
  const list = `<ul class="pl-problem-list">${plan.problems.map((problem) => `<li>${esc(problem)}</li>`).join('')}</ul>`;
  const bar = state.fix ? fixBarHtml(state.fix, `${plan.slug}${PLAN_EXT}`) : '';
  return `<section class="pl-problems" role="note">${fold}<div class="pl-sec-body"${open ? '' : ' hidden'}>${list}</div>${bar}</section>`;
}

function progressText(plan: LanternPlanView) {
  return plan.total ? say(VIEW.PROGRESS, { finished: plan.finished, total: plan.total }) : say(VIEW.PROGRESS_NONE);
}

function stagesHtml(plan: LanternPlanView, state: PlanPanelState) {
  const current = plan.stages.findIndex((stage) => !stage.done);
  const cards = plan.stages.map((stage, index) => stageHtml(stage, state, foldOpen(state, `${FOLD.STAGE}${stage.id}`, stage.blocked || index === current)));
  return plainSection(say(VIEW.HEAD_STAGES), cards.length ? cards.join('') : `<p class="pl-none">${esc(say(VIEW.NO_STAGES))}</p>`);
}

function scopeHtml(plan: LanternPlanView) {
  if (!plan.scope.in.length && !plan.scope.out.length) return '';
  const inside = plan.scope.in.length ? `<h3>${esc(say(VIEW.SCOPE_IN))}</h3>${lines(plan.scope.in)}` : '';
  const outside = plan.scope.out.length ? `<h3>${esc(say(VIEW.SCOPE_OUT))}</h3>${lines(plan.scope.out)}` : '';
  return plainSection(say(VIEW.HEAD_SCOPE), `${inside}${outside}`);
}

function copyPlanButton(state: PlanPanelState) {
  const label = say(state.textCopied ? VIEW.COPIED : VIEW.COPY_PLAN);
  return `<button type="button" class="lt-cm-pill pl-copy-plan" data-plan-copy-text data-tip="${esc(say(VIEW.COPY_PLAN_TITLE))}">${esc(label)}</button>`;
}

function planHeadHtml(plan: LanternPlanView, state: PlanPanelState) {
  const meta = plan.opened ? say(VIEW.META, { slug: plan.slug, date: plan.opened }) : plan.slug;
  const progress = plan.total ? `<progress class="pl-progress" max="${plan.total}" value="${plan.finished}" aria-label="${esc(progressText(plan))}"></progress>` : '';
  return (
    `<header class="pl-head pl-${plan.lifecycle}">` +
    `<div class="pl-id">${stateBadge(plan.lifecycle)}<span>${esc(meta)}</span>${copyPlanButton(state)}<button class="pr-back" data-plan-close data-tip="${esc(say(VIEW.PANEL_CLOSE_TITLE))}">${esc(say(VIEW.PANEL_CLOSE))}</button></div>` +
    `<h1 class="pl-title">${esc(plan.title)}</h1>` +
    `<div class="pl-head-meta">${progress}<p class="pl-meta">${esc(progressText(plan))}</p><p class="pl-meta">${esc(overallApproval(plan))}</p></div>` +
    `</header>`
  );
}

function planPanelHtml(plan: LanternPlanView, state: PlanPanelState) {
  const goal = plan.goal.length ? plainSection(say(VIEW.HEAD_GOAL), lines(plan.goal)) : '';
  const risks = plan.risks.length ? sectionHtml(state, FOLD.RISKS, say(VIEW.HEAD_RISKS), lines(plan.risks)) : '';
  return (
    `<section class="pl-panel" aria-label="${esc(say(VIEW.PANEL_LABEL, { slug: plan.slug }))}">` +
    `${planHeadHtml(plan, state)}<div class="pl-content">${staleNote(plan)}${problemsNote(plan, state)}${answersBar(plan, state)}${pickNote(plan, state)}` +
    `${goal}${scopeHtml(plan)}${stagesHtml(plan, state)}${impactHtml(plan, state)}${risks}${approvalsHtml(plan, state)}` +
    `<p class="pl-readonly">${esc(say(VIEW.READ_ONLY))}</p></div></section>`
  );
}

export { planPanelHtml };
export type { PlanPanelState };
