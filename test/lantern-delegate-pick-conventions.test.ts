import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', 'skills');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const SKILL = read('lantern-delegate', 'SKILL.md');
const REVIEWER = {
  'lantern-code-reviewer/SKILL.md': read('lantern-code-reviewer', 'SKILL.md'),
  'lantern-code-reviewer/README.md': read('lantern-code-reviewer', 'README.md'),
  'lantern-delegate/agents/reviewer.md': read('lantern-delegate', 'agents', 'reviewer.md'),
};

const BARE = /<skill linker(?: path)?>\s+\.(?=[\s`.,;:)]|$)(?!\s*--skill)/gi;

describe('the delegate picks the conventions, the skill linker lists and links', () => {
  it('has the agent list with --list and link only with --skill', () => {
    expect(SKILL).toMatch(/skill linker(?: path)?>\s+--list/i);
    expect(SKILL).toMatch(/\. --skill <name>/);
  });

  it('says skill linker detection and `<skill linker path> .` do not decide', () => {
    expect(SKILL).toMatch(/never[^.\n]*(`<Skill linker> \.`|`<skill linker path> \.`)/i);
    expect(SKILL).toMatch(/detection/i);
  });

  it('says a missing language convention goes in the report', () => {
    expect(SKILL).toMatch(/no <language> convention available/);
  });

  it('never instructs running bare `<skill linker path> .`', () => {
    const offenders = [...SKILL.matchAll(BARE)].filter((match) => {
      const before = SKILL.slice(Math.max(0, (match.index ?? 0) - 40), match.index);
      return !/\b(never|no|not)\b[^.]*$/i.test(before);
    });
    expect(offenders.map((match) => match[0])).toEqual([]);
  });

  it('says the skill linker only lists and links while the agent chooses', () => {
    expect(SKILL).toMatch(/only lists and links; the agent\s+chooses/);
  });

  it('treats manifests and languages as examples, not a closed list', () => {
    expect(SKILL).toMatch(/not a list\s+to choose from/);
    expect(SKILL).toMatch(/`go\.mod`/);
  });

  it('has no role table', () => {
    expect(SKILL).not.toMatch(/role table/);
  });
});

describe('the reviewer works from the conventions the project has linked', () => {
  it('says a missing language convention goes under UNAVAILABLE and the review goes ahead', () => {
    const text = REVIEWER['lantern-code-reviewer/SKILL.md'];
    expect(text).toMatch(/no <name or language> convention available/);
    expect(text).toMatch(/no Go convention available/);
    expect(text).toMatch(/UNAVAILABLE:/);
  });

  it('treats manifests and languages as examples, and the extensions of the changed files as enough', () => {
    const text = REVIEWER['lantern-code-reviewer/SKILL.md'];
    expect(text).toMatch(/not a list\s+to choose from/);
    expect(text).toMatch(/`go\.mod`/);
    expect(text).toMatch(/extensions of the changed files are always enough/);
  });

  it('names only lantern-no-comments as required', () => {
    expect(REVIEWER['lantern-code-reviewer/SKILL.md']).toMatch(/\*\*Required:\*\* `lantern-no-comments`/);
    expect(REVIEWER['lantern-code-reviewer/SKILL.md']).toMatch(/Only `lantern-no-comments` is required/);
  });

  it('runs the reviewer list first, in the agent definition and in the skill', () => {
    expect(REVIEWER['lantern-delegate/agents/reviewer.md']).toMatch(/required-skills\.mjs --role reviewer/);
    expect(REVIEWER['lantern-code-reviewer/SKILL.md']).toMatch(/required-skills\.mjs --role reviewer/);
  });

  it('has no skill linker instruction', () => {
    for (const [name, text] of Object.entries(REVIEWER)) {
      expect(text, name).not.toMatch(/skill[- ]?linker/i);
      expect(text, name).not.toMatch(/--skill\b/);
    }
  });

  it('has no language-per-bullet table of options', () => {
    const lines = Object.values(REVIEWER).flatMap((text) => text.split('\n'));
    expect(lines.filter((line) => /^\s*[-*]\s+(Python|Rust|Anything else|JavaScript)\b/.test(line))).toEqual([]);
  });
});
