import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PLAN_REF, SLUG } from '../skills/lantern-plan/scripts/plan-format.mjs';
import { parsePrRecord } from '../src/main/lantern-pr-parse';
import { REPO, SKILLS, importScript } from './helpers/lantern-plan-world';

type Constants = Record<string, unknown>;

let format: Constants;
let parsePr: (text: string, file: string) => { plans: { slug: string; item: string }[]; errors: string[] };

beforeAll(async () => {
  format = await importScript<Constants>('plan-format.mjs');
  parsePr = (await import(path.join(SKILLS, 'lantern-setup', 'scripts', 'prs.mjs'))).parsePr;
});

const DECLARATION = fs.readFileSync(path.join(REPO, 'src', 'main', 'skill-scripts.d.ts'), 'utf8');
const PLAN_FORMAT_BLOCK = DECLARATION.slice(DECLARATION.indexOf("declare module '*/lantern-plan/scripts/plan-format.mjs'"));
const OBJECTS = ['TAG', 'SECTION', 'SCOPE_SIDE', 'TARGET_KIND', 'ITEM_STATUS', 'SECTION_STATE', 'PLAN_STATE', 'PR_STATE'];
const SCALARS = ['PLAN_HEADER', 'PLAN_DIR', 'PLAN_EXT', 'PLAN_LEVEL', 'DIGEST_LENGTH', 'SLUG', 'STAGE_ID', 'ITEM_ID', 'QUESTION_ID', 'PLAN_REF', 'WHO', 'ISO_DATE', 'DIGEST', 'hasControlCharacter', 'TAG_LINE', 'ID_LINE', 'LIMITS', 'TARGET_KINDS', 'tagLine', 'isIsoDate', 'isPathKind'];

describe('the typed view of plan-format.mjs matches the module', () => {
  it.each(OBJECTS)('%s lists the same keys and values as the declaration', (name) => {
    for (const [key, value] of Object.entries(format[name] as Record<string, string>)) expect(PLAN_FORMAT_BLOCK, `${name}.${key}`).toContain(`readonly ${key}: '${value}'`);
  });

  it.each(SCALARS)('%s is declared', (name) => {
    expect(format).toHaveProperty(name);
    expect(PLAN_FORMAT_BLOCK).toMatch(new RegExp(`export (const|function) ${name}\\b`));
  });

  it('declares nothing the module does not export', () => {
    const declared = [...PLAN_FORMAT_BLOCK.matchAll(/export (?:const|function) (\w+)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...OBJECTS, ...SCALARS].sort());
    expect(Object.keys(format).sort()).toEqual(declared.sort());
  });

  it('freezes the const objects', () => {
    for (const name of OBJECTS) expect(Object.isFrozen(format[name]), name).toBe(true);
  });
});

describe('one PLAN_REF for the #plan record line', () => {
  const accepted = ['#plan add-planning s1.1', '#plan add-planning s12.30', '#plan\tadd-planning\ts1.1', '#plan a s1.1  '];
  const refused = ['#plan', '#plan add-planning', '#plan add-planning s1', '#plan add-planning a.1', '#plan add-planning s0.1', '#plan add-planning s1.01', '#plan Add_Planning s1.1', `#plan ${'a'.repeat(41)} s1.1`, '#plan add-planning s1.1 now'];

  it.each(accepted)('accepts %j', (line) => {
    expect(PLAN_REF.test(line)).toBe(true);
  });

  it.each(refused)('refuses %j', (line) => {
    expect(PLAN_REF.test(line)).toBe(false);
  });

  it('is the pattern behind the slugs of the plan format', () => {
    expect(SLUG.test('a'.repeat(40))).toBe(true);
    expect(SLUG.test('a'.repeat(41))).toBe(false);
  });

  const HEADER = ['lantern-pr 1', '# 7', '#title t', '#url https://x.test/7', '#branch b', '#base main', '#opened 2026-09-30', `#head ${'3'.repeat(40)}`];
  const record = (line: string) => `${[...HEADER, line, '+ src/a.ts'].join('\n')}\n`;

  it.each([...accepted, ...refused].filter((line) => line.startsWith('#plan')))('the skill record parser and the app parser agree on %j', (line) => {
    const skill = parsePr(record(line.trimEnd()), '.lantern/prs/7.pr');
    const app = parsePrRecord(record(line.trimEnd()), '7.pr');
    expect(app.pr?.plans ?? []).toEqual(skill.plans);
    expect(skill.errors.length === 0).toBe(PLAN_REF.test(line.trimEnd()));
  });
});
