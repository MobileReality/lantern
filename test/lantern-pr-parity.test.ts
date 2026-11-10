import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parsePrRecord } from '../src/main/lantern-pr-parse';
import { FILES_MAX, FLOW_STORY, FLOW_STORY_VALUE, REF_FILE_LINES, REF_PATHS, REF_STORY, REF_STORY_VALUE, REJECTED_FLOWS, REJECTED_REFERENCES, refLines } from './helpers/lantern-flow-cases';

const SKILL = path.join(__dirname, '..', 'skills', 'lantern-setup');
const PRS_DIR = path.join(SKILL, 'example-web', 'demo-platforms', '.lantern', 'prs');
const KIND_OF: Record<string, string> = { '+': 'added', '~': 'modified', '-': 'removed' };
const HEAD = '3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c';
const VALID = ['lantern-pr 1', '# 7', '#title t', '#url https://x.test/7', '#branch b', '#base main', '#opened 2026-09-30', `#head ${HEAD}`];

interface SkillPr {
  id: string | null;
  title: string | null;
  url: string | null;
  branch: string | null;
  base: string | null;
  opened: string | null;
  head: string | null;
  summary: string | null;
  files: { kind: string; path: string; reason?: string }[];
  order: string[];
  plans: { slug: string; item: string }[];
  flow: unknown[];
  description: Record<string, string[]>;
  errors: string[];
  warnings: string[];
}

interface SkillDismissed {
  ids: string[];
  errors: string[];
  warnings: string[];
}

let parseSkill: (text: string, file: string) => SkillPr;
let inReviewOrder: (files: { kind: string; path: string }[], order: string[]) => { kind: string; path: string }[];
let parseDismissed: (text: string, file?: string) => SkillDismissed;
let serializeDismissed: (ids: string[]) => string;

beforeAll(async () => {
  const mod = await import(pathToFileURL(path.join(SKILL, 'scripts', 'prs.mjs')).href);
  parseSkill = mod.parsePr;
  inReviewOrder = mod.inReviewOrder;
  parseDismissed = mod.parseDismissed;
  serializeDismissed = mod.serializeDismissed;
});

function record(lines: string[]) {
  return `${lines.join('\n')}\n`;
}

function withReplaced(prefix: string, replacement: string | null) {
  return VALID.flatMap((line) => (line.startsWith(prefix) ? (replacement === null ? [] : [replacement]) : [line]));
}

function both(text: string, fileName: string) {
  const skill = parseSkill(text, `.lantern/prs/${fileName}`);
  const app = parsePrRecord(text, fileName);
  return { skill, app, skillAccepts: skill.errors.length === 0, appAccepts: app.error === null };
}

const realFiles = fs.readdirSync(PRS_DIR).filter((name) => name.endsWith('.pr'));

describe('bundled example records', () => {
  it('has records to compare', () => {
    expect(realFiles.length).toBeGreaterThanOrEqual(2);
  });

  it.each(realFiles)('%s: skill parser and app parser produce the same record', (name) => {
    const text = fs.readFileSync(path.join(PRS_DIR, name), 'utf8');
    const { skill, app } = both(text, name);
    expect(skill.errors).toEqual([]);
    expect(app.error).toBeNull();
    const pr = app.pr!;
    expect({ id: pr.id, title: pr.title, url: pr.url, branch: pr.branch, base: pr.base, opened: pr.opened, head: pr.head, summary: pr.summary }).toEqual({
      id: skill.id,
      title: skill.title,
      url: skill.url,
      branch: skill.branch,
      base: skill.base,
      opened: skill.opened,
      head: skill.head,
      summary: skill.summary,
    });
    expect(pr.files).toEqual(inReviewOrder(skill.files, skill.order).map((f) => ({ kind: KIND_OF[f.kind], path: f.path, ...(f.reason ? { reason: f.reason } : {}) })));
    expect(pr.files.length).toBeGreaterThan(0);
  });
});

describe('malformed input: both parsers agree on reject', () => {
  const rejected: [string, string, string][] = [
    ['wrong id', 'record with # 8 in 7.pr', record(withReplaced('# ', '# 8'))],
    ['missing #head', 'no #head line', record(withReplaced('#head', null))],
    ['short #head', 'abbreviated sha', record(withReplaced('#head', '#head 3f9a1c2'))],
    ['bad kind', 'file line with kind *', record([...VALID, '* src/a.ts'])],
    ['duplicate path', 'same path twice', record([...VALID, '+ src/a.ts', '~ src/a.ts'])],
    ['duplicate encoded path', 'a%20b listed twice', record([...VALID, '+ src/a%20b.ts', '~ src/a%20b.ts'])],
    ['path traversal', '.. segment', record([...VALID, '+ ../a.ts'])],
    ['absolute path', 'leading slash', record([...VALID, '+ /a.ts'])],
    ['missing #title', 'no #title line', record(withReplaced('#title', null))],
    ['bad opened date', 'not a date', record(withReplaced('#opened', '#opened yesterday'))],
    ['wrong header', 'lantern-pr 2', record(['lantern-pr 2', ...VALID.slice(1)])],
    ['duplicate key', '#title twice', record([...VALID, '#title again'])],
  ];

  it.each(rejected)('%s (%s)', (_label, _what, text) => {
    const { skillAccepts, appAccepts } = both(text, '7.pr');
    expect(skillAccepts).toBe(false);
    expect(appAccepts).toBe(false);
  });

  it('rejects a file name that is not <digits>.pr in both', () => {
    const { skillAccepts, appAccepts } = both(record(VALID), 'seven.pr');
    expect(skillAccepts).toBe(false);
    expect(appAccepts).toBe(false);
  });
});

describe('encoded paths: both parsers agree on accept and decode identically', () => {
  it.each([
    ['%20', 'src/my%20file.ts', 'src/my file.ts'],
    ['%23', 'src/a%23b.ts', 'src/a#b.ts'],
    ['%25', 'src/100%25.ts', 'src/100%.ts'],
    ['all three', 'a%20b/c%23d/e%25f.ts', 'a b/c#d/e%f.ts'],
  ])('%s', (_label, encoded, decoded) => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, `+ ${encoded}`]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(appAccepts).toBe(true);
    expect(skill.files).toEqual([{ kind: '+', path: decoded }]);
    expect(app.pr!.files).toEqual([{ kind: 'added', path: decoded }]);
  });

  it('agree to reject a raw space, which the format requires encoded as %20', () => {
    const { skillAccepts, appAccepts } = both(record([...VALID, '+ src/my file.ts']), '7.pr');
    expect(skillAccepts).toBe(false);
    expect(appAccepts).toBe(false);
  });
});

describe('documented differences: the skill validator is stricter, the app reader is lenient', () => {
  it('skill warns about file lines out of order; the app accepts them and keeps file order', () => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, '- z.ts', '+ a.ts']), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(skill.warnings.length).toBeGreaterThan(0);
    expect(appAccepts).toBe(true);
    expect(app.pr!.files.map((f) => f.path)).toEqual(skill.files.map((f) => f.path));
  });

  it('a record the skill accepts is always accepted by the app', () => {
    const inputs = [record(VALID), record([...VALID, '#summary hi', '+ a.ts', '~ b.ts', '- c.ts']), record([...VALID, '#note free text', '+ a%20b.ts'])];
    for (const text of inputs) {
      const { skillAccepts, appAccepts } = both(text, '7.pr');
      expect(skillAccepts).toBe(true);
      expect(appAccepts).toBe(true);
    }
  });
});

describe('reasons (#reason): both parsers agree on valid records and on what a reason is', () => {
  const reasonLine = (file: string, text: string) => `#reason ${file} ${text}`;
  const files = ['+ src/a%20b.ts', '~ src/c.ts'];

  it('agree on the reason of each file, decoded paths included', () => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, ...files, reasonLine('src/a%20b.ts', 'Spaces are fine.'), reasonLine('src/c.ts', 'Keeps the cap at 160.')]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(appAccepts).toBe(true);
    expect(app.pr!.files).toEqual([
      { kind: 'added', path: 'src/a b.ts', reason: 'Spaces are fine.' },
      { kind: 'modified', path: 'src/c.ts', reason: 'Keeps the cap at 160.' },
    ]);
    expect(skill.files).toEqual([
      { kind: '+', path: 'src/a b.ts', reason: 'Spaces are fine.' },
      { kind: '~', path: 'src/c.ts', reason: 'Keeps the cap at 160.' },
    ]);
  });

  it('agree on the 160 character cap: the skill errors, the app drops the reason, both keep the file', () => {
    const exact = both(record([...VALID, ...files, reasonLine('src/c.ts', 'x'.repeat(160))]), '7.pr');
    expect(exact.skillAccepts).toBe(true);
    expect(exact.app.pr!.files[1].reason).toHaveLength(160);
    const over = both(record([...VALID, ...files, reasonLine('src/c.ts', 'x'.repeat(161))]), '7.pr');
    expect(over.skillAccepts).toBe(false);
    expect(over.skill.errors.join('\n')).toMatch(/cap is 160/);
    expect(over.appAccepts).toBe(true);
    expect(over.app.pr!.files.map((f) => f.path)).toEqual(over.skill.files.map((f) => f.path));
    expect(over.app.pr!.files[1]).toEqual({ kind: 'modified', path: 'src/c.ts' });
  });

  it.each([
    ['a reason for a file the record does not list', reasonLine('src/ghost.ts', 'nope'), /not a file line/],
    ['a reason with no text', '#reason src/c.ts', /reason is empty/],
    ['a repeated reason', reasonLine('src/c.ts', 'again'), /duplicate #reason/],
    ['an unencoded space in the path', reasonLine('src/a b.ts', 'x'), /#reason/],
  ])('the skill refuses %s while the app still shows the record', (_label, line, pattern) => {
    const lines = [...VALID, ...files, reasonLine('src/c.ts', 'first'), line];
    const { skill, app, skillAccepts, appAccepts } = both(record(lines), '7.pr');
    expect(skillAccepts).toBe(false);
    expect(skill.errors.join('\n')).toMatch(pattern);
    expect(appAccepts).toBe(true);
    expect(app.pr!.files).toHaveLength(2);
  });

  it('a record without reasons is unchanged: files carry no why key in either parser', () => {
    const { skill, app } = both(record([...VALID, ...files]), '7.pr');
    expect(skill.files.every((f) => !('reason' in f))).toBe(true);
    expect(app.pr!.files.every((f) => !('reason' in f))).toBe(true);
  });
});

describe('a map-only record (no file lines): both parsers accept it', () => {
  it('agree on a record with a summary and no files, and with no files at all', () => {
    for (const lines of [[...VALID, '#summary Lantern map only: no source file changed'], VALID]) {
      const { skill, app, skillAccepts, appAccepts } = both(record(lines), '7.pr');
      expect(skillAccepts).toBe(true);
      expect(appAccepts).toBe(true);
      expect(skill.files).toEqual([]);
      expect(app.pr!.files).toEqual([]);
      expect(app.pr!.summary).toBe(skill.summary);
    }
  });
});

describe('review order (#order): both parsers agree on valid records', () => {
  const files = ['+ src/a%20b.ts', '~ src/c.ts', '- src/d.ts'];

  it('agree on the order of the files, a partial order included', () => {
    for (const order of [['src/d.ts', 'src/a%20b.ts', 'src/c.ts'], ['src/c.ts'], []]) {
      const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, ...files, ...order.map((p) => `#order ${p}`)]), '7.pr');
      expect(skillAccepts).toBe(true);
      expect(appAccepts).toBe(true);
      const bySkill = inReviewOrder(skill.files, skill.order).map((f) => f.path);
      expect(app.pr!.files.map((f) => f.path)).toEqual(bySkill);
      expect(skill.order).toEqual(order.map((p) => decodeURIComponent(p)));
    }
  });

  it.each([
    ['an order for a file the record does not list', ['#order src/c.ts', '#order src/ghost.ts'], /not a file line/],
    ['a repeated order', ['#order src/c.ts', '#order src/c.ts'], /duplicate #order/],
    ['an order with no path', ['#order'], /#order must be/],
    ['an order with an unencoded space', ['#order src/a b.ts'], /#order/],
  ])('the skill refuses %s while the app still shows the record', (_label, lines, pattern) => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, ...files, ...lines]), '7.pr');
    expect(skillAccepts).toBe(false);
    expect(skill.errors.join('\n')).toMatch(pattern);
    expect(appAccepts).toBe(true);
    expect(app.pr!.files).toHaveLength(3);
  });
});

describe('flow (#story, #step, #below): both parsers agree', () => {
  const files = ['+ src/a.ts'];

  it('read the same stories, kinds and order from a valid flow', () => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, ...files, ...FLOW_STORY]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(appAccepts).toBe(true);
    expect(skill.flow).toEqual([FLOW_STORY_VALUE]);
    expect(app.pr!.flow).toEqual(skill.flow);
  });

  it('read a tab between a tag and its text the same way', () => {
    const { skill, app } = both(record([...VALID, ...files, '#story\tA title', '#step\tactor Admin']), '7.pr');
    expect(skill.errors).toEqual([]);
    expect(skill.flow).toEqual([{ title: 'A title', steps: [{ kind: 'actor', text: 'Admin' }], below: [] }]);
    expect(app.pr!.flow).toEqual(skill.flow);
  });

  it('read a record without a flow as having none', () => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, ...files]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(appAccepts).toBe(true);
    expect(skill.flow).toEqual([]);
    expect(app.pr).not.toHaveProperty('flow');
  });

  it.each(REJECTED_FLOWS)('both refuse %s: the skill errors, the app drops the flow and still shows the record', (_label, lines, pattern) => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, ...files, ...lines]), '7.pr');
    expect(skillAccepts).toBe(false);
    expect(skill.errors.join('\n')).toMatch(pattern);
    expect(skill.flow).toEqual([]);
    expect(appAccepts).toBe(true);
    expect(app.pr!.flow).toBeUndefined();
    expect(app.pr!.flowError).toMatch(pattern);
    expect(app.pr!.files).toHaveLength(1);
  });
});

describe('flow references (#file): both parsers agree', () => {
  it('read the same files on the same steps, as decoded paths', () => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, ...REF_FILE_LINES, ...REF_STORY]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(appAccepts).toBe(true);
    expect(skill.flow).toEqual([REF_STORY_VALUE]);
    expect(app.pr!.flow).toEqual(skill.flow);
  });

  it('read an encoded path the same way', () => {
    const { skill, app } = both(record([...VALID, '+ docs/my%20notes%231.md', '#story s', '#step actor A', '#file docs/my%20notes%231.md']), '7.pr');
    expect(skill.errors).toEqual([]);
    expect(skill.flow).toEqual([{ title: 's', steps: [{ kind: 'actor', text: 'A', files: ['docs/my notes#1.md'] }], below: [] }]);
    expect(app.pr!.flow).toEqual(skill.flow);
  });

  it('accept the cap of six files on a step', () => {
    const { skill, app } = both(record([...VALID, ...REF_FILE_LINES, '#story s', '#step actor A', ...refLines(...REF_PATHS.slice(0, FILES_MAX))]), '7.pr');
    expect(skill.errors).toEqual([]);
    expect(skill.flow).toEqual([{ title: 's', steps: [{ kind: 'actor', text: 'A', files: REF_PATHS.slice(0, FILES_MAX) }], below: [] }]);
    expect(app.pr!.flow).toEqual(skill.flow);
  });

  it.each(REJECTED_REFERENCES)('both refuse %s: the skill errors, the app drops the flow and still shows the record', (_label, lines, pattern) => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, ...REF_FILE_LINES, ...lines]), '7.pr');
    expect(skillAccepts).toBe(false);
    expect(skill.errors.join('\n')).toMatch(pattern);
    expect(skill.flow).toEqual([]);
    expect(appAccepts).toBe(true);
    expect(app.pr!.flow).toBeUndefined();
    expect(app.pr!.flowError).toMatch(pattern);
    expect(app.pr!.files).toHaveLength(REF_PATHS.length);
  });

  it('name the same line for the same fault', () => {
    const { skill, app } = both(record([...VALID, ...REF_FILE_LINES, '#story s', '#step actor A', '#file src/zzz.ts']), '7.pr');
    expect(skill.errors[0]).toMatch(/:18: #file names/);
    expect(app.pr!.flowError).toMatch(/^line 18: #file names/);
  });
});

describe('description (#describe): both parsers agree', () => {
  const files = ['+ src/a.ts'];
  const describe_ = (section: string, text: string) => `#describe ${section} ${text}`;

  it('read the same sections and lines, in record order', () => {
    const lines = [describe_('what', 'Admins can refund.'), describe_('what', 'Second point.'), describe_('before', 'Only view.'), describe_('after', 'Can refund.'), describe_('verified', 'Tests green.')];
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, '#summary lead', ...lines, ...files]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(appAccepts).toBe(true);
    expect(skill.description).toEqual({ what: ['Admins can refund.', 'Second point.'], before: ['Only view.'], after: ['Can refund.'], verified: ['Tests green.'] });
    expect(app.pr!.description).toEqual(skill.description);
    expect(app.pr!.summary).toBe('lead');
  });

  it('read a record without a description as having none', () => {
    const { skill, app } = both(record([...VALID, ...files]), '7.pr');
    expect(skill.description).toEqual({});
    expect(app.pr).not.toHaveProperty('description');
  });

  it('accept the caps: 400 characters a line and 8 lines a section', () => {
    const lines = [describe_('what', 'x'.repeat(400)), ...Array.from({ length: 8 }, (_, i) => describe_('after', `line ${i}`))];
    const { skill, app, skillAccepts } = both(record([...VALID, ...lines, ...files]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(app.pr!.description).toEqual(skill.description);
    expect(app.pr!.description!.after).toHaveLength(8);
  });

  it.each([
    ['a comment marker', '<!-- internal --> Admins can refund.', 'Admins can refund.'],
    ['an unclosed comment marker', 'Admins can refund. <!-- cut', 'Admins can refund.'],
    ['a stray comment end', 'Admins can refund. -->', 'Admins can refund.'],
    ['a comment the browser closes with --!>', 'Admins <!-- internal --!>can refund.', 'Admins can refund.'],
    ['a comment closed at once by <!-->', 'Admins<!--> can refund.', 'Admins can refund.'],
    ['a comment marker that only appears once the first comment is gone', 'Admins <!<!-- x -->-- can refund.', 'Admins'],
    ['a comment end that only appears once the first one is gone', 'Admins can refund.--<!-- x -->>', 'Admins can refund.'],
  ])('both strip %s', (_label, raw, shown) => {
    const { skill, app, skillAccepts } = both(record([...VALID, describe_('what', raw), ...files]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(skill.description).toEqual({ what: [shown] });
    expect(app.pr!.description).toEqual({ what: [shown] });
  });

  it.each([
    ['a cost marker', '<!-- delegate:cost -->'],
    ['a cost block line', 'delegate:cost'],
    ['a cost table row', '| agent | model | effort | context |'],
    ['a line that is only a comment', '<!-- hidden -->'],
  ])('both drop %s and show nothing', (_label, raw) => {
    const { skill, app, skillAccepts } = both(record([...VALID, describe_('what', raw), ...files]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(skill.description).toEqual({});
    expect(app.pr).not.toHaveProperty('description');
  });

  it.each([
    ['an unknown section', describe_('bogus', 'x'), /unknown section "bogus"/],
    ['a section with no text', '#describe what', /the what text is empty/],
    ['no section at all', '#describe', /must be "#describe <section> <text>"/],
    ['a line over 400 characters', describe_('what', 'x'.repeat(401)), /cap is 400/],
    ['a control character', describe_('what', 'bad\u0001char'), /control character/],
  ])('the skill refuses %s while the app still shows the record without that line', (_label, line, pattern) => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, describe_('after', 'kept'), line, ...files]), '7.pr');
    expect(skillAccepts).toBe(false);
    expect(skill.errors.join('\n')).toMatch(pattern);
    expect(appAccepts).toBe(true);
    expect(app.pr!.description).toEqual({ after: ['kept'] });
    expect(app.pr!.files).toHaveLength(1);
  });

  it('the skill refuses a ninth line in a section and the app keeps the first eight', () => {
    const lines = Array.from({ length: 9 }, (_, i) => describe_('what', `line ${i}`));
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, ...lines, ...files]), '7.pr');
    expect(skillAccepts).toBe(false);
    expect(skill.errors.join('\n')).toMatch(/more than 8 #describe what lines/);
    expect(appAccepts).toBe(true);
    expect(app.pr!.description!.what).toEqual(skill.description.what);
    expect(app.pr!.description!.what).toHaveLength(8);
  });
});

describe('plan ticks (#plan): both parsers agree', () => {
  const files = ['+ src/a.ts'];

  it('read the same slug and item pairs, in record order', () => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, '#plan add-planning s1.1', '#plan add-planning s1.2', '#plan other-plan s2.1', ...files]), '7.pr');
    expect(skillAccepts).toBe(true);
    expect(appAccepts).toBe(true);
    const expected = [
      { slug: 'add-planning', item: 's1.1' },
      { slug: 'add-planning', item: 's1.2' },
      { slug: 'other-plan', item: 's2.1' },
    ];
    expect(skill.plans).toEqual(expected);
    expect(app.pr!.plans).toEqual(expected);
  });

  it('read a tab between the tag and its text the same way', () => {
    const { skill, app } = both(record([...VALID, '#plan\tadd-planning\ts1.1', ...files]), '7.pr');
    expect(skill.plans).toEqual([{ slug: 'add-planning', item: 's1.1' }]);
    expect(app.pr!.plans).toEqual(skill.plans);
  });

  it('read a record without a tick as having none', () => {
    const { skill, app } = both(record([...VALID, ...files]), '7.pr');
    expect(skill.plans).toEqual([]);
    expect(app.pr).not.toHaveProperty('plans');
  });

  it.each([
    ['a plan with no item', '#plan add-planning'],
    ['an item with no plan', '#plan'],
    ['a third word', '#plan add-planning s1.1 now'],
    ['a slug that is not kebab-case', '#plan Add_Planning s1.1'],
    ['an item with a space', '#plan add-planning s1 .1'],
  ])('the skill refuses %s while the app still shows the record without that tick', (_label, line) => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, '#plan keep-me s1.1', line, ...files]), '7.pr');
    expect(skillAccepts).toBe(false);
    expect(skill.errors.join('\n')).toMatch(/#plan must be/);
    expect(appAccepts).toBe(true);
    expect(app.pr!.plans).toEqual([{ slug: 'keep-me', item: 's1.1' }]);
    expect(app.pr!.files).toHaveLength(1);
  });

  it('the skill refuses a repeated tick and the app keeps one', () => {
    const { skill, app, skillAccepts, appAccepts } = both(record([...VALID, '#plan keep-me s1.1', '#plan keep-me s1.1', ...files]), '7.pr');
    expect(skillAccepts).toBe(false);
    expect(skill.errors.join('\n')).toMatch(/duplicate #plan/);
    expect(appAccepts).toBe(true);
    expect(app.pr!.plans).toEqual([{ slug: 'keep-me', item: 's1.1' }]);
  });
});

describe('dismissed marker: skill parser', () => {
  const HEADER = 'lantern-prs-dismissed 1';

  it('accepts a valid file and ignores comments and blank lines', () => {
    const parsed = parseDismissed(`${HEADER}\n# note\n\n7\n9\n42\n`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.ids).toEqual(['7', '9', '42']);
  });

  it('accepts a header-only file', () => {
    expect(parseDismissed(`${HEADER}\n`)).toMatchObject({ ids: [], errors: [], warnings: [] });
  });

  it.each([
    ['missing header', '7\n9\n'],
    ['wrong header', 'lantern-prs-dismissed 2\n7\n'],
    ['non-digit id', `${HEADER}\nabc\n`],
    ['signed id', `${HEADER}\n-7\n`],
    ['two ids on a line', `${HEADER}\n7 9\n`],
    ['duplicate id', `${HEADER}\n7\n7\n`],
    ['unknown line', `${HEADER}\n7\nmerged\n`],
  ])('rejects %s', (_label, text) => {
    expect(parseDismissed(text).errors.length).toBeGreaterThan(0);
  });

  it('warns, without an error, when ids are not sorted numerically', () => {
    const parsed = parseDismissed(`${HEADER}\n9\n10\n7\n`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parseDismissed(`${HEADER}\n9\n10\n`).warnings).toEqual([]);
  });

  it('serializes sorted, unique, byte-exact, and the result parses clean', () => {
    const text = serializeDismissed(['42', '7', '42', '100', '9']);
    expect(text).toBe(`${HEADER}\n7\n9\n42\n100\n`);
    expect(parseDismissed(text)).toMatchObject({ ids: ['7', '9', '42', '100'], errors: [], warnings: [] });
  });
});
