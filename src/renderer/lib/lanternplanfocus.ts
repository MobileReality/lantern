import { TARGET_KIND } from '@skills/lantern-plan/scripts/plan-format.mjs';
import type { LanternPlanView, PlanQuestionView, PlanStageView } from '@main/lantern-plan-view-types';
import type { PlanTouch } from '@main/lantern-plan-types';
import { VIEW, say } from '@shared/lantern-plan-messages';
import type { PlanMessageCode } from '@shared/lantern-plan-messages';
import { IMPACT_ORIGIN, newPurposes, planImpactFiles } from './lanternplanimpact';
import type { ImpactFile, ImpactMap } from './lanternplanimpact';
import type { FileMark } from './lanternprpanel';

type PlanPick = { slug: string } & ({ kind: 'plan' } | { kind: 'stage'; stage: string } | { kind: 'item'; item: string } | { kind: 'question'; question: string });

interface PlanFocus {
  label: string;
  paths: ReadonlySet<string>;
  ids: ReadonlySet<string>;
  fresh: ReadonlyMap<string, string>;
  related: ReadonlySet<string>;
  files: readonly ImpactFile[];
}

const planPick = (slug: string): PlanPick => ({ slug, kind: 'plan' });
const stagePick = (slug: string, stage: string): PlanPick => ({ slug, kind: 'stage', stage });
const itemPick = (slug: string, item: string): PlanPick => ({ slug, kind: 'item', item });
const questionPick = (slug: string, question: string): PlanPick => ({ slug, kind: 'question', question });

function pickId(pick: PlanPick) {
  if (pick.kind === 'stage') return pick.stage;
  if (pick.kind === 'item') return pick.item;
  if (pick.kind === 'question') return pick.question;
  return '';
}

function samePick(a: PlanPick | null, b: PlanPick | null) {
  if (!a || !b) return a === b;
  return a.slug === b.slug && a.kind === b.kind && pickId(a) === pickId(b);
}

const stageTouches = (stage: PlanStageView): PlanTouch[] => [...stage.touches, ...stage.items.flatMap((item) => item.touches)];

function flowFiles(question: PlanQuestionView, impact: LanternPlanView['impact']): PlanTouch[] {
  const fresh = new Set(impact.filter((entry) => entry.kind === TARGET_KIND.NEW).map((entry) => entry.target));
  const paths = new Set(question.flow.flatMap((story) => [...story.steps, ...story.below]).flatMap((step) => step.files ?? []));
  return [...paths].map((target): PlanTouch => ({ kind: fresh.has(target) ? TARGET_KIND.NEW : TARGET_KIND.FILE, target }));
}

function questionTouches(plan: LanternPlanView, id: string): PlanTouch[] {
  const stage = plan.stages.find((each) => each.questions.some((question) => question.id === id));
  const question = stage?.questions.find((each) => each.id === id);
  if (!stage || !question) return [];
  const own = [...question.touches, ...flowFiles(question, plan.impact)].filter((touch, at, all) => all.findIndex((other) => other.kind === touch.kind && other.target === touch.target) === at);
  return own.length ? own : stageTouches(stage);
}

function touchesOf(plan: LanternPlanView, pick: PlanPick): PlanTouch[] {
  if (pick.kind === 'plan') return plan.impact;
  if (pick.kind === 'stage') return plan.stages.filter((stage) => stage.id === pick.stage).flatMap(stageTouches);
  if (pick.kind === 'question') return questionTouches(plan, pick.question);
  return plan.stages.flatMap((stage) => stage.items).filter((item) => item.id === pick.item).flatMap((item) => item.touches);
}

const LABEL_OF: Record<Exclude<PlanPick['kind'], 'plan'>, PlanMessageCode> = { stage: VIEW.FOCUS_STAGE, item: VIEW.FOCUS_ITEM, question: VIEW.FOCUS_QUESTION };

function labelOf(pick: PlanPick) {
  if (pick.kind === 'plan') return say(VIEW.FOCUS_PLAN, { slug: pick.slug });
  return say(LABEL_OF[pick.kind], { id: pickId(pick) });
}

const pathsFrom = (files: readonly ImpactFile[], origin: ImpactFile['origin']) => files.filter((file) => file.origin === origin).map((file) => file.path);

function planFocus(plan: LanternPlanView | undefined, pick: PlanPick | null, map: ImpactMap | null = null): PlanFocus | null {
  if (!plan || !pick || pick.slug !== plan.slug) return null;
  const touches = touchesOf(plan, pick);
  if (touches.length === 0) return null;
  const files = planImpactFiles(touches, newPurposes(plan.impact), map);
  const blocks = touches.filter((touch) => touch.kind === TARGET_KIND.AREA || touch.kind === TARGET_KIND.FEATURE).map((touch) => touch.target);
  return {
    label: labelOf(pick),
    paths: new Set(pathsFrom(files, IMPACT_ORIGIN.NAMED)),
    ids: new Set(blocks),
    fresh: new Map(files.filter((file) => file.origin === IMPACT_ORIGIN.NEW).map((file) => [file.path, file.purpose])),
    related: new Set(pathsFrom(files, IMPACT_ORIGIN.DERIVED)),
    files,
  };
}

function namedCounts(touches: readonly PlanTouch[]) {
  const count = (kind: string) => new Set(touches.filter((touch) => touch.kind === kind).map((touch) => touch.target)).size;
  return { areas: count(TARGET_KIND.AREA), features: count(TARGET_KIND.FEATURE), files: count(TARGET_KIND.FILE), fresh: count(TARGET_KIND.NEW) };
}

function planFileMarks(focus: PlanFocus | null): ReadonlyMap<string, FileMark> | null {
  if (!focus) return null;
  const marks = new Map<string, FileMark>();
  for (const path of focus.related) marks.set(path, 'related');
  for (const path of focus.paths) marks.set(path, '~');
  for (const path of focus.fresh.keys()) marks.set(path, '+');
  return marks.size ? marks : null;
}

function planFilePaths(focus: PlanFocus): ReadonlySet<string> {
  return new Set(focus.files.map((file) => file.path));
}

export { itemPick, namedCounts, planFileMarks, planFilePaths, planFocus, planPick, questionPick, samePick, stagePick, touchesOf };
export type { PlanFocus, PlanPick };
