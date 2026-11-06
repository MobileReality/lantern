import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLE_SKILLS } from '../scripts/lantern-bundle.mjs';

const SKILLS = path.join(__dirname, '..', 'skills');
const GENERIC_SKILLS = ['lantern-commit', 'lantern-local-loop', 'lantern-no-comments', 'lantern-code-reviewer'];
const PLANNING_SKILLS = ['lantern-plan', 'lantern-plan-impact', 'lantern-plan-stages', 'lantern-plan-review', 'lantern-plan-handoff'];
const INTEGRATION_SKILLS = ['lantern-jira', 'lantern-bitbucket', 'lantern-github'];
const SKILL_LINKER = /skill[- ]?linker/i;
const LEAVING_LINK = /\]\(\.\.\//;
const SKILL_LINKER_ALLOWED = (rel: string) => rel.startsWith('lantern-delegate/');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return files(p);
    return d.isFile() && d.name !== '.DS_Store' ? [p] : [];
  });
}

const genericFiles = () => GENERIC_SKILLS.flatMap((name) => files(path.join(SKILLS, name)));
const offending = (list: string[], pattern: RegExp) => list.filter((f) => pattern.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SKILLS, f));

describe('bundled skills stand alone', () => {
  it('ships the Lantern skills, the planning skills, the generic ones and the integration skills', () => {
    expect(BUNDLE_SKILLS.map((s) => s.name)).toEqual(['lantern-setup', 'lantern-sync', 'lantern-delegate', 'lantern-delegate-complex', ...PLANNING_SKILLS, ...GENERIC_SKILLS, ...INTEGRATION_SKILLS]);
  });

  it('has a folder under skills/ for each bundled skill and for nothing else', () => {
    const folders = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(folders.sort()).toEqual(BUNDLE_SKILLS.map((s: { name: string }) => s.name).sort());
  });

  it('keeps every planning skill a folder of its own with a SKILL.md named after it', () => {
    for (const name of PLANNING_SKILLS) {
      const text = fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
      expect(text, name).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
    }
  });

  it('has no relative link that leaves the bundle', () => {
    expect(offending(genericFiles(), LEAVING_LINK)).toEqual([]);
  });

  it('mentions the skill linker only in lantern-delegate', () => {
    const all = BUNDLE_SKILLS.flatMap(({ name }) => files(path.join(SKILLS, name)));
    expect(offending(all, SKILL_LINKER).filter((rel) => !SKILL_LINKER_ALLOWED(rel))).toEqual([]);
  });

  it('keeps lantern-local-loop/scripts/loop.sh executable', () => {
    expect(fs.statSync(path.join(SKILLS, 'lantern-local-loop', 'scripts', 'loop.sh')).mode & 0o111).not.toBe(0);
  });
});
