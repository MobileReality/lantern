import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts', 'lint-skill-reads.mjs');
const LINKER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-reads-linker-'));
fs.mkdirSync(path.join(LINKER_DIR, 'core'));
const makeLinker = (name: string) => {
  const file = path.join(LINKER_DIR, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
};
const LINKER = makeLinker('my-linker');

const bash = (command: string) => ({ type: 'tool_use', name: 'Bash', input: { command } });
const read = (file_path: string) => ({ type: 'tool_use', name: 'Read', input: { file_path } });
const skillFile = (name: string) => `/wt/.claude/skills/${name}/SKILL.md`;

function run(calls: object[], extra: string[] = [], linker: string = LINKER) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-reads-'));
  const file = path.join(dir, 'agent-a1.jsonl');
  fs.writeFileSync(file, calls.map((c) => JSON.stringify({ message: { content: [c] } })).join('\n') + '\n');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-reads-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, SKILL_LINKER: linker };
  const res = spawnSync('node', [SCRIPT, ...extra, '--agent-id', 'a1', dir], { encoding: 'utf8', env });
  return { status: res.status, out: res.stdout };
}

describe('lint-skill-reads', () => {
  it('passes when a link is followed by a Read of its SKILL.md', () => {
    const r = run([bash(`${LINKER} . --skill typescript`), read(skillFile('typescript'))]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('0 linked skill(s) never read out of 1');
  });

  it('accepts a Bash cat of the SKILL.md', () => {
    const r = run([bash(`${LINKER} . --skill biome`), bash('cat .claude/skills/biome/SKILL.md')]);
    expect(r.status).toBe(0);
  });

  it('fails a link with no later read', () => {
    const r = run([bash(`${LINKER} . --skill typescript`), bash('ls')]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/agent-a1\.jsonl:1 skill-not-read typescript/);
  });

  it('fails when the read came only before the link', () => {
    const r = run([read(skillFile('typescript')), bash(`${LINKER} . --skill typescript`)]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('skill-not-read typescript');
  });

  it('needs one read per skill when a command links two', () => {
    const calls = [bash(`${LINKER} . --skill biome --skill zod-schemas`), read(skillFile('biome'))];
    const r = run(calls);
    expect(r.status).toBe(1);
    expect(r.out).toContain('skill-not-read zod-schemas');
    expect(r.out).not.toContain('skill-not-read biome');
    expect(run([...calls, read(skillFile('zod-schemas'))]).status).toBe(0);
  });

  it('does not count a read of a different skill', () => {
    const r = run([bash(`${LINKER} . --skill typescript`), read(skillFile('biome'))]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('skill-not-read typescript');
  });

  describe('compound commands', () => {
    const lk = (n: string) => bash(`${LINKER} . --skill ${n} 2>&1 | tail -3`);

    it('counts cat piped to head, then a chain with ;', () => {
      const r = run([
        bash('/Users/x/GIT/skills/my-linker . --skill team-conventions 2>&1 | tail -3'),
        bash('cat .claude/skills/team-conventions/SKILL.md | head -80; git log -1 --format=%B | cat -A | tail -3'),
      ]);
      expect(r.status).toBe(0);
      expect(r.out).toContain('0 linked skill(s) never read out of 1');
    });

    it('finds links in a chain and several files in one cat, still reporting the unread one', () => {
      const r = run([
        bash(`${LINKER} . --skill typescript 2>&1 | tail -3; ls; git log --format='%s%n%b' origin/main`),
        bash(`${LINKER} . --skill team-conventions`),
        bash(`${LINKER} . --skill lantern-commit`),
        bash("cat .claude/skills/team-conventions/SKILL.md .claude/skills/lantern-commit/SKILL.md; git log --format='%s%n%b' origin/main..HEAD;"),
      ]);
      expect(r.status).toBe(1);
      expect(r.out).toContain('skill-not-read typescript');
      expect(r.out).not.toContain('skill-not-read team-conventions');
      expect(r.out).not.toContain('skill-not-read lantern-commit');
      expect(r.out).toContain('1 linked skill(s) never read out of 3');
    });

    it('accepts head -n 50 with options before the path', () => {
      expect(run([lk('x'), bash('head -n 50 /abs/wt/.claude/skills/x/SKILL.md')]).status).toBe(0);
    });

    it('accepts a read later in the same command as the link', () => {
      expect(run([bash(`${LINKER} . --skill x; cat .claude/skills/x/SKILL.md`)]).status).toBe(0);
    });

    it('does not count a read earlier in the same command', () => {
      expect(run([bash(`cat .claude/skills/x/SKILL.md; ${LINKER} . --skill x`)]).status).toBe(1);
    });

    it('does not count another skill, a read before the link, or a redirection', () => {
      expect(run([lk('x'), bash('cat .claude/skills/y/SKILL.md | head')]).status).toBe(1);
      expect(run([bash('cat .claude/skills/x/SKILL.md | head'), lk('x')]).status).toBe(1);
      expect(run([lk('x'), bash('ls 2>&1 > .claude/skills/x/SKILL.md')]).status).toBe(1);
    });

    it('does not split on a quoted ;', () => {
      expect(run([lk('x'), bash("echo 'a; cat .claude/skills/x/SKILL.md'")]).status).toBe(1);
    });

    it('accepts a Read through a symlink-resolved skills path', () => {
      expect(run([lk('x'), read('/Users/x/GIT/lantern/.claude/skills/x/SKILL.md')]).status).toBe(0);
      expect(run([lk('x'), read('/Users/x/GIT/skills/x/SKILL.md')]).status).toBe(0);
    });

    it('lets one later read cover a link that was retried before it', () => {
      expect(run([lk('x'), lk('x'), bash('cat .claude/skills/x/SKILL.md')]).status).toBe(0);
    });

    it('still reports a plain unread link', () => {
      expect(run([lk('x'), bash('ls | head')]).status).toBe(1);
    });
  });

  describe('for-loops over a literal list', () => {
    const names = ['typescript', 'biome', 'zod-schemas', 'package-manager'];
    const linkAll = names.map((n) => bash(`${LINKER} . --skill ${n}`));
    const loop = (list: string, body: string) => bash(`for s in ${list}; do ${body}; done`);

    it('counts the pyutil loop for every skill in the list', () => {
      const r = run([
        ...linkAll,
        bash('for s in typescript biome zod-schemas package-manager; do echo "=== $s"; head -c 2500 .claude/skills/$s/SKILL.md; echo; done'),
      ]);
      expect(r.status).toBe(0);
      expect(r.out).toContain('0 linked skill(s) never read out of 4');
    });

    it('expands ${s}, quoted items and a multi-line loop', () => {
      expect(run([...linkAll, loop(`typescript 'biome' "zod-schemas" package-manager`, 'cat .claude/skills/${s}/SKILL.md')]).status).toBe(0);
      const multi = 'for s in typescript biome zod-schemas package-manager\ndo\n  cat .claude/skills/$s/SKILL.md\ndone';
      expect(run([...linkAll, bash(multi)]).status).toBe(0);
    });

    it('does not resolve a list built by $(ls), a variable or a glob', () => {
      for (const list of ['$(ls)', '$NAMES', '*']) {
        const r = run([...linkAll, loop(list, 'cat .claude/skills/$s/SKILL.md')]);
        expect(r.status).toBe(1);
        expect(r.out).toContain('4 linked skill(s) never read out of 4');
      }
    });

    it('does not count a loop whose body does not read the file', () => {
      const r = run([...linkAll, loop('typescript biome zod-schemas package-manager', 'echo $s')]);
      expect(r.status).toBe(1);
      expect(r.out).toContain('4 linked skill(s) never read out of 4');
    });

    it('does not count a skill that is not in the list', () => {
      const r = run([...linkAll, loop('typescript biome', 'cat .claude/skills/$s/SKILL.md')]);
      expect(r.status).toBe(1);
      expect(r.out).toContain('skill-not-read zod-schemas');
      expect(r.out).toContain('skill-not-read package-manager');
      expect(r.out).not.toContain('skill-not-read typescript');
      expect(r.out).not.toContain('skill-not-read biome');
    });
  });

  describe('how a link is recognised', () => {
    const linked = (command: string) => run([bash(command)]).out;

    it('sees bash, sh and node launchers, assignments and any path to the skill linker', () => {
      expect(linked('bash /p/my-linker . --skill x')).toContain('1 linked skill(s) never read out of 1');
      expect(linked('sh /p/my-linker . --skill x')).toContain('out of 1');
      expect(linked('node my-linker . --skill x')).toContain('out of 1');
      expect(linked('VAR=1 my-linker . --skill x')).toContain('out of 1');
      expect(linked('VAR=1 OTHER=2 bash /a/b/my-linker . --skill=x')).toContain('out of 1');
      expect(linked('/p/other-my-linker . --skill x')).toContain('out of 0');
    });

    it('assumes no name: only the configured skill linker is a link, whatever it is called', () => {
      const runWith = (name: string | null, command: string) => run([bash(command)], [], name ? makeLinker(name) : '').out;
      expect(runWith(null, '/p/my-linker . --skill x')).toContain('out of 0');
      expect(runWith(null, '/p/other-tool . --skill x')).toContain('out of 0');
      expect(runWith('skill-linker', '/p/my-linker . --skill x')).toContain('out of 0');
      expect(runWith('skill-linker', '/p/skill-linker . --skill x')).toContain('out of 1');
      expect(runWith('skill-linker', '/p/other-tool . --skill x')).toContain('out of 0');
    });

    it('treats a quoted > as a word and < file as a read', () => {
      const lk = bash(`${LINKER} . --skill x`);
      expect(run([lk, bash('grep ">" .claude/skills/x/SKILL.md')]).status).toBe(0);
      expect(run([lk, bash('cat < .claude/skills/x/SKILL.md')]).status).toBe(0);
      expect(run([lk, bash('echo > .claude/skills/x/SKILL.md')]).status).toBe(1);
    });
  });

  it('prints JSON with --json', () => {
    const r = run([bash(`${LINKER} . --skill typescript`)], ['--json']);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.out).violations[0]).toMatchObject({ rule: 'skill-not-read', skill: 'typescript', line: 1 });
  });
});
