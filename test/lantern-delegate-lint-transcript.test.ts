import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const LINT = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts', 'lint-transcript.mjs');

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-transcript-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function transcript(commands: string[]): string {
  return `${commands
    .map((command, i) =>
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command } }] },
      }),
    )
    .join('\n')}\n`;
}

function makeLinker(name: string): string {
  const dir = path.join(tmp, 'linker');
  fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
}

function lint(commands: string[], extra: string[] = [], linkerName?: string) {
  const dir = path.join(tmp, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent-1.jsonl'), transcript(commands));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, SKILL_LINKER: linkerName ? makeLinker(linkerName) : '' };
  const res = spawnSync('node', [LINT, ...extra, dir], { encoding: 'utf8', env });
  return { status: res.status, out: res.stdout, err: res.stderr };
}

describe('lantern-code-reviewer reads what it uses', () => {
  const dir = path.join(__dirname, '..', 'skills', 'lantern-code-reviewer');
  for (const name of ['SKILL.md', 'README.md']) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    it(`${name} states the read-from-disk rule`, () => {
      const flat = text.replace(/\s+/g, ' ');
      expect(flat).toMatch(/(from|on) disk/);
      expect(flat).toContain('.claude/skills/<name>/SKILL.md');
    });
  }
});

describe('lint-transcript', () => {
  it('passes a clean run, including ; and && inside quotes', () => {
    const res = lint([
      'git add a.txt b.txt',
      'git commit -m "fix: handle a; b && c in the parser"',
      "git commit -m 'feat: x || y | z'",
      'git log --format=%h',
      'node /abs/path/script.mjs --flag "a;b"',
    ]);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain('0 command(s) with violations out of 5');
  });

  it('fails git add && git commit, passes the same pair as two calls', () => {
    const chained = lint(['git add a && git commit -m x']);
    expect(chained.status).toBe(1);
    expect(chained.out).toContain('and-chain');
    const split = lint(['git add a', 'git commit -m x']);
    expect(split.status, split.out).toBe(0);
  });

  const cases: Array<[string, string]> = [
    ['and-chain', 'git add a && git commit -m x'],
    ['or-chain', 'test -f a || echo no'],
    ['semicolon', 'ls; pwd'],
    ['pipe', 'git log | head'],
    ['heredoc', 'cat <<EOF\nhi\nEOF'],
    ['substitution', 'ls $HOME'],
    ['substitution', 'ls ${HOME}/x'],
    ['substitution', 'echo $(date)'],
    ['substitution', 'echo `date`'],
    ['substitution', 'echo "$(date)"'],
    ['line-continuation', 'git commit \\\n-m x'],
    ['escaped-space', 'git log --format=%h\\ %s'],
    ['git-dash-c', 'git -C /tmp status'],
    ['cd-chain', 'cd src && ls'],
    ['substitution', 'echo $1'],
    ['substitution', 'echo $@ $?'],
    ['substitution', 'diff <(ls a) <(ls b)'],
    ['background', 'sleep 10 &'],
    ['newline', 'git add a\ngit commit -m x'],
    ['git-dash-c', 'git --no-pager -C /tmp log'],
  ];
  for (const [rule, command] of cases) {
    it(`flags ${rule}: ${JSON.stringify(command)}`, () => {
      const res = lint([command]);
      expect(res.status).toBe(1);
      expect(res.out).toContain(` ${rule} `);
    });
  }

  describe.each(['my-linker', 'skill-linker'])('with the configured skill linker named %s', (name) => {
    it('flags it without --skill as skill-linker-baseline, by bare name or by path', () => {
      for (const command of [`${name} .`, `/Users/x/GIT/skills/${name} .`, `/Users/x/GIT/skills/${name} . nextjs`]) {
        const res = lint([command], [], name);
        expect(res.status, command).toBe(1);
        expect(res.out).toContain(' skill-linker-baseline ');
      }
    });

    it('passes it with --skill, --linked, --list, --help and --unlink --skill', () => {
      const res = lint(
        [
          `/Users/x/GIT/skills/${name} . --skill team-conventions`,
          `/Users/x/GIT/skills/${name} --linked .`,
          `${name} --list`,
          `${name} --help`,
          `${name} --unlink . --skill typescript`,
          `git commit -m "docs: run ${name} . for a person"`,
        ],
        [],
        name,
      );
      expect(res.status, res.out).toBe(0);
    });
  });

  it('assumes no name for the skill linker: a different configured one, or none, leaves a bare run alone', () => {
    expect(lint(['skill-linker .', '/x/my-linker .'], [], 'other-linker').status).toBe(0);
    expect(lint(['skill-linker .', '/x/my-linker .']).status).toBe(0);
  });

  it('does not flag a $ in single quotes, a trailing newline, a comment, a redirect or git -c', () => {
    const res = lint(["echo '$HOME `x`'", 'git status\n', 'ls # a; b && c', 'node a.mjs 2>&1', 'node a.mjs &>/dev/null', 'git -c user.name=x commit -m y']);
    expect(res.status, res.out).toBe(0);
  });

  it('counts distinct offending commands, not rules', () => {
    const res = lint(['cd x && ls | head; echo $HOME', 'git status'], ['--json']);
    const parsed = JSON.parse(res.out);
    expect(parsed.violatingCommands).toBe(1);
    expect(parsed.violations.length).toBeGreaterThan(1);
  });

  it('with --agent-id counts only that agent in a shared folder', () => {
    const dir = path.join(tmp, 'shared');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'agent-aaa.jsonl'), transcript(['git add a && git commit -m x', 'ls; pwd']));
    fs.writeFileSync(path.join(dir, 'agent-bbb.jsonl'), transcript(['git status']));
    const a = spawnSync('node', [LINT, '--json', '--agent-id', 'aaa', dir], { encoding: 'utf8' });
    expect(a.status).toBe(1);
    expect(JSON.parse(a.stdout)).toMatchObject({ commands: 2, violatingCommands: 2 });
    const b = spawnSync('node', [LINT, '--json', '--agent-id', 'bbb', dir], { encoding: 'utf8' });
    expect(b.status).toBe(0);
    expect(JSON.parse(b.stdout)).toMatchObject({ commands: 1, violatingCommands: 0 });
  });

  it('prints all of a large output through a pipe, valid JSON and the summary line', () => {
    const dir = path.join(tmp, 'big');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'agent-1.jsonl'), transcript(Array.from({ length: 800 }, (_, i) => `ls a${i}; pwd | head`)));
    const json = spawnSync('sh', ['-c', `node ${LINT} --json ${dir} | cat`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(json.stdout.length).toBeGreaterThan(70000);
    expect(JSON.parse(json.stdout).violatingCommands).toBe(800);
    const text = spawnSync('sh', ['-c', `node ${LINT} ${dir} | cat`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(text.stdout.trimEnd().split('\n').pop()).toBe('800 command(s) with violations out of 800');
  });

  it('reports file, line and the command, and supports --json', () => {
    const res = lint(['git status', 'ls; pwd'], ['--json']);
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.out);
    expect(parsed.commands).toBe(2);
    expect(parsed.violations).toHaveLength(1);
    expect(parsed.violations[0]).toMatchObject({ line: 2, rule: 'semicolon', command: 'ls; pwd' });
    expect(parsed.violations[0].file).toMatch(/agent-1\.jsonl$/);
  });

  it('ignores non-Bash tools and lines that are not JSON', () => {
    const file = path.join(tmp, 't.jsonl');
    const other = JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'Edit', input: { command: 'a && b' } }] } });
    fs.writeFileSync(file, `not json "Bash"\n${other}\n`);
    const res = spawnSync('node', [LINT, file], { encoding: 'utf8' });
    expect(res.status).toBe(0);
  });
});
