import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SKILLS_ROOT } from './helpers/skill-runner';

const run = promisify(execFile);

interface Case {
  skill: string;
  script: string;
  kind: string;
  repoTemplate: string;
  credentials: Record<string, string>;
}

const CASES: Case[] = [
  { skill: 'lantern-jira', script: 'jira.mjs', kind: 'ticket', repoTemplate: '.github/ISSUE_TEMPLATE.md', credentials: { ATLASSIAN_EMAIL: 'dev@example.com', GLOBAL_ATLASSIAN_TOKEN: 'ATATT-conv-1a2b3c', ATLASSIAN_BASE_URL: 'https://example.atlassian.net' } },
  { skill: 'lantern-bitbucket', script: 'bitbucket.mjs', kind: 'pr', repoTemplate: 'pull_request_template.md', credentials: { BITBUCKET_EMAIL: 'dev@example.com', BITBUCKET_API_TOKEN: 'ATATT-conv-4d5e6f' } },
  { skill: 'lantern-github', script: 'github.mjs', kind: 'pr', repoTemplate: '.github/pull_request_template.md', credentials: { GITHUB_TOKEN: 'github_pat_conv_7g8h9i' } },
];

const BODY_MARKER = 'BODY-LINE-THAT-MUST-STAY-PRIVATE';
const PROMPT_SKILL = { name: 'team-pr', description: 'Open a pull request the way our team writes them' };
const HOME_SKILL = { name: 'team-tickets', description: 'Write Jira tickets with our labels' };

let tmp: string;
let project: string;
let home: string;

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function skillFile(root: string, skill: { name: string; description: string }, folder = skill.name) {
  write(path.join(root, folder, 'SKILL.md'), `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n\n${BODY_MARKER}\n`);
}

async function script(entry: Case, argv: string[], extraEnv: Record<string, string> = {}) {
  const file = path.join(SKILLS_ROOT, entry.skill, 'scripts', entry.script);
  try {
    const { stdout, stderr } = await run(process.execPath, [file, ...argv], { cwd: project, env: { PATH: process.env.PATH ?? '', HOME: home, ...extraEnv } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-conventions-'));
  project = path.join(tmp, 'project');
  home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(home);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe.each(CASES)('$skill conventions', (entry) => {
  const savedName = `${entry.skill.replace('lantern-', '')}-${entry.kind}.md`;

  it('finds a repository template, a user skill and a saved template together', async () => {
    write(path.join(project, entry.repoTemplate), `# Template\n\n${BODY_MARKER}\n`);
    skillFile(path.join(project, '.claude', 'skills'), PROMPT_SKILL);
    write(path.join(tmp, 'approved.md'), `## Summary\n\n${BODY_MARKER}\n`);
    const saved = await script(entry, ['template', 'save', entry.kind, '--file', path.join(tmp, 'approved.md')]);
    expect(saved).toMatchObject({ code: 0 });

    const listed = await script(entry, ['conventions', '--json']);
    expect(listed.code).toBe(0);
    const found = JSON.parse(listed.stdout) as { source: string; name: string; path: string; description: string }[];
    expect(found.map((one) => [one.source, one.path])).toEqual([
      ['repository', entry.repoTemplate],
      ['skill', path.join('.claude', 'skills', 'team-pr', 'SKILL.md')],
      ['saved', path.join('.claude', 'lantern-templates', savedName)],
    ]);
    expect(found[1]).toMatchObject({ name: 'team-pr', description: PROMPT_SKILL.description });

    const text = await script(entry, ['conventions']);
    expect(text.stdout.trim().split('\n')).toHaveLength(3);
    for (const one of found) expect(text.stdout).toContain(one.path);
  });

  it('reads user skills of the home folder as well', async () => {
    skillFile(path.join(home, '.agents', 'skills'), HOME_SKILL);
    const listed = JSON.parse((await script(entry, ['conventions', '--json'])).stdout) as { path: string }[];
    expect(listed.map((one) => one.path)).toEqual([path.join('~', '.agents', 'skills', 'team-tickets', 'SKILL.md')]);
  });

  it('ignores its own folder, other bundle skills and skills about other things', async () => {
    const skills = path.join(project, '.claude', 'skills');
    skillFile(skills, { name: entry.skill, description: 'Jira, Bitbucket and GitHub pull requests' });
    skillFile(skills, { name: 'lantern-sync', description: 'Record the pull request in the map' });
    skillFile(skills, { name: 'lantern-delegate', description: 'Open a pull request in the background' });
    skillFile(skills, { name: 'date-format', description: 'Format dates for display' });
    const result = await script(entry, ['conventions']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(`Nothing found: no ${entry.kind === 'pr' ? 'pull request' : 'ticket'} template in the repository, no skill about it and no saved template.`);
  });

  it('never prints the contents of what it finds nor a credential', async () => {
    write(path.join(project, entry.repoTemplate), `${BODY_MARKER}\n`);
    skillFile(path.join(project, '.claude', 'skills'), PROMPT_SKILL);
    const result = await script(entry, ['conventions'], entry.credentials);
    const json = await script(entry, ['conventions', '--json'], entry.credentials);
    for (const output of [result, json]) {
      expect(output.code).toBe(0);
      expect(output.stdout + output.stderr).not.toContain(BODY_MARKER);
      for (const value of Object.values(entry.credentials)) expect(output.stdout + output.stderr).not.toContain(value);
    }
  });

  it('saves a template, shows it back and refuses to replace it without --force', async () => {
    write(path.join(tmp, 'first.md'), 'first draft\n');
    write(path.join(tmp, 'second.md'), 'second draft\n');
    const first = await script(entry, ['template', 'save', entry.kind, '--file', path.join(tmp, 'first.md')]);
    expect(first.code).toBe(0);
    expect(fs.readFileSync(path.join(project, '.claude', 'lantern-templates', savedName), 'utf8')).toBe('first draft\n');
    expect((await script(entry, ['template', 'show', entry.kind])).stdout).toBe('first draft\n');

    const again = await script(entry, ['template', 'save', entry.kind, '--file', path.join(tmp, 'second.md')]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('--force');
    expect((await script(entry, ['template', 'show', entry.kind])).stdout).toBe('first draft\n');

    const forced = await script(entry, ['template', 'save', entry.kind, '--file', path.join(tmp, 'second.md'), '--force']);
    expect(forced.code).toBe(0);
    expect((await script(entry, ['template', 'show', entry.kind])).stdout).toBe('second draft\n');
  });

  it('refuses a kind it does not serve, a missing file and a template that was never saved', async () => {
    write(path.join(tmp, 'empty.md'), '  \n');
    expect((await script(entry, ['template', 'save', 'other', '--file', path.join(tmp, 'empty.md')])).code).toBe(1);
    expect((await script(entry, ['template', 'save', entry.kind])).code).toBe(1);
    expect((await script(entry, ['template', 'save', entry.kind, '--file', path.join(tmp, 'empty.md')])).code).toBe(1);
    expect((await script(entry, ['template', 'save', entry.kind, '--file', path.join(tmp, 'missing.md')])).code).toBe(1);
    expect((await script(entry, ['template', 'show', entry.kind])).code).toBe(1);
    expect(fs.existsSync(path.join(project, '.claude', 'lantern-templates'))).toBe(false);
  });
});

describe('every skill tells the agent that conventions are the user\'s', () => {
  it.each(CASES)('$skill SKILL.md carries the section and both commands', ({ skill, script: file, kind }) => {
    const text = fs.readFileSync(path.join(SKILLS_ROOT, skill, 'SKILL.md'), 'utf8');
    expect(text).toContain("## Conventions are the user's");
    expect(text).toContain(`scripts/${file} conventions`);
    expect(text).toContain(`template save ${kind} --file <path>`);
    expect(text).toContain('"I found X; use it?"');
  });
});
