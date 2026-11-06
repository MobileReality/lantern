import { describe, expect, it } from 'vitest';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import type { LanternPlanView } from '../src/main/lantern-plan-view-types';
import { askCounts, formatAsks, pendingAsks, planNotes, readyText, splitQuestionText } from '../src/renderer/lib/lanternplananswers';
import type { QuestionNote } from '../src/renderer/lib/lanternplananswers';
import { planFileMarks, planFocus, questionPick, samePick, stagePick, touchesOf } from '../src/renderer/lib/lanternplanfocus';
import { EXAMPLE, fixtureText } from './helpers/lantern-plan-world';

function view(source = fixtureText(EXAMPLE)): LanternPlanView {
  const parsed = parsePlanFile(source, `${EXAMPLE}.plan`);
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, [], parsed.problems);
}

const note = (answer = '', explain: number | null = null, flow: number | null = null): QuestionNote => ({ answer, explain, flow });
const notes = (entries: Record<string, QuestionNote>) => new Map(Object.entries(entries));

describe('the text to paste into Claude Code', () => {
  it('carries only one question and the agent instruction when given a single ask', () => {
    const plan = view();
    const all = pendingAsks(plan, notes({ 's1.q1': note('First.', 0), 's2.q1': note('Second.') }));
    const copy = formatAsks(plan, [all[0]]);
    expect(copy).toContain('s1.q1:');
    expect(copy).toContain('Answer: First.');
    expect(copy).toContain('Request: explain s1.q1 more');
    expect(copy).toContain('lantern-plan skill');
    expect(copy).not.toContain('s2.q1:');
  });

  it('names the plan and, per question, its id and the answer, and says what the agent does with them', () => {
    const plan = view();
    const book = planNotes('asks-text', plan.slug);
    book.setAnswer('s2.q1', 'Beside   the\nmap.');
    const copy = formatAsks(plan, pendingAsks(plan, book.all()));
    expect(copy).toContain('Lantern plan plan-on-the-map: answers and requests for "Show a plan\'s stages and progress on the Lantern map"');
    expect(copy).toContain('s2.q1: Does the stage list sit in the review pane or beside the macro view?\nAnswer: Beside the map.');
    expect(copy).toContain('lantern-plan skill');
    expect(copy).toContain('plan.mjs add plan-on-the-map answer <question id> <who> <answer>');
    expect(copy).toMatch(/add any new question the answers raise to the stage it blocks, and list the questions still open/);
  });

  it('carries a request to explain more and a request to draw the flow, in the words the agent is told to read', () => {
    const plan = view();
    const copy = formatAsks(plan, pendingAsks(plan, notes({ 's1.q1': note('', 0, 0) })));
    expect(copy).toContain('s1.q1: Do plans on other branches show, or only the checked-out one?\nRequest: explain s1.q1 more\nRequest: draw the flow for s1.q1');
    expect(copy).not.toContain('Answer:');
  });

  it('lists the questions in plan order, whatever order they were answered in', () => {
    const plan = view();
    const copy = formatAsks(plan, pendingAsks(plan, notes({ 's2.q1': note('Second.'), 's1.q1': note('First.') })));
    expect(copy.indexOf('s1.q1:')).toBeLessThan(copy.indexOf('s2.q1:'));
  });

  it('leaves out an answer the plan already holds, and a request the plan has met since', () => {
    const plan = view();
    const held = plan.stages[0].questions[0].answer!.text;
    const lines = plan.stages[1].questions[0].explain.length;
    expect(pendingAsks(plan, notes({ 's1.q1': note(held) }))).toEqual([]);
    expect(pendingAsks(plan, notes({ 's2.q1': note('', lines - 1) }))).toEqual([]);
    expect(pendingAsks(plan, notes({ 's2.q1': note('', lines) }))).toHaveLength(1);
  });

  it('counts the questions answered in the plan or here, the answers and the requests ready to copy', () => {
    const plan = view();
    const counts = askCounts(plan, notes({ 's2.q1': note('Beside it.', 2, null), 's1.q1': note('Changed my mind.') }));
    expect(counts).toEqual({ answered: 2, total: 2, answers: 2, requests: 1 });
    expect(readyText(counts)).toBe('Ready to copy: 2 answers, 1 request');
    expect(readyText(askCounts(plan, notes({})))).toBe('Nothing to copy yet. Click a question to answer it.');
    expect(askCounts(plan, notes({})).answered).toBe(1);
  });
});

describe('the answers of a plan are kept for the session, per project and plan', () => {
  it('is the same notebook for the same project and plan, and a different one for another', () => {
    expect(planNotes('proj-a', 'p')).toBe(planNotes('proj-a', 'p'));
    expect(planNotes('proj-a', 'p')).not.toBe(planNotes('proj-b', 'p'));
    expect(planNotes('proj-a', 'p')).not.toBe(planNotes('proj-a', 'q'));
  });

  it('folds an answer to one line, forgets an emptied note and tells its listeners', () => {
    const book = planNotes('proj-notes', 'p');
    let calls = 0;
    const stop = book.onChange(() => calls++);
    book.setAnswer('s1.q1', '  Yes,\n  keep it.  ');
    expect(book.note('s1.q1').answer).toBe('Yes, keep it.');
    book.setAnswer('s1.q1', 'Yes, keep it.');
    expect(calls).toBe(1);
    book.setAnswer('s1.q1', '');
    expect(book.all().size).toBe(0);
    stop();
    book.setAnswer('s1.q1', 'x');
    expect(calls).toBe(2);
  });
});

describe("a question's default is shown apart from the question", () => {
  it('cuts the text at "Default:"', () => {
    expect(splitQuestionText('Which one? Default: the first.')).toEqual({ main: 'Which one?', fallback: 'Default: the first.' });
    expect(splitQuestionText('Which one?')).toEqual({ main: 'Which one?', fallback: '' });
  });
});

describe('Show on the plan: a question as the pick', () => {
  const kinds = (plan: LanternPlanView, id: string) => touchesOf(plan, questionPick(plan.slug, id)).map((touch) => `${touch.kind} ${touch.target}`);

  it('names what the question touches and the files its flow points at', () => {
    const plan = view();
    expect(kinds(plan, 's1.q1')).toEqual(['file src/main/lantern.ts']);
    expect(kinds(plan, 's2.q1')).toEqual(['file src/renderer/lib/macroview/mount.ts']);
  });

  it('falls back to the stage and its items when the question names nothing', () => {
    const plan = view(fixtureText(EXAMPLE).replace('#touch file src/main/lantern.ts\n#answer', '#answer'));
    expect(kinds(plan, 's1.q1')).toEqual(touchesOf(plan, stagePick(plan.slug, 's1')).map((touch) => `${touch.kind} ${touch.target}`));
    expect(kinds(plan, 's1.q1').length).toBeGreaterThan(1);
  });

  it("marks the question's files the way a stage or an item marks theirs", () => {
    const plan = view();
    const focus = planFocus(plan, questionPick(plan.slug, 's1.q1'), null);
    expect(focus?.label).toBe('question s1.q1');
    expect([...(focus?.paths ?? [])]).toEqual(['src/main/lantern.ts']);
    expect([...(planFileMarks(focus) ?? [])]).toEqual([['src/main/lantern.ts', '~']]);
  });

  it('marks a new file of a flow as new, when the impact section describes it', () => {
    const plan = view(fixtureText(EXAMPLE).replace('#file src/renderer/lib/macroview/mount.ts', '#file src/main/lantern-plans.ts'));
    expect(kinds(plan, 's2.q1')).toContain('new src/main/lantern-plans.ts');
  });

  it('picks one question apart from another and from its stage', () => {
    expect(samePick(questionPick('p', 's1.q1'), questionPick('p', 's1.q1'))).toBe(true);
    expect(samePick(questionPick('p', 's1.q1'), questionPick('p', 's2.q1'))).toBe(false);
    expect(samePick(questionPick('p', 's1.q1'), stagePick('p', 's1'))).toBe(false);
  });
});
