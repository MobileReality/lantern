import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module, no declarations
import { BUNDLED_SKILLS, REVIEWER_SKILLS } from '../skills/lantern-delegate/scripts/bundled-skills.mjs';
// @ts-expect-error plain ES module, no declarations
import { requiredSkills, ROLE } from '../skills/lantern-delegate/scripts/required-skills.mjs';

const SKILL_NAME = 'lantern-code-reviewer';
const FILES = {
  'SKILL.md': path.join(__dirname, '..', 'skills', SKILL_NAME, 'SKILL.md'),
  'README.md': path.join(__dirname, '..', 'skills', SKILL_NAME, 'README.md'),
  'agents/reviewer.md': path.join(__dirname, '..', 'skills', 'lantern-delegate', 'agents', 'reviewer.md'),
};
const text = (name: keyof typeof FILES) => fs.readFileSync(FILES[name], 'utf8');

const VERDICT_WORDS = ['approve', 'blocked', 'fix-first', 'merge', 'merge-with-followups', 'no-merge', 'pass', 'reject'];
const TOOL_WORDS = ['general-purpose', 'limit', 'medium', 'offset', 'reviewer'];
const NOT_SKILLS = [...VERDICT_WORDS, ...TOOL_WORDS];

const backticked = (source: string): string[] => [...source.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((match) => match[1]);
const description = (source: string): string => source.split('\n').find((row) => row.startsWith('description:')) ?? '';
const hyphenated = (source: string): string[] => source.match(/\b[a-z]+(?:-[a-z]+)+\b/g) ?? [];

describe('the reviewer skill and its required list', () => {
  it('is named after its folder and is the last fixed skill of the reviewer role', () => {
    expect(text('SKILL.md')).toMatch(new RegExp(`^---\\nname: ${SKILL_NAME}\\n`));
    expect(REVIEWER_SKILLS.at(-1)).toBe(SKILL_NAME);
    expect(BUNDLED_SKILLS).toContain(SKILL_NAME);
  });

  it('requires exactly the role list of required-skills.mjs, and the text names as required the same skills but itself', () => {
    expect(requiredSkills(ROLE.reviewer)).toEqual(REVIEWER_SKILLS);
    const line = text('SKILL.md')
      .split('\n')
      .find((row) => row.startsWith('- **Required:**'))!;
    expect(backticked(line)).toEqual(REVIEWER_SKILLS.filter((name: string) => name !== SKILL_NAME));
    expect(text('SKILL.md')).toMatch(/Only `lantern-no-comments` is required/);
  });

  it.each(Object.keys(FILES) as Array<keyof typeof FILES>)('%s names no skill outside the bundle', (name) => {
    const named = [...backticked(text(name)), ...hyphenated(description(text(name)))];
    const outside = [...new Set(named)].filter((word) => !BUNDLED_SKILLS.includes(word) && !NOT_SKILLS.includes(word));
    expect(outside).toEqual([]);
  });

  it('works from the conventions the project has linked and says what an absent one looks like', () => {
    const skill = text('SKILL.md');
    expect(skill).toContain('the conventions the project has linked');
    expect(skill).toMatch(/no <name or language> convention available/);
    expect(skill).toMatch(/Every other convention is optional/);
  });

  it('has the reviewer agent run the reviewer list first and read every skill it prints in full', () => {
    const agent = text('agents/reviewer.md');
    expect(agent).toContain('required-skills.mjs --role reviewer');
    expect(agent).toMatch(/in full, no `limit` and no `offset`/);
    expect(agent).not.toContain(SKILL_NAME);
  });
});
