import {
  DIGEST,
  ID_LINE,
  ITEM_ID,
  LIMITS,
  PLAN_DIR,
  PLAN_EXT,
  PLAN_HEADER,
  PLAN_LEVEL,
  QUESTION_ID,
  SLUG,
  STAGE_ID,
  TAG,
  TAG_LINE,
  TARGET_KINDS,
  WHO,
  hasControlCharacter,
  isIsoDate,
  isPathKind,
} from '@skills/lantern-plan/scripts/plan-format.mjs';
import { FLOW_TAGS, createFlowReader } from '@skills/lantern-plan/scripts/plan-flow.mjs';
import { decodePath } from './lantern-parse';
import { ERROR, NOUN, WARNING, located, say } from '@shared/lantern-plan-messages';
import type { PlanMessageCode } from '@shared/lantern-plan-messages';
import type { LanternPlan, PlanItem, PlanParseResult, PlanQuestion, PlanStage, PlanTargetKind } from './lantern-plan-types';

const UNENCODED_PERCENT = /%(?!20|23|25)/;
const KEEPS_QUESTION = new Set<string>([TAG.QUESTION, TAG.ANSWER, TAG.TOUCH, TAG.EXPLAIN, ...FLOW_TAGS]);
const readFlowLine = createFlowReader({ say, ERROR, NOUN, decodePath });

interface Draft {
  plan: LanternPlan;
  seen: Set<string>;
  stage: PlanStage | null;
  owner: PlanStage | PlanItem | null;
  question: PlanQuestion | null;
}

type Handler = (draft: Draft, raw: string) => string | null;
type TextRule = [(text: string, cap: number) => boolean, PlanMessageCode];
type TargetRule = [(kind: string, token: string) => boolean, (kind: string, token: string) => string];

const TEXT_RULES: TextRule[] = [
  [(text) => text === '', ERROR.TEXT_EMPTY],
  [(text) => hasControlCharacter(text), ERROR.TEXT_CONTROL],
  [(text, cap) => [...text].length > cap, ERROR.TEXT_TOO_LONG],
];

const TARGET_RULES: TargetRule[] = [
  [(kind) => !(TARGET_KINDS as readonly string[]).includes(kind), (kind) => say(ERROR.UNKNOWN_KIND, { kind, known: TARGET_KINDS.join(', ') })],
  [(_, token) => token === '', (kind) => say(ERROR.TARGET_MISSING, { kind })],
  [(kind, token) => isPathKind(kind) && UNENCODED_PERCENT.test(token), (_, token) => say(ERROR.BAD_PERCENT, { token })],
];

function emptyPlan(slug: string): LanternPlan {
  return { slug, title: '', opened: null, goal: [], scope: { in: [], out: [] }, impact: [], stages: [], risks: [], approvals: [], approved: null, verified: [] };
}

function splitWord(raw: string): [string, string] {
  const cut = raw.search(/\s/);
  return cut === -1 ? [raw, ''] : [raw.slice(0, cut), raw.slice(cut).trim()];
}

function textProblem(text: string, noun: PlanMessageCode, cap: number) {
  const rule = TEXT_RULES.find(([broken]) => broken(text, cap));
  return rule ? say(rule[1], { what: say(noun), length: [...text].length, cap }) : null;
}

function pushText(list: string[], raw: string, noun: PlanMessageCode, cap: number, max: number) {
  const problem = textProblem(raw, noun, cap) ?? (list.length >= max ? say(ERROR.TOO_MANY_LINES, { max, what: say(noun) }) : null);
  if (problem) return problem;
  list.push(raw);
  return null;
}

function targetOf(kind: string, token: string): { target: string } | { problem: string } {
  const rule = TARGET_RULES.find(([broken]) => broken(kind, token));
  if (rule) return { problem: rule[1](kind, token) };
  return { target: isPathKind(kind) ? decodePath(token) : token };
}

function addTouch(owner: PlanStage | PlanItem | PlanQuestion | null, raw: string) {
  const [kind, rest] = splitWord(raw);
  const [token, extra] = splitWord(rest);
  if (extra) return say(ERROR.TOUCH_SHAPE);
  const parsed = targetOf(kind, token);
  if ('problem' in parsed) return parsed.problem;
  if (!owner) return say(ERROR.TOUCH_ORPHAN);
  if (owner.touches.some((t) => t.kind === kind && t.target === parsed.target)) return say(ERROR.TOUCH_DUPLICATE, { kind, target: parsed.target });
  owner.touches.push({ kind: kind as PlanTargetKind, target: parsed.target });
  return null;
}

function singleton(draft: Draft, key: typeof TAG.TITLE | typeof TAG.OPENED, value: string) {
  if (draft.seen.has(key)) return say(ERROR.SINGLETON_DUPLICATE, { tag: key });
  draft.seen.add(key);
  draft.plan[key] = value;
  return null;
}

function answerProblem(question: PlanQuestion | null, by: string, text: string) {
  if (!question) return say(ERROR.ANSWER_ORPHAN);
  if (question.answer) return say(ERROR.ANSWER_DUPLICATE, { id: question.id });
  if (!WHO.test(by)) return say(ERROR.ANSWER_WHO);
  return textProblem(text, NOUN.ANSWER, LIMITS.answer);
}

function approvalProblem(level: boolean, by: string, date: string, digest: string) {
  if (!WHO.test(by) || !isIsoDate(date)) return say(ERROR.APPROVED_SHAPE);
  if (level) return digest === '' ? null : say(ERROR.APPROVED_LEVEL_DIGEST);
  return DIGEST.test(digest) ? null : say(ERROR.APPROVED_DIGEST);
}

const impact: Handler = (draft, raw) => {
  const [kind, rest] = splitWord(raw);
  const [token, reason] = splitWord(rest);
  const parsed = targetOf(kind, token);
  const problem = 'problem' in parsed ? parsed.problem : textProblem(reason, NOUN.REASON, LIMITS.reason);
  if (problem || 'problem' in parsed) return problem;
  if (draft.plan.impact.some((e) => e.kind === kind && e.target === parsed.target)) return say(ERROR.IMPACT_DUPLICATE, { kind, target: parsed.target });
  draft.plan.impact.push({ kind: kind as PlanTargetKind, target: parsed.target, reason });
  return null;
};

const stage: Handler = (draft, raw) => {
  const [id, title] = splitWord(raw);
  const problem = STAGE_ID.test(id) ? textProblem(title, NOUN.STAGE_TITLE, LIMITS.title) : say(ERROR.STAGE_ID, { id });
  if (problem) return problem;
  if (draft.plan.stages.some((s) => s.id === id)) return say(ERROR.STAGE_DUPLICATE, { id });
  draft.stage = { id, title, touches: [], items: [], questions: [] };
  draft.plan.stages.push(draft.stage);
  draft.owner = draft.stage;
  draft.question = null;
  return null;
};

const item: Handler = (draft, raw) => {
  const [id, title] = splitWord(raw);
  const match = ITEM_ID.exec(id);
  if (!draft.stage) return say(ERROR.ITEM_ORPHAN);
  const problem = match ? textProblem(title, NOUN.ITEM_TITLE, LIMITS.title) : say(ERROR.ITEM_ID, { id, stage: draft.stage.id });
  if (problem || !match) return problem;
  if (draft.plan.stages.some((s) => s.items.some((i) => i.id === id))) return say(ERROR.ITEM_DUPLICATE, { id });
  if (`s${match[1]}` !== draft.stage.id) return say(ERROR.ITEM_STAGE, { id, stage: draft.stage.id });
  const created: PlanItem = { id, title, touches: [], accept: null };
  draft.stage.items.push(created);
  draft.owner = created;
  draft.question = null;
  return null;
};

const accept: Handler = (draft, raw) => {
  const owner = draft.owner;
  if (!owner || 'items' in owner) return say(ERROR.ACCEPT_ORPHAN);
  if (owner.accept !== null) return say(ERROR.ACCEPT_DUPLICATE);
  const problem = textProblem(raw, NOUN.ACCEPT, LIMITS.accept);
  if (problem) return problem;
  owner.accept = raw;
  return null;
};

const question: Handler = (draft, raw) => {
  const [id, text] = splitWord(raw);
  if (!draft.stage) return say(ERROR.QUESTION_ORPHAN);
  const problem = QUESTION_ID.test(id) ? textProblem(text, NOUN.QUESTION, LIMITS.question) : say(ERROR.QUESTION_ID, { id, stage: draft.stage.id });
  if (problem) return problem;
  if (draft.plan.stages.some((s) => s.questions.some((q) => q.id === id))) return say(ERROR.QUESTION_DUPLICATE, { id });
  if (id.slice(0, id.indexOf('.')) !== draft.stage.id) return say(ERROR.QUESTION_STAGE, { id, stage: draft.stage.id });
  draft.question = { id, text, answer: null, touches: [], explain: [], flow: [] };
  draft.stage.questions.push(draft.question);
  draft.owner = null;
  return null;
};

const answer: Handler = (draft, raw) => {
  const [by, text] = splitWord(raw);
  const problem = answerProblem(draft.question, by, text);
  if (problem || !draft.question) return problem;
  draft.question.answer = { by, text };
  return null;
};

const approved: Handler = (draft, raw) => {
  const [section, rest] = splitWord(raw);
  const [by, rest2] = splitWord(rest);
  const [date, digest] = splitWord(rest2);
  const level = section === PLAN_LEVEL;
  const problem = approvalProblem(level, by, date, digest);
  if (problem) return problem;
  if (level) {
    if (draft.plan.approved) return say(ERROR.APPROVED_PLAN_DUPLICATE);
    draft.plan.approved = { by, date };
    return null;
  }
  if (draft.plan.approvals.some((a) => a.section === section)) return say(ERROR.APPROVED_DUPLICATE, { section });
  draft.plan.approvals.push({ section, by, date, digest });
  return null;
};

const verified: Handler = (draft, raw) => {
  const [itemId, rest] = splitWord(raw);
  const [by, date] = splitWord(rest);
  if (!ITEM_ID.test(itemId) || !WHO.test(by) || !isIsoDate(date)) return say(ERROR.VERIFIED_SHAPE);
  if (draft.plan.verified.some((v) => v.item === itemId)) return say(ERROR.VERIFIED_DUPLICATE, { item: itemId });
  draft.plan.verified.push({ item: itemId, by, date });
  return null;
};

const HANDLERS: Record<string, Handler> = {
  [TAG.TITLE]: (draft, raw) => textProblem(raw, NOUN.TITLE, LIMITS.title) ?? singleton(draft, TAG.TITLE, raw),
  [TAG.OPENED]: (draft, raw) => (isIsoDate(raw) ? singleton(draft, TAG.OPENED, raw) : say(ERROR.OPENED_DATE)),
  [TAG.GOAL]: (draft, raw) => pushText(draft.plan.goal, raw, NOUN.GOAL, LIMITS.goal, LIMITS.goalLines),
  [TAG.SCOPE_IN]: (draft, raw) => pushText(draft.plan.scope.in, raw, NOUN.SCOPE_IN, LIMITS.scope, LIMITS.scopeLines),
  [TAG.SCOPE_OUT]: (draft, raw) => pushText(draft.plan.scope.out, raw, NOUN.SCOPE_OUT, LIMITS.scope, LIMITS.scopeLines),
  [TAG.RISK]: (draft, raw) => pushText(draft.plan.risks, raw, NOUN.RISK, LIMITS.risk, LIMITS.risks),
  [TAG.IMPACT]: impact,
  [TAG.STAGE]: stage,
  [TAG.ITEM]: item,
  [TAG.TOUCH]: (draft, raw) => addTouch(draft.owner ?? draft.question, raw),
  [TAG.ACCEPT]: accept,
  [TAG.QUESTION]: question,
  [TAG.ANSWER]: answer,
  [TAG.EXPLAIN]: (draft, raw) => (draft.question ? pushText(draft.question.explain, raw, NOUN.EXPLAIN, LIMITS.explain, LIMITS.explainLines) : say(ERROR.QUESTION_LINE_ORPHAN)),
  ...Object.fromEntries(FLOW_TAGS.map((tag): [string, Handler] => [tag, (draft, raw) => (draft.question ? readFlowLine(draft.question, tag, raw) : say(ERROR.QUESTION_LINE_ORPHAN))])),
  [TAG.APPROVED]: approved,
  [TAG.VERIFIED]: verified,
};

function parsePlanFile(text: string, fileName: string): PlanParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const slug = fileName.endsWith(PLAN_EXT) ? fileName.slice(0, -PLAN_EXT.length) : null;
  const problems: string[] = [];
  const ignored: string[] = [];
  const fail = (error: string): PlanParseResult => ({ plan: null, error, problems, ignored });
  if (slug === null || !SLUG.test(slug)) return fail(say(ERROR.FILE_NAME));
  if (lines[0]?.trim() !== PLAN_HEADER) return fail(say(ERROR.FIRST_LINE, { header: PLAN_HEADER }));
  const draft: Draft = { plan: emptyPlan(slug), seen: new Set(), stage: null, owner: null, question: null };
  let id: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    const at = say(NOUN.LINE_AT, { number: i + 1 });
    if (!line) continue;
    if (!line.startsWith('#')) {
      problems.push(located(at, say(ERROR.NOT_PLAN_LINE, { line })));
      continue;
    }
    if (id === null) {
      const idLine = ID_LINE.exec(line);
      if (!idLine) return fail(located(at, say(ERROR.FIRST_HASH_LINE, { slug })));
      id = idLine[1];
      continue;
    }
    const tag = TAG_LINE.exec(line);
    if (!tag) {
      problems.push(located(at, say(ERROR.NOT_TAG_LINE, { line })));
      continue;
    }
    const handler = Object.hasOwn(HANDLERS, tag[1]) ? HANDLERS[tag[1]] : null;
    if (!handler) {
      ignored.push(located(at, say(WARNING.UNKNOWN_TAG, { tag: tag[1] })));
      continue;
    }
    const problem = handler(draft, tag[2] ?? '');
    if (problem) problems.push(located(at, say(ERROR.TAGGED, { tag: tag[1], text: problem })));
    if (!KEEPS_QUESTION.has(tag[1])) draft.question = null;
  }
  if (id === null) return fail(say(ERROR.MISSING_ID_LINE, { slug }));
  if (id !== slug) return fail(say(ERROR.ID_MISMATCH, { id, name: fileName }));
  return { plan: draft.plan, error: null, problems, ignored };
}

export { PLAN_DIR, PLAN_EXT, PLAN_HEADER, parsePlanFile };
export { isPlanApproved, planApprovalStates, planItemStatuses, planSectionDigest, planSectionIds, planSectionLines } from './lantern-plan-state';
export type { LanternPlan, PlanApproval, PlanApprovalState, PlanImpact, PlanItem, PlanItemStatus, PlanParseResult, PlanQuestion, PlanStage, PlanTargetKind, PlanTouch } from './lantern-plan-types';
