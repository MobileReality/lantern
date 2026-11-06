import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enumerate, loadMap } from '../skills/lantern-setup/scripts/lib.mjs';
import { findReferences } from '../skills/lantern-setup/scripts/refs.mjs';

const SETUP = path.join(__dirname, '..', 'skills', 'lantern-setup');
const FIXTURE = path.join(SETUP, 'example-web', 'demo-skills');
const REFS = path.join(SETUP, 'scripts', 'refs.mjs');
const VALIDATE = path.join(SETUP, 'scripts', 'validate.mjs');

const DROPPED_BY_THE_MAPPER = new Map([['skills/deploy/agents/verifier.md', ['skills/deploy/scripts/rollback.sh']]]);

interface Reference {
  path: string;
  via: string[];
  lines: number[];
  alternatives?: string[];
}

function run(script: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, LANTERN_LANG: 'en' } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('the demo-skills fixture', () => {
  it('is a settled map: every file mapped, hashes current', () => {
    const result = run(VALIDATE, FIXTURE, '--settled');
    expect(result.stdout).toContain('coverage 9/9 (100.0%), 9 records');
    expect(result.stdout).toContain('OK');
    expect(result.status).toBe(0);
  });

  it('maps skill files and what they point at, and leaves ordinary docs out', () => {
    const mapped = enumerate(FIXTURE).map((f: { path: string }) => f.path);
    expect(mapped).toEqual([
      '.claude/commands/ship.md',
      'CLAUDE.md',
      'skills/commit/SKILL.md',
      'skills/deploy/SKILL.md',
      'skills/deploy/agents/verifier.md',
      'skills/deploy/protocol.md',
      'skills/deploy/references/checklist.md',
      'skills/deploy/scripts/preflight.mjs',
      'skills/deploy/scripts/rollback.sh',
    ]);
  });

  it('records the exact expected reference list for every skill file', () => {
    const { records } = loadMap(FIXTURE);
    const expected = Object.fromEntries(records.filter((r: { role: string }) => r.role === 'skill').map((r: { path: string; relations: { path: string }[] }) => [r.path, r.relations.map((rel) => rel.path)]));
    expect(expected).toEqual({
      '.claude/commands/ship.md': ['skills/deploy/SKILL.md', 'skills/deploy/protocol.md'],
      'CLAUDE.md': ['skills/commit/SKILL.md', 'skills/deploy/SKILL.md'],
      'skills/commit/SKILL.md': [],
      'skills/deploy/SKILL.md': ['skills/commit/SKILL.md', 'skills/deploy/agents/verifier.md', 'skills/deploy/protocol.md', 'skills/deploy/references/checklist.md', 'skills/deploy/scripts/preflight.mjs'],
      'skills/deploy/agents/verifier.md': ['skills/deploy/references/checklist.md', 'skills/deploy/scripts/preflight.mjs'],
      'skills/deploy/protocol.md': ['skills/deploy/SKILL.md', 'skills/deploy/references/checklist.md', 'skills/deploy/scripts/preflight.mjs', 'skills/deploy/scripts/rollback.sh'],
      'skills/deploy/references/checklist.md': ['skills/deploy/scripts/preflight.mjs', 'skills/deploy/scripts/rollback.sh'],
    });
  });

  it('finds every recorded relation as a candidate, and only the documented one more', () => {
    const { records } = loadMap(FIXTURE);
    for (const record of records.filter((r: { role: string }) => r.role === 'skill')) {
      const candidates = findReferences(FIXTURE, record.path).map((c: Reference) => c.path);
      const recorded = record.relations.map((r: { path: string }) => r.path);
      expect(candidates, record.path).toEqual(expect.arrayContaining(recorded));
      expect(candidates.filter((c: string) => !recorded.includes(c)), record.path).toEqual(DROPPED_BY_THE_MAPPER.get(record.path) ?? []);
    }
  });

  it('lists nothing for the decoys: a skill that does not exist, an unmapped file, an example path', () => {
    const paths = findReferences(FIXTURE, 'skills/deploy/SKILL.md').map((c: Reference) => c.path);
    expect(paths).not.toContain('CHANGELOG.md');
    expect(paths.some((p: string) => p.includes('release-notes') || p.includes('main.ts'))).toBe(false);
  });
});

describe('reference resolution', () => {
  let root: string;

  const put = (rel: string, text: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const refs = (file: string) => findReferences(root, file) as Reference[];
  const targets = (file: string) => refs(file).map((r) => r.path);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-refs-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves $VAR/path in the file\'s own skill first, then the one other skill that has it', () => {
    put('a/one/SKILL.md', '---\nname: one\n---\nRun `node $S/scripts/own.mjs` and `$L/scripts/other.mjs` and `${L}/scripts/other.mjs`.\n');
    put('a/one/scripts/own.mjs', 'export const own = 1;\n');
    put('b/two/SKILL.md', '---\nname: two\n---\n');
    put('b/two/scripts/other.mjs', 'export const other = 1;\n');
    expect(refs('a/one/SKILL.md')).toEqual([
      { path: 'a/one/scripts/own.mjs', via: ['variable $S'], lines: [4] },
      { path: 'b/two/scripts/other.mjs', via: ['variable $L'], lines: [4] },
    ]);
  });

  it('resolves $VAR/path in a single-skill repository whose SKILL.md is at the root', () => {
    put('SKILL.md', '---\nname: solo\n---\nRun `node $L/scripts/run.mjs` and read references/a.md.\n');
    put('scripts/run.mjs', 'export const run = 1;\n');
    put('references/a.md', '# a\nRun `${L}/scripts/run.mjs`.\n');
    expect(targets('SKILL.md')).toEqual(['references/a.md', 'scripts/run.mjs']);
    expect(targets('references/a.md')).toEqual(['scripts/run.mjs']);
  });

  it('flags a variable path that several skills have, own skill first', () => {
    put('a/one/SKILL.md', '---\nname: one\n---\nRun `$X/scripts/lib.mjs`.\n');
    put('a/one/scripts/lib.mjs', 'export const a = 1;\n');
    put('b/two/SKILL.md', '---\nname: two\n---\n');
    put('b/two/scripts/lib.mjs', 'export const b = 1;\n');
    put('c/three/SKILL.md', '---\nname: three\n---\n');
    put('c/three/scripts/lib.mjs', 'export const c = 1;\n');
    expect(refs('a/one/SKILL.md')).toEqual([{ path: 'a/one/scripts/lib.mjs', via: ['variable $X'], lines: [4], alternatives: ['b/two/scripts/lib.mjs', 'c/three/scripts/lib.mjs'] }]);
  });

  it('resolves a skill name only with skill context, through the frontmatter name', () => {
    put('r/folder-a/SKILL.md', '---\nname: alpha\n---\n');
    put('r/folder-b/SKILL.md', '---\nname: beta\n---\n');
    put(
      'r/main/SKILL.md',
      [
        '---',
        'name: main',
        '---',
        'Load the `alpha` skill, then load `beta`.',
        'The `beta` skill again, but `folder-a` is a folder, not a skill name.',
        'Run `alpha` and `beta` in a shell.',
        'The `main` skill is this one; the `ghost` skill does not exist.',
      ].join('\n'),
    );
    expect(refs('r/main/SKILL.md')).toEqual([
      { path: 'r/folder-a/SKILL.md', via: ['skill'], lines: [4] },
      { path: 'r/folder-b/SKILL.md', via: ['skill'], lines: [4, 5] },
    ]);
  });

  it('reads a list after the skill context, and a short lead-in before it', () => {
    put('r/a/SKILL.md', '---\nname: alpha\n---\n');
    put('r/b/SKILL.md', '---\nname: beta\n---\n');
    put('r/c/SKILL.md', '---\nname: gamma\n---\n');
    put('r/d/SKILL.md', '---\nname: delta\n---\n');
    put('r/main/SKILL.md', '---\nname: main\n---\nLoad before you start: `alpha`, `ghost`, `beta` and `gamma`.\nThe skills `delta` are listed.\nThen run `alpha` in a shell.\n');
    expect(refs('r/main/SKILL.md')).toEqual([
      { path: 'r/a/SKILL.md', via: ['skill'], lines: [4] },
      { path: 'r/b/SKILL.md', via: ['skill'], lines: [4] },
      { path: 'r/c/SKILL.md', via: ['skill'], lines: [4] },
      { path: 'r/d/SKILL.md', via: ['skill'], lines: [5] },
    ]);
  });

  it('falls back to the folder name when the skill has no frontmatter name', () => {
    put('r/plain/SKILL.md', '# plain\n');
    put('r/main/SKILL.md', '---\nname: main\n---\nUse the `plain` skill.\n');
    expect(targets('r/main/SKILL.md')).toEqual(['r/plain/SKILL.md']);
  });

  it('resolves links relative to the file, drops anchors, urls and mail links', () => {
    put('s/x/SKILL.md', '---\nname: x\n---\n[a](references/a.md#top) [b](../y/SKILL.md) [site](https://example.com/a.md) [m](mailto:a@b.c) [jump](#here) [root](/s/x/references/a.md)\n');
    put('s/x/references/a.md', '# a\n');
    put('s/y/SKILL.md', '---\nname: y\n---\n');
    expect(refs('s/x/SKILL.md').map((r) => [r.path, r.via])).toEqual([
      ['s/x/references/a.md', ['link', 'path']],
      ['s/y/SKILL.md', ['link', 'path']],
    ]);
  });

  it('decodes %20 in a link and reads a link written between angle brackets', () => {
    put('s/x/SKILL.md', '---\nname: x\n---\n[one](protocol%20one.md) [two](<protocol two.md> "title") [bad](100%.md)\n');
    put('s/x/protocol one.md', '# one\n');
    put('s/x/protocol two.md', '# two\n');
    expect(targets('s/x/SKILL.md')).toEqual(['s/x/protocol one.md', 's/x/protocol two.md']);
  });

  it('resolves a path through the file folder, the skill folder, the root and a sibling skill', () => {
    put('s/x/SKILL.md', '---\nname: x\n---\n');
    put('s/x/scripts/run.mjs', 'export const run = 1;\n');
    put('s/x/references/deep/note.md', 'See `scripts/run.mjs`, `s/y/SKILL.md`, `y/references/r.md` and `x/scripts/run.mjs`.\n');
    put('s/y/SKILL.md', '---\nname: y\n---\n');
    put('s/y/references/r.md', '# r\n');
    expect(targets('s/x/references/deep/note.md')).toEqual(['s/x/scripts/run.mjs', 's/y/SKILL.md', 's/y/references/r.md']);
  });

  it('keeps a bare file name to its own skill and ignores a name that resolves nowhere', () => {
    put('s/x/SKILL.md', '---\nname: x\n---\nRead `protocol.md`, `notes.md` and `elsewhere.mjs`; skip a version like 1.2.3 and e.g. this.\n');
    put('s/x/protocol.md', '# protocol\n');
    put('s/y/SKILL.md', '---\nname: y\n---\n');
    put('s/y/scripts/elsewhere.mjs', 'export const e = 1;\n');
    expect(targets('s/x/SKILL.md')).toEqual(['s/x/protocol.md']);
  });

  it('does not take a bare CLAUDE.md or README.md in a skill for the one at the project root', () => {
    put('CLAUDE.md', '# project rules\n');
    put('README.md', '# readme\n');
    put('s/x/SKILL.md', '---\nname: x\n---\nIf the project routes you through CLAUDE.md, follow it. See README.md.\n');
    expect(targets('s/x/SKILL.md')).toEqual([]);
    put('s/x/SKILL.md', '---\nname: x\n---\nIf the project routes you through [its rules](/CLAUDE.md), follow them.\n');
    expect(targets('s/x/SKILL.md')).toEqual(['CLAUDE.md']);
    put('CLAUDE.md', '# project rules\nRead s/x/SKILL.md and README.md.\n');
    expect(targets('CLAUDE.md')).toEqual(['s/x/SKILL.md']);
  });

  it('never lists the file itself and never leaves the repository', () => {
    put('s/x/SKILL.md', '---\nname: x\n---\nThis SKILL.md, `../../../outside.md` and `../../s/x/SKILL.md`.\n');
    expect(refs('s/x/SKILL.md')).toEqual([]);
  });

  it('only points at files the map would contain', () => {
    put('s/x/SKILL.md', '---\nname: x\n---\nRead CHANGELOG.md, `docs/guide.md` and `node_modules/pkg/README.md`.\n');
    put('s/x/CHANGELOG.md', '');
    put('docs/guide.md', '# guide\n');
    put('node_modules/pkg/README.md', '# pkg\n');
    expect(refs('s/x/SKILL.md')).toEqual([]);
  });

  it('prints candidates as text and as json, and refuses a file outside the set', () => {
    put('s/x/SKILL.md', '---\nname: x\n---\nRead `protocol.md`.\n');
    put('s/x/protocol.md', '# protocol\n');
    const text = run(REFS, root, 's/x/SKILL.md', 's/x/protocol.md');
    expect(text.status).toBe(0);
    expect(text.stdout).toBe('s/x/SKILL.md\n  s/x/protocol.md  path  line 4\ns/x/protocol.md\n  (no candidates)\n');
    const json = JSON.parse(run(REFS, root, 's/x/SKILL.md', '--json').stdout);
    expect(json).toEqual([{ file: 's/x/SKILL.md', references: [{ path: 's/x/protocol.md', via: ['path'], lines: [4] }] }]);
    const missing = run(REFS, root, 'README.md');
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/README\.md is not in the enumerated set/);
    expect(run(REFS, root).status).toBe(2);
  });
});
