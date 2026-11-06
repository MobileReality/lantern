import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FLOW_MAX_FILES, FLOW_MAX_STEPS, FLOW_MAX_STORIES, FLOW_TEXT_MAX } from '../src/main/lantern-flow-parse';
import { parsePlanFile, planApprovalStates } from '../src/main/lantern-plan';
import type { LanternPlan } from '../src/main/lantern-plan';
import { write } from './helpers/git-repo';
import { DRAFT, EXAMPLE, fixtureText, importScript, makeProject, planJson, removeDir, runPlan } from './helpers/lantern-plan-world';

interface SkillParse {
  plan: LanternPlan;
  errors: string[];
  warnings: string[];
}

interface Mods {
  parse: { parsePlan: (text: string, file: string) => SkillParse };
  write: { serializePlan: (plan: LanternPlan) => string; sectionDigest: (plan: LanternPlan, id: string) => string };
  flow: { FLOW: Record<string, unknown> };
  prflow: Record<string, unknown>;
}

let mods: Mods;

beforeAll(async () => {
  mods = {
    parse: await importScript('plan-parse.mjs'),
    write: await importScript('plan-write.mjs'),
    flow: await importScript('plan-flow.mjs'),
    prflow: (await import(path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'prflow.mjs'))) as Record<string, unknown>,
  };
});

const skill = (text: string, name = 'p.plan') => mods.parse.parsePlan(text, `.lantern/plans/${name}`);
const app = (text: string, name = 'p.plan') => parsePlanFile(text, name);
const text = (...lines: string[]) => `${lines.join('\n')}\n`;
const BASE = ['lantern-plan 1', '# p', '#title A plan', '#opened 2026-10-26', '#goal Do the thing.', '#scope-in The thing.', '#impact feature f Because.', '#stage s1 First', '#item s1.1 One', '#touch file a.ts', '#accept It works.'];
const QUESTION = '#question s1.q1 Which store?';
const FLOW = ['#story Reader picks a store', '#step actor Reader', '#step action picks', '#step subject a store', '#file a.ts', '#below interaction sees it', '#below consequence none => one'];
const FULL = [QUESTION, '#touch file b.ts', '#explain One store is shared.', '#explain The other is local.', ...FLOW, '#answer jun The shared one.'];

describe('a question can carry touches, an explanation and a flow', () => {
  it('reads them the same in both readers', () => {
    const source = text(...BASE, ...FULL);
    const bySkill = skill(source);
    const byApp = app(source);
    expect(bySkill.errors).toEqual([]);
    expect(byApp.problems).toEqual([]);
    const question = bySkill.plan.stages[0].questions[0];
    expect(question.touches).toEqual([{ kind: 'file', target: 'b.ts' }]);
    expect(question.explain).toEqual(['One store is shared.', 'The other is local.']);
    expect(question.flow).toEqual([
      {
        title: 'Reader picks a store',
        steps: [{ kind: 'actor', text: 'Reader' }, { kind: 'action', text: 'picks' }, { kind: 'subject', text: 'a store', files: ['a.ts'] }],
        below: [{ kind: 'interaction', text: 'sees it' }, { kind: 'consequence', old: 'none', new: 'one' }],
      },
    ]);
    expect(question.answer).toEqual({ by: 'jun', text: 'The shared one.' });
    expect(byApp.plan).toEqual(bySkill.plan);
  });

  it('writes them back in one canonical order: touches, explanation, flow, then the answer', () => {
    const scrambled = text(...BASE, QUESTION, '#answer jun The shared one.', ...FLOW, '#explain One store is shared.', '#touch file b.ts');
    const written = mods.write.serializePlan(skill(scrambled).plan);
    expect(written).toBe(mods.write.serializePlan(skill(text(...BASE, QUESTION, '#touch file b.ts', '#explain One store is shared.', ...FLOW, '#answer jun The shared one.')).plan));
    expect(written.indexOf('#touch file b.ts')).toBeLessThan(written.indexOf('#explain'));
    expect(written.indexOf('#explain')).toBeLessThan(written.indexOf('#story'));
    expect(written.indexOf('#story')).toBeLessThan(written.indexOf('#answer'));
    expect(skill(written).errors).toEqual([]);
  });

  it('reads a plan without any of these lines exactly as before, with empty lists on its questions', () => {
    const source = fixtureText(DRAFT);
    const question = skill(source, `${DRAFT}.plan`).plan.stages[0].questions[0];
    expect(question).toEqual({ id: 's1.q1', text: 'Should an unknown line survive a rewrite by the scripts?', answer: null, touches: [], explain: [], flow: [] });
    expect(mods.write.serializePlan(skill(source, `${DRAFT}.plan`).plan)).toBe(source);
    expect(app(source, `${DRAFT}.plan`).plan).toEqual(skill(source, `${DRAFT}.plan`).plan);
  });

  it('keeps every approval current when a question gains touches, an explanation, a flow or an answer, in both readers', () => {
    const source = fixtureText(EXAMPLE);
    const more = source.replace('#question s2.q1 Does the stage list sit in the review pane or beside the macro view?', '#question s2.q1 Does the stage list sit in the review pane or beside the macro view?\n#explain One more line.');
    expect(more).not.toBe(source);
    const reader = app(more, `${EXAMPLE}.plan`).plan!;
    expect(planApprovalStates(reader).every((s) => s.state === 'approved')).toBe(true);
    const before = skill(source, `${EXAMPLE}.plan`).plan;
    const after = skill(more, `${EXAMPLE}.plan`).plan;
    for (const stage of after.stages) expect(mods.write.sectionDigest(after, stage.id)).toBe(mods.write.sectionDigest(before, stage.id));
    const reworded = source.replace('Does the stage list sit in the review pane', 'Does the list sit in the review pane');
    expect(planApprovalStates(app(reworded, `${EXAMPLE}.plan`).plan!).find((s) => s.section === 's2')?.state).toBe('stale');
  });

  it('reads the flow limits from one table that matches the pull request flow', () => {
    const FLOW_LIMITS = mods.flow.FLOW as { textMax: number; stories: number; steps: number; files: number; arrow: string; kinds: string[] };
    expect({ textMax: FLOW_LIMITS.textMax, stories: FLOW_LIMITS.stories, steps: FLOW_LIMITS.steps, files: FLOW_LIMITS.files, arrow: FLOW_LIMITS.arrow }).toEqual({
      textMax: mods.prflow.FLOW_TEXT_MAX,
      stories: mods.prflow.FLOW_MAX_STORIES,
      steps: mods.prflow.FLOW_MAX_STEPS,
      files: mods.prflow.FLOW_MAX_FILES,
      arrow: mods.prflow.CONSEQUENCE_ARROW,
    });
    expect(FLOW_LIMITS.kinds).toEqual(mods.prflow.FLOW_KINDS);
    expect({ textMax: FLOW_TEXT_MAX, stories: FLOW_MAX_STORIES, steps: FLOW_MAX_STEPS, files: FLOW_MAX_FILES }).toEqual({ textMax: FLOW_LIMITS.textMax, stories: FLOW_LIMITS.stories, steps: FLOW_LIMITS.steps, files: FLOW_LIMITS.files });
  });
});

describe('malformed question lines: both readers refuse, with the same words', () => {
  const tooLong = 'x'.repeat(81);
  const stories = Array.from({ length: 6 }, (_, i) => [`#story s${i}`, '#step actor a']).flat();
  const rows = Array.from({ length: 7 }, () => '#step actor a');
  const below = Array.from({ length: 7 }, () => '#below actor a');
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `#file ${name}.ts`);
  const CASES: [string, string[], RegExp][] = [
    ['an explanation with no question', ['#explain Why.'], /#explain comes right after the #question/],
    ['a story with no question', ['#story One'], /#story comes right after the #question/],
    ['a touch with no owner at all', ['#question s1.q1 Which?', '#accept Late.', '#touch file b.ts'], /#touch comes after a #stage, an #item or a #question/],
    ['an empty explanation', [QUESTION, '#explain'], /explanation is empty/],
    ['an explanation over the cap', [QUESTION, `#explain ${'x'.repeat(201)}`], /explanation is 201 characters, the cap is 200/],
    ['a fifth explanation line', [QUESTION, '#explain 1', '#explain 2', '#explain 3', '#explain 4', '#explain 5'], /more than 4 explanation lines/],
    ['a repeated touch on a question', [QUESTION, '#touch file b.ts', '#touch file b.ts'], /second #touch for file b\.ts/],
    ['a step before any story', [QUESTION, '#step actor A'], /#step comes before any #story/],
    ['a row below before any story', [QUESTION, '#below actor A'], /#below comes before any #story/],
    ['a file before any story', [QUESTION, '#file a.ts'], /#file comes before any #story/],
    ['an unknown step kind', [QUESTION, '#story S', '#step person A'], /unknown kind "person"/],
    ['a step with no kind', [QUESTION, '#story S', '#step'], /must be "<kind> <text>"/],
    ['a step with no text', [QUESTION, '#story S', '#step actor'], /the actor text is empty/],
    ['a story with no title', [QUESTION, '#story'], /the story title is empty/],
    ['an over-long story title', [QUESTION, `#story ${tooLong}`], /the story title is 81 characters, the cap is 80/],
    ['an over-long step text', [QUESTION, '#story S', `#step action ${tooLong}`], /the action text is 81 characters/],
    ['a control character in a step', [QUESTION, '#story S', '#step actor Ad\u0007min'], /control character/],
    ['a consequence with no arrow', [QUESTION, '#story S', '#step consequence only one'], /a consequence is "<old text> => <new text>"/],
    ['an over-long old text', [QUESTION, '#story S', `#step consequence ${tooLong} => new`], /the old text is 81 characters/],
    ['a step after the row below', [QUESTION, '#story S', '#step actor A', '#below actor B', '#step action x'], /#step comes after #below/],
    ['a file before any step', [QUESTION, '#story S', '#file a.ts'], /#file comes before any #step or #below/],
    ['a file with a space in it', [QUESTION, '#story S', '#step actor A', '#file a b.ts'], /takes one path and nothing after it/],
    ['a file with a stray percent', [QUESTION, '#story S', '#step actor A', '#file a%zz.ts'], /% that is not %20, %23 or %25/],
    ['a file named twice on one step', [QUESTION, '#story S', '#step actor A', '#file a.ts', '#file a.ts'], /names a\.ts twice on one step/],
    ['seven files on one step', [QUESTION, '#story S', '#step actor A', ...files], /more than 6 files on one step/],
    ['six stories', [QUESTION, ...stories], /more than 5 stories/],
    ['seven steps in a row', [QUESTION, '#story S', ...rows], /more than 6 #step lines/],
    ['seven steps below', [QUESTION, '#story S', '#step actor a', ...below], /more than 6 #below lines/],
  ];

  const lineOf = (message: string) => message.replace(/^.*?:(\d+): /, 'line $1: ');

  it.each(CASES)('%s', (_label, extra, pattern) => {
    const source = text(...BASE, ...extra);
    const bySkill = skill(source).errors.map(lineOf);
    const byApp = app(source).problems;
    expect(bySkill.join('\n')).toMatch(pattern);
    expect(byApp).toEqual(bySkill);
  });

  it('accepts the most the limits allow', () => {
    const stories5 = Array.from({ length: 5 }, (_, i) => [`#story s${i}`, '#step actor a']).flat();
    const rows6 = Array.from({ length: 6 }, () => '#step actor a');
    const files6 = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `#file ${name}.ts`);
    for (const lines of [[QUESTION, ...stories5], [QUESTION, '#story S', ...rows6], [QUESTION, '#story S', '#step actor A', ...files6], [QUESTION, `#story ${'x'.repeat(80)}`, '#step actor A']]) {
      expect(skill(text(...BASE, ...lines)).errors).toEqual([]);
      expect(app(text(...BASE, ...lines)).problems).toEqual([]);
    }
  });
});

describe('plan.mjs add explain and add flow, and check', () => {
  let root: string;

  beforeEach(() => {
    root = makeProject([EXAMPLE, DRAFT]);
  });

  afterEach(() => {
    removeDir(root);
  });

  const planFile = (slug: string) => path.join(root, '.lantern', 'plans', `${slug}.plan`);
  const body = (slug: string) => fs.readFileSync(planFile(slug), 'utf8');
  const flowJson = (stories: unknown) => {
    write(root, '.ai/tmp/flow.json', JSON.stringify(stories));
    return '.ai/tmp/flow.json';
  };
  const STORY = [{ title: 'Reader asks for the list', steps: [{ kind: 'actor', text: 'Reader' }, { kind: 'action', text: 'opens', files: ['src/main/lantern.ts'] }], below: [{ kind: 'consequence', old: 'no list', new: 'a list' }] }];

  it('adds an explanation line under a question, keeping every approval', () => {
    const run = runPlan(root, 'add', EXAMPLE, 'explain', 's1.q1', 'Plans on other branches would multiply the git scans.');
    expect(run.status).toBe(0);
    expect(body(EXAMPLE)).toContain('#explain Plans on other branches would multiply the git scans.');
    expect(planJson<{ results: { ok: boolean }[] }>(root, 'check', EXAMPLE).results[0].ok).toBe(true);
    expect(runPlan(root, 'show', EXAMPLE).stdout).not.toMatch(/stale/);
  });

  it('replaces the explanation with --replace and refuses an unknown question', () => {
    runPlan(root, 'add', EXAMPLE, 'explain', 's2.q1', 'Fresh words.', '--replace');
    expect(body(EXAMPLE)).toContain('#explain Fresh words.');
    expect(body(EXAMPLE)).not.toContain('#explain The review pane is the narrow');
    const run = runPlan(root, 'add', EXAMPLE, 'explain', 's9.q9', 'Nope.');
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/no question s9\.q9/);
  });

  it('adds a flow from a JSON file, in the shape of a pull request flow', () => {
    const run = runPlan(root, 'add', EXAMPLE, 'flow', 's1.q1', '--flow-file', flowJson(STORY));
    expect(run.status).toBe(0);
    expect(body(EXAMPLE)).toContain(['#story Reader asks for the list', '#step actor Reader', '#step action opens', '#file src/main/lantern.ts', '#below consequence no list => a list'].join('\n'));
    expect(planJson<{ results: { ok: boolean; errors: string[] }[] }>(root, 'check', EXAMPLE).results[0]).toMatchObject({ ok: true, errors: [] });
  });

  it('refuses a flow with no file, an unreadable file and an invalid flow, and leaves the plan as it was', () => {
    const before = body(EXAMPLE);
    expect(runPlan(root, 'add', EXAMPLE, 'flow', 's1.q1').stderr).toMatch(/needs --flow-file/);
    expect(runPlan(root, 'add', EXAMPLE, 'flow', 's1.q1', '--flow-file', 'missing.json').stderr).toMatch(/cannot read the flow file/);
    const bad = runPlan(root, 'add', EXAMPLE, 'flow', 's1.q1', '--flow-file', flowJson([{ title: 'x', steps: [{ kind: 'person', text: 'A' }] }]));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/the flow is not valid/);
    expect(body(EXAMPLE)).toBe(before);
  });

  it('adds a touch to a question by its id', () => {
    expect(runPlan(root, 'add', EXAMPLE, 'touch', 's1.q1', 'file', 'src/main/main.ts').status).toBe(0);
    expect(body(EXAMPLE)).toMatch(/#question s1\.q1 [^\n]*\n#touch file src\/main\/lantern\.ts\n#touch file src\/main\/main\.ts\n/);
  });

  it('fails check when a question names a file that is not in the map, from a touch or from its flow', () => {
    runPlan(root, 'add', EXAMPLE, 'touch', 's1.q1', 'file', 'src/main/nowhere.ts');
    const touched = planJson<{ results: { ok: boolean; errors: string[] }[] }>(root, 'check', EXAMPLE).results[0];
    expect(touched.ok).toBe(false);
    expect(touched.errors.join('\n')).toMatch(/s1\.q1 #touch file src\/main\/nowhere\.ts: src\/main\/nowhere\.ts is not in the map/);
    const other = makeProject([EXAMPLE]);
    try {
      fs.writeFileSync(path.join(other, '.lantern', 'plans', `${EXAMPLE}.plan`), fixtureText(EXAMPLE).replace('#file src/renderer/lib/macroview/mount.ts', '#file src/renderer/lib/macroview/elsewhere.ts'));
      const flowed = planJson<{ results: { ok: boolean; errors: string[] }[] }>(other, 'check', EXAMPLE).results[0];
      expect(flowed.ok).toBe(false);
      expect(flowed.errors.join('\n')).toMatch(/s2\.q1 #file src\/renderer\/lib\/macroview\/elsewhere\.ts/);
    } finally {
      removeDir(other);
    }
  });

  it('fails check for a story with no step', () => {
    fs.writeFileSync(planFile(EXAMPLE), body(EXAMPLE).replace('#story Reader opens a plan on the map', '#story Empty one\n#story Reader opens a plan on the map'));
    const result = planJson<{ results: { ok: boolean; errors: string[] }[] }>(root, 'check', EXAMPLE).results[0];
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/question s2\.q1: story "Empty one" has no #step line/);
  });
});
