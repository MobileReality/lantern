import type { LanternPlanView, PlanQuestionView } from '../../main/lantern-plan-view-types';
import { LIMITS } from '@skills/lantern-plan/scripts/plan-format.mjs';
import { VIEW, say } from '../../shared/lantern-plan-messages';

type AskRequest = 'explain' | 'flow';

interface QuestionNote {
  answer: string;
  explain: number | null;
  flow: number | null;
}

interface PlanNotes {
  note(id: string): QuestionNote;
  all(): ReadonlyMap<string, QuestionNote>;
  setAnswer(id: string, text: string): void;
  setRequest(id: string, request: AskRequest, baseline: number | null): void;
  onChange(listener: () => void): () => void;
}

interface Ask {
  id: string;
  text: string;
  answer: string;
  explain: boolean;
  flow: boolean;
}

interface AskCounts {
  answered: number;
  total: number;
  answers: number;
  requests: number;
}

const NO_NOTE: QuestionNote = { answer: '', explain: null, flow: null };
const DEFAULT_MARK = /\bDefault:/;

const notebooks = new Map<string, PlanNotes>();

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

function splitQuestionText(text: string) {
  const cut = text.search(DEFAULT_MARK);
  return cut > 0 ? { main: text.slice(0, cut).trim(), fallback: text.slice(cut).trim() } : { main: text, fallback: '' };
}

function createNotes(): PlanNotes {
  const notes = new Map<string, QuestionNote>();
  const listeners = new Set<() => void>();
  const current = (id: string) => notes.get(id) ?? NO_NOTE;

  function commit(id: string, next: QuestionNote) {
    if (next.answer === '' && next.explain === null && next.flow === null) notes.delete(id);
    else notes.set(id, next);
    for (const listener of listeners) listener();
  }

  return {
    note: current,
    all: () => notes,
    setAnswer(id, text) {
      const answer = oneLine(text).slice(0, LIMITS.answer);
      if (answer !== current(id).answer) commit(id, { ...current(id), answer });
    },
    setRequest(id, request, baseline) {
      if (current(id)[request] !== baseline) commit(id, { ...current(id), [request]: baseline });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

function planNotes(project: string, slug: string): PlanNotes {
  const key = `${project}\u0000${slug}`;
  const known = notebooks.get(key);
  if (known) return known;
  const fresh = createNotes();
  notebooks.set(key, fresh);
  return fresh;
}

const questionsOf = (plan: LanternPlanView): PlanQuestionView[] => plan.stages.flatMap((stage) => stage.questions);

function askOf(question: PlanQuestionView, note: QuestionNote): Ask | null {
  const answer = note.answer === question.answer?.text ? '' : note.answer;
  const explain = note.explain === question.explain.length;
  const flow = note.flow === question.flow.length;
  return answer || explain || flow ? { id: question.id, text: oneLine(question.text), answer, explain, flow } : null;
}

function pendingAsks(plan: LanternPlanView, notes: ReadonlyMap<string, QuestionNote>): Ask[] {
  return questionsOf(plan).flatMap((question) => {
    const ask = askOf(question, notes.get(question.id) ?? NO_NOTE);
    return ask ? [ask] : [];
  });
}

function askCounts(plan: LanternPlanView, notes: ReadonlyMap<string, QuestionNote>): AskCounts {
  const questions = questionsOf(plan);
  const asks = pendingAsks(plan, notes);
  const typed = new Set(asks.filter((ask) => ask.answer).map((ask) => ask.id));
  return {
    answered: questions.filter((question) => question.answer !== null || typed.has(question.id)).length,
    total: questions.length,
    answers: typed.size,
    requests: asks.reduce((sum, ask) => sum + Number(ask.explain) + Number(ask.flow), 0),
  };
}

function askBlock(ask: Ask) {
  return [
    say(VIEW.COPY_QUESTION, { id: ask.id, text: ask.text }),
    ...(ask.answer ? [say(VIEW.COPY_ANSWER, { text: ask.answer })] : []),
    ...(ask.explain ? [say(VIEW.COPY_EXPLAIN, { id: ask.id })] : []),
    ...(ask.flow ? [say(VIEW.COPY_FLOW, { id: ask.id })] : []),
  ].join('\n');
}

function formatAsks(plan: LanternPlanView, asks: readonly Ask[]) {
  return [say(VIEW.COPY_HEADER, { slug: plan.slug, title: oneLine(plan.title) }), say(VIEW.COPY_SCOPE, { slug: plan.slug }), ...asks.map(askBlock)].join('\n\n');
}

function readyText(counts: AskCounts) {
  if (counts.answers + counts.requests === 0) return say(VIEW.READY_NONE);
  const parts = [
    ...(counts.answers ? [say(counts.answers === 1 ? VIEW.READY_ANSWERS_ONE : VIEW.READY_ANSWERS_MANY, { count: counts.answers })] : []),
    ...(counts.requests ? [say(counts.requests === 1 ? VIEW.READY_REQUESTS_ONE : VIEW.READY_REQUESTS_MANY, { count: counts.requests })] : []),
  ];
  return say(VIEW.READY_TEXT, { parts: parts.join(', ') });
}

export { askCounts, askOf, formatAsks, oneLine, pendingAsks, planNotes, questionsOf, readyText, splitQuestionText };
export type { Ask, AskCounts, AskRequest, PlanNotes, QuestionNote };
