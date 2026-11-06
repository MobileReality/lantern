import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enumerate, hashContent, loadMap, loadRoles, parseMapFile } from '../skills/lantern-setup/scripts/lib.mjs';
import { isIncluded, parseIgnore } from '../skills/lantern-setup/scripts/ignore.mjs';

const SETUP = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts');

let project: string;

function write(rel: string, text = '# text\n') {
  const file = path.join(project, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function listed() {
  return enumerate(project).map((f: { path: string }) => f.path);
}

function script(name: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [path.join(SETUP, name), ...args], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, LANTERN_LANG: 'en' } });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skillfiles-'));
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

describe('which markdown is mapped', () => {
  it('maps the files of a skill folder, nested ones included', () => {
    write('skills/commit/SKILL.md');
    write('skills/commit/README.md');
    write('skills/commit/protocol.md');
    write('skills/commit/references/rules.md');
    write('skills/commit/templates/message.md');
    write('skills/commit/deep/er/notes.md');
    expect(listed()).toEqual(['skills/commit/README.md', 'skills/commit/SKILL.md', 'skills/commit/deep/er/notes.md', 'skills/commit/protocol.md', 'skills/commit/references/rules.md', 'skills/commit/templates/message.md']);
  });

  it('maps the named instruction files at any depth and copilot instructions', () => {
    for (const rel of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'packages/api/CLAUDE.md', 'packages/api/AGENTS.md', '.github/copilot-instructions.md']) write(rel);
    expect(listed()).toEqual(['.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'packages/api/AGENTS.md', 'packages/api/CLAUDE.md']);
  });

  it('maps a SKILL.md outside any skills folder and the folder around it', () => {
    write('tools/review/SKILL.md');
    write('tools/review/checklist.md');
    write('tools/other/checklist.md');
    expect(listed()).toEqual(['tools/review/SKILL.md', 'tools/review/checklist.md']);
  });

  it('leaves ordinary documentation unmapped', () => {
    for (const rel of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'docs/guide.md', 'docs/api/index.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug.md', 'src/NOTES.md', 'agents.md', 'claude.md']) write(rel);
    write('src/index.ts', 'export const x = 1;\n');
    expect(listed()).toEqual(['src/index.ts']);
  });

  it('maps the root .claude commands, agents, rules and skills, markdown only', () => {
    write('.claude/commands/ship.md');
    write('.claude/commands/team/review.md');
    write('.claude/agents/reviewer.md');
    write('.claude/rules/style.md');
    write('.claude/skills/local/SKILL.md');
    write('.claude/skills/local/protocol.md');
    write('.claude/skills/local/scripts/run.mjs', 'export const run = 1;\n');
    write('.claude/skills/stray.md');
    write('.claude/settings.json', '{}\n');
    write('.claude/notes.md');
    write('.claude/hooks/pre.md');
    write('.claude/hooks/pre.sh', '#!/bin/sh\n');
    expect(listed()).toEqual(['.claude/agents/reviewer.md', '.claude/commands/ship.md', '.claude/commands/team/review.md', '.claude/rules/style.md', '.claude/skills/local/SKILL.md', '.claude/skills/local/protocol.md']);
  });

  it('leaves out what the Lantern app installed into .claude, and keeps the project\'s own', () => {
    write('.claude/skills/lantern-setup/SKILL.md');
    write('.claude/skills/lantern-setup/references/format.md');
    write('.claude/skills/lantern-setup/.lantern-bundle', 'abc123\n');
    write('.claude/skills/mine/SKILL.md');
    write('.claude/skills/mine/protocol.md');
    write('.claude/agents/lantern-mapper.md');
    write('.claude/agents/lantern-delegate-low.md');
    write('.claude/agents/reviewer.md');
    write('.claude/agents/.lantern-bundle-agents', 'abc123\nlantern-delegate-low.md\nreviewer.md\n');
    write('.claude/agents/triage.md');
    write('skills/commit/SKILL.md');
    write('skills/commit/vendored/SKILL.md');
    write('skills/commit/vendored/.lantern-bundle', 'abc123\n');
    expect(listed()).toEqual(['.claude/agents/triage.md', '.claude/skills/mine/SKILL.md', '.claude/skills/mine/protocol.md', 'skills/commit/SKILL.md']);
  });

  it('does not walk a .claude folder below the root', () => {
    write('packages/web/.claude/commands/ship.md');
    write('packages/web/.claude/skills/local/SKILL.md');
    expect(listed()).toEqual([]);
  });

  it('never reaches into dependency folders, even inside a skill', () => {
    write('skills/commit/SKILL.md');
    write('skills/commit/node_modules/pkg/README.md');
    write('skills/commit/scripts/vendor/x.md');
    expect(listed()).toEqual(['skills/commit/SKILL.md']);
  });

  it('skips empty, oversized, binary and generated markdown like any source', () => {
    write('skills/commit/SKILL.md');
    write('skills/commit/empty.md', '');
    write('skills/commit/huge.md', 'a'.repeat(1024 * 1024 + 1));
    write('skills/commit/blob.md', 'a\0b');
    write('skills/commit/gen.md', '<!-- @generated by tool -->\n# x\n');
    expect(listed()).toEqual(['skills/commit/SKILL.md']);
  });

  it('keeps code in skill folders mapped as before', () => {
    write('skills/commit/SKILL.md');
    write('skills/commit/scripts/run.mjs', 'export const run = 1;\n');
    expect(listed()).toEqual(['skills/commit/SKILL.md', 'skills/commit/scripts/run.mjs']);
  });
});

describe('.gitignore, .lantern/ignore and .lantern/include', () => {
  it('lets the project ignore a skill file with its existing mechanisms', () => {
    write('skills/commit/SKILL.md');
    write('skills/commit/draft.md');
    write('skills/commit/legacy/old.md');
    write('skills/commit/.gitignore', 'draft.md\n');
    write('.lantern/ignore', 'skills/commit/legacy/\n');
    expect(listed()).toEqual(['skills/commit/SKILL.md']);
  });

  it('adds markdown named in .lantern/include, nothing else', () => {
    write('docs/architecture.md');
    write('docs/guide.md');
    write('docs/api/index.md');
    write('docs/diagram.png', 'x');
    write('src/index.ts', 'export const x = 1;\n');
    write('.lantern/include', 'docs/architecture.md\ndocs/api/\n');
    expect(listed()).toEqual(['docs/api/index.md', 'docs/architecture.md', 'src/index.ts']);
  });

  it('applies include patterns written with a glob, a bare folder and a negation', () => {
    write('docs/a.md');
    write('docs/b.md');
    write('notes/c.md');
    write('.lantern/include', 'docs/**\n!docs/b.md\nnotes\n');
    expect(listed()).toEqual(['docs/a.md', 'notes/c.md']);
  });

  it('lets ignore win over include, and never includes ignored or skipped folders', () => {
    write('docs/a.md');
    write('docs/private/b.md');
    write('node_modules/pkg/README.md');
    write('build/out.md');
    write('.lantern/include', 'docs/\nnode_modules/\nbuild/\n');
    write('.lantern/ignore', 'docs/private/\n');
    write('.gitignore', 'build/\n');
    expect(listed()).toEqual(['docs/a.md']);
  });

  it('matches include rules against folders and files without a regex per call site', () => {
    const rules = parseIgnore('docs/\n!docs/private/\n*.rules.md\n', '');
    expect(isIncluded(rules, 'docs/a.md')).toBe(true);
    expect(isIncluded(rules, 'docs/deep/er/a.md')).toBe(true);
    expect(isIncluded(rules, 'docs/private/a.md')).toBe(false);
    expect(isIncluded(rules, 'src/x.rules.md')).toBe(true);
    expect(isIncluded(rules, 'src/x.md')).toBe(false);
  });
});

describe('role skill and the @ relation', () => {
  function mapProject(records: Record<string, { role: string; relations?: string[] }>, extra: Record<string, string> = {}) {
    const sources: Record<string, string> = {
      'skills/commit/SKILL.md': '---\nname: commit\n---\nRead protocol.md and run scripts/run.mjs.\n',
      'skills/commit/protocol.md': '# protocol\n',
      'skills/commit/scripts/run.mjs': 'export function runCommit() {}\n',
      ...extra,
    };
    for (const [rel, text] of Object.entries(sources)) write(rel, text);
    const byDir = new Map<string, string[]>();
    for (const [rel, record] of Object.entries(records)) {
      const dir = path.posix.dirname(rel);
      const hash = hashContent(Buffer.from(sources[rel]));
      const lines = [`${rel} . ${record.role} ${hash}`, ...(record.relations ?? []).map((r) => `  ${r}`)];
      byDir.set(dir, [...(byDir.get(dir) ?? []), ...lines]);
    }
    for (const [dir, lines] of byDir) {
      write(`.lantern/map/${dir}.lantern`, `lantern 1\n# ${dir}\n\n${lines.join('\n')}\n`);
      const names = Object.keys(records).filter((rel) => path.posix.dirname(rel) === dir);
      const text = Object.fromEntries(names.map((rel) => [path.posix.basename(rel), `purpose of ${rel}`]));
      write(`.lantern/lang/en/${dir}.lantern.json`, JSON.stringify({ text }));
    }
  }

  const validate = () => script('validate.mjs', project, '--settled');

  it('lists skill in the vocabulary', () => {
    expect(loadRoles().has('skill')).toBe(true);
  });

  it('accepts a skill record whose relations are references', () => {
    mapProject({
      'skills/commit/SKILL.md': { role: 'skill', relations: ['@ skills/commit/protocol.md', '@ skills/commit/scripts/run.mjs#runCommit', '@ ext:bitbucket-api'] },
      'skills/commit/protocol.md': { role: 'skill' },
      'skills/commit/scripts/run.mjs': { role: 'script' },
    });
    const result = validate();
    expect(result.out).toContain('OK');
    expect(result.status).toBe(0);
  });

  it('keeps data arrows for every other role', () => {
    mapProject({
      'skills/commit/SKILL.md': { role: 'skill', relations: ['@ skills/commit/protocol.md'] },
      'skills/commit/protocol.md': { role: 'skill' },
      'skills/commit/scripts/run.mjs': { role: 'script', relations: ['< skills/commit/protocol.md'] },
    });
    expect(validate().status).toBe(0);
  });

  it('rejects @ on a record that is not a skill file', () => {
    mapProject({
      'skills/commit/SKILL.md': { role: 'skill' },
      'skills/commit/protocol.md': { role: 'skill' },
      'skills/commit/scripts/run.mjs': { role: 'script', relations: ['@ skills/commit/protocol.md'] },
    });
    const result = validate();
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/"@" relations belong to role skill files; skills\/commit\/scripts\/run\.mjs is script/);
  });

  it('rejects a data arrow on a skill record', () => {
    mapProject({
      'skills/commit/SKILL.md': { role: 'skill', relations: ['> skills/commit/protocol.md'] },
      'skills/commit/protocol.md': { role: 'skill' },
      'skills/commit/scripts/run.mjs': { role: 'script' },
    });
    const result = validate();
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/a skill file refers to its targets, write "@ skills\/commit\/protocol\.md"/);
  });

  it('keeps the skill role to markdown files', () => {
    mapProject({
      'skills/commit/SKILL.md': { role: 'skill' },
      'skills/commit/protocol.md': { role: 'skill' },
      'skills/commit/scripts/run.mjs': { role: 'skill' },
    });
    const result = validate();
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/role skill is for markdown files; skills\/commit\/scripts\/run\.mjs is not one/);
  });

  it('lets a markdown file added by .lantern/include carry another role, such as ai for a runtime prompt', () => {
    mapProject(
      {
        'skills/commit/SKILL.md': { role: 'skill' },
        'skills/commit/protocol.md': { role: 'skill' },
        'skills/commit/scripts/run.mjs': { role: 'script' },
        'prompts/triage.md': { role: 'ai' },
      },
      { 'prompts/triage.md': 'You triage tickets.\n', '.lantern/include': 'prompts/\n' },
    );
    expect(validate().status).toBe(0);
  });

  it('rejects a reference to a file that is not mapped or a symbol that is not there', () => {
    mapProject({
      'skills/commit/SKILL.md': { role: 'skill', relations: ['@ skills/commit/missing.md', '@ skills/commit/scripts/run.mjs#nothingHere'] },
      'skills/commit/protocol.md': { role: 'skill' },
      'skills/commit/scripts/run.mjs': { role: 'script' },
    });
    const result = validate();
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/dangling — skills\/commit\/missing\.md is not a mapped file/);
    expect(result.out).toMatch(/symbol "nothingHere" not found in skills\/commit\/scripts\/run\.mjs/);
  });

  it('flags a reference to the file itself', () => {
    mapProject({
      'skills/commit/SKILL.md': { role: 'skill', relations: ['@ skills/commit/SKILL.md'] },
      'skills/commit/protocol.md': { role: 'skill' },
      'skills/commit/scripts/run.mjs': { role: 'script' },
    });
    expect(validate().out).toMatch(/relation points at its own file/);
  });

  it('reports markdown without a record as unmapped on an old map, and nothing else', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('skills/commit/SKILL.md', '# skill\n');
    const hash = hashContent(Buffer.from('export const a = 1;\n'));
    write('.lantern/map/src.lantern', `lantern 1\n# src\n\nsrc/a.ts . util ${hash}\n`);
    write('.lantern/lang/en/src.lantern.json', JSON.stringify({ text: { 'a.ts': 'a' } }));
    const result = validate();
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/unmapped: skills\/commit\/SKILL\.md has no record \(expected in \.lantern\/map\/skills\/commit\.lantern\)/);
    expect(result.out.match(/^ {2}(unmapped|.*stale|.*dangling).*$/gm)).toHaveLength(1);
    expect(script('plan.mjs', project, 'pending').out).toMatch(/chunk 1: 2 files, \d+ bytes, 1 pending/);
  });

  it('still parses and role-checks the committed maps made before markdown was mapped', () => {
    const roles = loadRoles();
    for (const sample of ['example-web/demo-sections', 'example-web/demo-ai', 'example-web/demo-platforms']) {
      const { records, errors } = loadMap(path.join(SETUP, '..', sample));
      expect(errors, sample).toEqual([]);
      expect(records.length, sample).toBeGreaterThan(5);
      for (const record of records) {
        expect(roles.has(record.role), `${sample} ${record.path}`).toBe(true);
        expect(record.relations.every((r: { arrow: string }) => r.arrow !== '@'), `${sample} ${record.path}`).toBe(true);
      }
    }
  });

  it('keeps an old map with only code records valid, settled', () => {
    write('src/a.ts', 'export const a = 1;\n');
    const hash = hashContent(Buffer.from('export const a = 1;\n'));
    write('.lantern/map/src.lantern', `lantern 1\n# src\n\nsrc/a.ts . util ${hash}\n`);
    write('.lantern/lang/en/src.lantern.json', JSON.stringify({ text: { 'a.ts': 'a' } }));
    write('README.md', '# readme\n');
    write('docs/guide.md', '# guide\n');
    const result = validate();
    expect(result.status).toBe(0);
    expect(result.out).toContain('coverage 1/1 (100.0%)');
  });

  it('parses an @ relation like any other with its label key', () => {
    const parsed = parseMapFile(`lantern 1\n# skills/commit\n\nskills/commit/SKILL.md . skill 3f9a1c2b4d5e\n  @ skills/commit/protocol.md | read first\n`, '.lantern/map/skills/commit.lantern');
    expect(parsed.errors).toEqual([]);
    expect(parsed.records[0].relations).toEqual([expect.objectContaining({ arrow: '@', path: 'skills/commit/protocol.md', symbol: null, label: 'read first' })]);
  });
});
