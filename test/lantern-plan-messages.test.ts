import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parsePlanFile } from '../src/main/lantern-plan';
import messages from '../skills/lantern-plan/scripts/messages.json';
import { PLAN_SCRIPTS, REPO, SKILLS, importScript } from './helpers/lantern-plan-world';

interface Messages {
  say: (code: string, params?: Record<string, string | number>) => string;
  ERROR: Record<string, string>;
  EXIT: Record<string, number>;
}

let skill: Messages;
let parsePlan: (text: string, file: string) => { errors: string[]; warnings: string[] };

beforeAll(async () => {
  skill = await importScript<Messages>('plan-messages.mjs');
  parsePlan = (await importScript<{ parsePlan: typeof parsePlan }>('plan-parse.mjs')).parsePlan;
});

const SECTIONS = ['error', 'warning', 'line', 'noun', 'view'] as const;
const ALIASES: Record<string, (typeof SECTIONS)[number]> = { ERROR: 'error', WARNING: 'warning', LINE: 'line', NOUN: 'noun', VIEW: 'view', PLAN_ERROR: 'error', PLAN_WARNING: 'warning', PLAN_LINE: 'line' };
const SOURCES = [
  ...fs.readdirSync(PLAN_SCRIPTS).filter((name) => name.endsWith('.mjs')).map((name) => path.join(PLAN_SCRIPTS, name)),
  path.join(SKILLS, 'lantern-sync', 'scripts', 'sync.mjs'),
  path.join(SKILLS, 'lantern-delegate', 'scripts', 'preflight.mjs'),
  ...fs.readdirSync(path.join(REPO, 'src', 'main')).filter((name) => name.startsWith('lantern-plan')).map((name) => path.join(REPO, 'src', 'main', name)),
  path.join(REPO, 'src', 'shared', 'lantern-plan-messages.ts'),
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const APP_SOURCES = sourceFiles(path.join(REPO, 'src'));

function usedCodes() {
  const used = new Set<string>();
  for (const file of APP_SOURCES) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\bVIEW\.([A-Z][A-Z_]*)\b/g)) used.add(`view.${match[1]}`);
  }
  for (const file of SOURCES) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\b(ERROR|WARNING|LINE|NOUN|PLAN_ERROR|PLAN_WARNING|PLAN_LINE)\.([A-Z][A-Z_]*)\b/g)) used.add(`${ALIASES[match[1]]}.${match[2]}`);
    for (const match of text.matchAll(/planSay\('(ERROR|WARNING|LINE)', '([A-Z_]+)'/g)) used.add(`${ALIASES[match[1]]}.${match[2]}`);
    for (const match of text.matchAll(/'(SYNC_[A-Z_]+)'/g)) for (const section of SECTIONS) if (match[1] in messages[section]) used.add(`${section}.${match[1]}`);
  }
  return used;
}

const defined = () => SECTIONS.flatMap((section) => Object.keys(messages[section]).map((key) => `${section}.${key}`));

describe('messages.json is the one place the plan messages live', () => {
  it('has every message the scripts and the app parser ask for', () => {
    const known = new Set(defined());
    expect([...usedCodes()].filter((code) => !known.has(code))).toEqual([]);
  });

  it('has no message that nothing asks for', () => {
    const used = usedCodes();
    expect(defined().filter((code) => !used.has(code))).toEqual([]);
  });

  it('builds the code tables from the keys, so a code is its own path', () => {
    expect(skill.ERROR.FILE_NAME).toBe('error.FILE_NAME');
    expect(Object.keys(skill.ERROR)).toEqual(Object.keys(messages.error));
  });

  it('refuses an unknown code and a missing parameter instead of printing a hole', () => {
    expect(() => skill.say('error.NOPE')).toThrow(/no message/);
    expect(() => skill.say(skill.ERROR.TEXT_EMPTY)).toThrow(/needs \{what\}/);
    expect(skill.say(skill.ERROR.TEXT_EMPTY, { what: 'the title' })).toBe('the title is empty');
  });

  it('has one exit code per outcome, in one table', () => {
    expect(skill.EXIT).toEqual({ OK: 0, FAILED: 1, USAGE: 2 });
  });

  it('keeps every placeholder in a message a plain word', () => {
    for (const section of SECTIONS) for (const [key, text] of Object.entries(messages[section])) expect(text.replace(/\{\w+\}/g, ''), `${section}.${key}`).not.toMatch(/[{}]/);
  });
});

describe('the app parser says what the skill parser says', () => {
  const BASE = ['lantern-plan 1', '# p', '#title A plan', '#opened 2026-10-26', '#goal Do the thing.', '#scope-in The thing.', '#impact feature f Because.', '#stage s1 First', '#item s1.1 One', '#touch file a.ts', '#accept It works.'];
  const BROKEN: [string, string[]][] = [
    ['a line that is not a tag line', ['no hash here']],
    ['a malformed tag line', ['#Upper case']],
    ['a second title', ['#title Again']],
    ['a bad opened date', ['#opened 2026-02-30']],
    ['an empty goal', ['#goal']],
    ['a goal with a control character', ['#goal bad\u0001char']],
    ['a goal over the cap', [`#goal ${'x'.repeat(201)}`]],
    ['a fourth goal', ['#goal two', '#goal three', '#goal four']],
    ['an unknown kind', ['#impact thing x Because.']],
    ['an impact with no target', ['#impact file']],
    ['a file with a stray percent', ['#impact file a%zz.ts Because.']],
    ['a second impact for one target', ['#impact feature f Again.']],
    ['a touch with words after the target', ['#touch file a.ts extra']],
    ['a second touch for one target', ['#touch file a.ts']],
    ['a stage id out of shape', ['#stage first One']],
    ['a second stage with one id', ['#stage s1 Again']],
    ['an item id out of shape', ['#item one Two']],
    ['an item under the wrong stage', ['#item s2.1 Two']],
    ['a second item with one id', ['#item s1.1 Again']],
    ['a second accept', ['#accept Twice.']],
    ['a question id out of shape', ['#question one Why?']],
    ['a question under the wrong stage', ['#question s2.q1 Why?']],
    ['a second question with one id', ['#question s1.q1 Why?', '#question s1.q1 Why?']],
    ['an answer with no question', ['#answer jun Yes.']],
    ['an answer with no one answering', ['#question s1.q1 Why?', '#answer']],
    ['two answers to one question', ['#question s1.q1 Why?', '#answer jun Yes.', '#answer jun Yes.']],
    ['an approval with a short digest', ['#approved goal jun 2026-10-26 abc']],
    ['a plan approval with a digest', ['#approved plan jun 2026-10-26 abcdefabcdef']],
    ['a second plan approval', ['#approved plan jun 2026-10-26', '#approved plan jun 2026-10-26']],
    ['a second approval of one section', ['#approved goal jun 2026-10-26 abcdefabcdef', '#approved goal jun 2026-10-26 abcdefabcdef']],
    ['a verified line out of shape', ['#verified one jun 2026-10-26']],
    ['a second verified for one item', ['#verified s1.1 jun 2026-10-26', '#verified s1.1 jun 2026-10-26']],
  ];

  const lineOf = (message: string) => message.replace(/^.*?:(\d+): /, 'line $1: ');
  const text = (...extra: string[]) => `${[...BASE, ...extra].join('\n')}\n`;

  it.each(BROKEN)('%s', (_label, extra) => {
    const source = text(...extra);
    const fromSkill = parsePlan(source, '.lantern/plans/p.plan').errors.map(lineOf);
    const fromApp = parsePlanFile(source, 'p.plan').problems;
    expect(fromSkill.length).toBeGreaterThan(0);
    expect(fromApp).toEqual(fromSkill);
  });

  it('agrees on an unknown tag, which only warns', () => {
    const source = text('#mood happy');
    expect(parsePlan(source, '.lantern/plans/p.plan').warnings.map(lineOf)).toEqual(parsePlanFile(source, 'p.plan').ignored);
  });

  it.each([
    ['a file name that is not a slug', 'P.plan', BASE.join('\n')],
    ['a wrong first line', 'p.plan', ['lantern-plan 2', ...BASE.slice(1)].join('\n')],
    ['an id that is not the file name', 'p.plan', ['lantern-plan 1', '# q'].join('\n')],
    ['no id line', 'p.plan', 'lantern-plan 1\n'],
  ])('agrees on the file-level fault: %s', (_label, name, source) => {
    const fromSkill = parsePlan(`${source}\n`, `.lantern/plans/${name}`).errors;
    const fromApp = parsePlanFile(`${source}\n`, name).error ?? '';
    expect(fromApp).not.toBe('');
    expect(fromSkill.some((message) => message.includes(fromApp))).toBe(true);
  });
});
