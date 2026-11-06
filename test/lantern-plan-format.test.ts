import { beforeAll, describe, expect, it } from 'vitest';
import { isPlanApproved, parsePlanFile, planApprovalStates, planItemStatuses, planSectionDigest, planSectionIds } from '../src/main/lantern-plan';
import type { LanternPlan } from '../src/main/lantern-plan';
import { DRAFT, EXAMPLE, fixtureText, importScript } from './helpers/lantern-plan-world';

interface SkillParse {
  plan: LanternPlan;
  errors: string[];
  warnings: string[];
}

interface Mods {
  parse: { parsePlan: (text: string, file: string) => SkillParse };
  write: { serializePlan: (plan: LanternPlan) => string; sectionDigest: (plan: LanternPlan, id: string) => string };
  approval: { sectionStates: (plan: LanternPlan) => { section: string; state: string; by?: string; date?: string }[]; isPlanApproved: (plan: LanternPlan) => boolean };
  status: { deriveStatus: (plan: LanternPlan, links: { item: string; state: string }[]) => { stages: { items: { id: string; status: string }[] }[] } };
  model: { sectionIds: (plan: LanternPlan) => string[] };
}

let mods: Mods;

beforeAll(async () => {
  mods = {
    parse: await importScript('plan-parse.mjs'),
    write: await importScript('plan-write.mjs'),
    approval: await importScript('plan-approval.mjs'),
    status: await importScript('plan-status.mjs'),
    model: await importScript('plan-model.mjs'),
  };
});

const skill = (text: string, name = 'p.plan') => mods.parse.parsePlan(text, `.lantern/plans/${name}`);
const app = (text: string, name = 'p.plan') => parsePlanFile(text, name);
const BASE = ['lantern-plan 1', '# p', '#title A plan', '#opened 2026-10-26', '#goal Do the thing.', '#scope-in The thing.', '#impact feature f Because.', '#stage s1 First', '#item s1.1 One', '#touch file a.ts', '#accept It works.'];
const text = (...lines: string[]) => `${lines.join('\n')}\n`;

describe.each([EXAMPLE, DRAFT])('fixture %s: both parsers read the same plan', (name) => {
  it('parses clean and writes back byte for byte', () => {
    const source = fixtureText(name);
    const parsed = skill(source, `${name}.plan`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(mods.write.serializePlan(parsed.plan)).toBe(source);
  });

  it('gives the app reader the same typed object', () => {
    const source = fixtureText(name);
    const result = app(source, `${name}.plan`);
    expect(result.error).toBeNull();
    expect(result.problems).toEqual([]);
    expect(result.plan).toEqual(skill(source, `${name}.plan`).plan);
  });

  it('agrees on section ids, digests and approval states', () => {
    const source = fixtureText(name);
    const plan = skill(source, `${name}.plan`).plan;
    const reader = app(source, `${name}.plan`).plan!;
    expect(planSectionIds(reader)).toEqual(mods.model.sectionIds(plan));
    for (const id of planSectionIds(reader)) expect(planSectionDigest(reader, id)).toBe(mods.write.sectionDigest(plan, id));
    expect(planApprovalStates(reader)).toEqual(mods.approval.sectionStates(plan));
    expect(isPlanApproved(reader)).toBe(mods.approval.isPlanApproved(plan));
  });
});

describe('the worked example', () => {
  it('is fully approved, with an answered and an open question', () => {
    const plan = app(fixtureText(EXAMPLE), `${EXAMPLE}.plan`).plan!;
    expect(isPlanApproved(plan)).toBe(true);
    expect(plan.stages.map((s) => [s.id, s.items.length, s.questions.map((q) => q.answer !== null)])).toEqual([
      ['s1', 2, [true]],
      ['s2', 2, [false]],
    ]);
  });

  it('is only a draft in the draft fixture: one section approved, the rest pending', () => {
    const plan = app(fixtureText(DRAFT), `${DRAFT}.plan`).plan!;
    expect(isPlanApproved(plan)).toBe(false);
    expect(planApprovalStates(plan).map((s) => `${s.section}:${s.state}`)).toEqual(['title:approved', 'goal:pending', 'scope:pending', 'impact:pending', 's1:pending', 'risks:pending']);
  });
});

describe('approvals follow the section text', () => {
  it('goes stale when the section changes, and not when a question is answered', () => {
    const source = fixtureText(EXAMPLE);
    const edited = source.replace('Highlight what a selected stage changes', 'Highlight what a stage changes');
    expect(planApprovalStates(app(edited, `${EXAMPLE}.plan`).plan!).find((s) => s.section === 's2')?.state).toBe('stale');
    const answered = source.replace('#question s2.q1 Does the stage list sit in the review pane or beside the macro view?', '#question s2.q1 Does the stage list sit in the review pane or beside the macro view?\n#answer jun Beside it.');
    const states = planApprovalStates(app(answered, `${EXAMPLE}.plan`).plan!);
    expect(states.every((s) => s.state === 'approved')).toBe(true);
    expect(skill(answered, `${EXAMPLE}.plan`).errors).toEqual([]);
  });
});

describe('item status from pull request states', () => {
  const plan = () => skill(fixtureText(EXAMPLE), `${EXAMPLE}.plan`).plan;
  const cases: [string, { item: string; state: 'open' | 'merged' | 'declined' }[], string][] = [
    ['no pull request', [], 'planned'],
    ['an open pull request', [{ item: 's1.1', state: 'open' }], 'in progress'],
    ['a merged pull request', [{ item: 's1.1', state: 'merged' }], 'implemented'],
    ['a declined pull request', [{ item: 's1.1', state: 'declined' }], 'planned'],
    ['a merged one and an open follow-up', [{ item: 's1.1', state: 'merged' }, { item: 's1.1', state: 'open' }], 'in progress'],
  ];

  it.each(cases)('%s reads the same in the skill and in the app: %s', (_label, links, expected) => {
    const bySkill = mods.status.deriveStatus(plan(), links).stages[0].items.find((i) => i.id === 's1.1')?.status;
    const byApp = planItemStatuses(app(fixtureText(EXAMPLE), `${EXAMPLE}.plan`).plan!, links).get('s1.1');
    expect(bySkill).toBe(expected);
    expect(byApp).toBe(expected);
  });

  it('shows a verified item as verified whatever its pull requests say', () => {
    const verified = fixtureText(EXAMPLE).replace('#approved plan', '#verified s1.2 jun 2026-11-02\n#approved plan');
    expect(planItemStatuses(app(verified, `${EXAMPLE}.plan`).plan!, []).get('s1.2')).toBe('verified');
    expect(mods.status.deriveStatus(skill(verified, `${EXAMPLE}.plan`).plan, []).stages[0].items[1].status).toBe('verified');
  });
});

describe('tolerance: unknown lines are skipped by both readers', () => {
  it('ignores a tag it does not know and keeps the rest', () => {
    const source = text(...BASE, '#future something new', '');
    const bySkill = skill(source);
    const byApp = app(source);
    expect(bySkill.errors).toEqual([]);
    expect(bySkill.warnings).toHaveLength(1);
    expect(byApp.problems).toEqual([]);
    expect(byApp.ignored).toHaveLength(1);
    expect(byApp.plan).toEqual(bySkill.plan);
  });

  it('reads a file with CRLF line ends and a byte order mark', () => {
    const source = `﻿${BASE.join('\r\n')}\r\n`;
    expect(skill(source).errors).toEqual([]);
    expect(app(source).plan).toEqual(skill(source).plan);
  });

  it('reads a new file in an impact and a touch the same way, and writes it back', () => {
    const source = text(...BASE.slice(0, 6), '#impact new docs/my%20new%23file.md Explains the new thing.', ...BASE.slice(6, -2), '#touch new docs/my%20new%23file.md', '#accept ok');
    const bySkill = skill(source);
    expect(bySkill.errors).toEqual([]);
    expect(bySkill.plan.impact[0]).toEqual({ kind: 'new', target: 'docs/my new#file.md', reason: 'Explains the new thing.' });
    expect(bySkill.plan.stages[0].items[0].touches[0]).toEqual({ kind: 'new', target: 'docs/my new#file.md' });
    expect(app(source).plan).toEqual(bySkill.plan);
    expect(mods.write.serializePlan(bySkill.plan)).toContain('#impact new docs/my%20new%23file.md Explains the new thing.');
    expect(mods.write.serializePlan(bySkill.plan)).toContain('#touch new docs/my%20new%23file.md');
  });

  it('makes a section stale when its new-file line is edited, in both readers', () => {
    const source = fixtureText(EXAMPLE);
    const edited = source.replace('Loads every plan file with', 'Loads each plan file with');
    expect(edited).not.toBe(source);
    const reader = app(edited, `${EXAMPLE}.plan`).plan!;
    expect(planApprovalStates(reader).find((s) => s.section === 'impact')?.state).toBe('stale');
    expect(mods.approval.sectionStates(skill(edited, `${EXAMPLE}.plan`).plan).find((s) => s.section === 'impact')?.state).toBe('stale');
    const touched = source.replace('#touch new src/main/lantern-plans.ts\n', '');
    expect(planApprovalStates(app(touched, `${EXAMPLE}.plan`).plan!).find((s) => s.section === 's1')?.state).toBe('stale');
  });

  it('decodes an encoded path the same way', () => {
    const source = text(...BASE.slice(0, -2), '#touch file docs/my%20notes%231.md', '#accept ok');
    expect(skill(source).plan.stages[0].items[0].touches).toEqual([{ kind: 'file', target: 'docs/my notes#1.md' }]);
    expect(app(source).plan!.stages[0].items[0].touches).toEqual([{ kind: 'file', target: 'docs/my notes#1.md' }]);
  });
});

describe('malformed input: both readers refuse', () => {
  const long = 'x'.repeat(201);
  const rejected: [string, string[], RegExp][] = [
    ['an impact of an unknown kind', ['#impact thing x Because.'], /unknown kind/],
    ['an impact with no reason', ['#impact feature g'], /reason is empty/],
    ['a repeated impact', ['#impact feature f Again.'], /second #impact/],
    ['a new file with no purpose', ['#impact new src/fresh.ts'], /reason is empty/],
    ['a new file named twice', ['#impact new src/fresh.ts Holds it.', '#impact new src/fresh.ts Again.'], /second #impact/],
    ['a new file with an unencoded percent', ['#impact new src/50%.ts Holds it.'], /% that is not %20, %23 or %25/],
    ['a stage that is not s<N>', ['#stage second Later'], /must be s1, s2/],
    ['a repeated stage', ['#stage s1 Again'], /second #stage/],
    ['an item under the wrong stage', ['#stage s2 Next', '#item s1.2 Stray'], /sits under stage s2/],
    ['an item with a loose id', ['#item one Loose'], /must be s<stage>\.<n>/],
    ['a second acceptance check', ['#accept Twice.'], /second #accept/],
    ['a touch with a stray word', ['#touch file b.ts and more'], /nothing after the target/],
    ['a repeated touch', ['#touch file a.ts'], /second #touch/],
    ['a question with no stage', [], /question without a stage/],
    ['an answer with nothing to answer', ['#answer jun Yes.'], /right after the #question/],
    ['a goal over the cap', [`#goal ${long}`], /the cap is 200/],
    ['an answer over the cap', ['#question s1.q1 Which?', `#answer jun ${'y'.repeat(2001)}`], /the cap is 2000/],
    ['a fourth goal line', ['#goal Two.', '#goal Three.', '#goal Four.'], /more than 3 goal lines/],
    ['a risk with a control character', ['#risk bad\u0001char'], /control character/],
    ['an approval with no digest', ['#approved goal jun 2026-10-26'], /12-hex digest/],
    ['an approval with a bad date', ['#approved plan jun yesterday'], /#approved must be/],
    ['a repeated plan approval', ['#approved plan jun 2026-10-26', '#approved plan jun 2026-10-27'], /second plan-level/],
    ['a verified item without a date', ['#verified s1.1 jun'], /#verified must be/],
    ['a line that is not a tag', ['just words'], /not a plan line/],
    ['a tag in capitals', ['#Goal Hidden goal'], /not a tag line/],
    ['a heading', ['## Notes'], /not a tag line/],
    ['a second id line', ['# again'], /not a tag line/],
    ['an answer with an accept between it and its question', ['#question s1.q1 Which?', '#accept Late.', '#answer jun This one.'], /right after the #question/],
    ['an accept after a question', ['#question s1.q1 Which?', '#accept Late.'], /#accept comes after an #item/],
  ];

  it.each(rejected)('%s', (label, extra, pattern) => {
    const lines = label === 'a question with no stage' ? ['lantern-plan 1', '# p', '#question s1.q1 Early?'] : [...BASE, ...extra];
    const bySkill = skill(text(...lines));
    const byApp = app(text(...lines));
    expect(bySkill.errors.join('\n')).toMatch(pattern);
    expect([...byApp.problems, byApp.error ?? ''].join('\n')).toMatch(pattern);
  });

  it.each([200, 201, 2000])('accepts an answer of %i characters in both readers', (size) => {
    const lines = [...BASE, '#question s1.q1 Which?', `#answer jun ${'y'.repeat(size)}`];
    expect(skill(text(...lines)).errors).toEqual([]);
    const byApp = app(text(...lines));
    expect(byApp.problems).toEqual([]);
    expect(byApp.plan?.stages[0].questions[0].answer?.text).toHaveLength(size);
  });

  it.each([
    ['a wrong header', text('lantern-plan 2', ...BASE.slice(1))],
    ['no id line', text(BASE[0], ...BASE.slice(2))],
    ['an id that is not the file name', text(BASE[0], '# other', ...BASE.slice(2))],
  ])('%s is refused outright', (_label, source) => {
    expect(skill(source).errors.length).toBeGreaterThan(0);
    expect(app(source).plan).toBeNull();
  });

  it.each(['p.txt', 'P.plan', 'p_q.plan', 'plan'])('refuses the file name %s in both readers', (name) => {
    expect(skill(text(...BASE), name).errors.length).toBeGreaterThan(0);
    expect(app(text(...BASE), name).plan).toBeNull();
  });
});
