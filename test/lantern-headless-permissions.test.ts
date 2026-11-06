import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANTERN_MODEL, allowedToolsFor, buildArgs, buildPrompt } from '../src/main/agent';

const ROOT = path.join(__dirname, '..');
const SETUP = path.join(ROOT, 'skills', 'lantern-setup');
const SKILL_FILE = path.join(SETUP, 'SKILL.md');
const MAPPER_FILE = path.join(SETUP, 'agents', 'lantern-mapper.md');
const COMMANDS_SECTION = 'Commands in an unattended run';
const PROJECT = '/work/shop';

const PROGRAMS = new Set(['node', 'du', 'cat', 'ls', 'grep', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'find', 'sed', 'awk', 'python', 'python3', 'mkdir', 'cp', 'mv', 'rm', 'cd', 'git', 'xargs', 'npx', 'npm', 'pnpm', 'claude', 'echo']);

const NAMED_TO_FORBID = ['sed', 'find', 'python', 'python3', 'cd', 'git'];
const EXEMPT: Array<{ match: RegExp; why: string }> = [
  { match: /^claude -p/, why: 'spawned by `areas.mjs lookup run` itself with CLAUDE_BIN from the app; the model never types it' },
  { match: /^mkdir -p ~\/\.claude\/agents/, why: 'a human setup line; the app installs the agent before the run (ensureMapperAgent)' },
];

const skillText = fs.readFileSync(SKILL_FILE, 'utf8');
const mapperText = fs.readFileSync(MAPPER_FILE, 'utf8');
const promptText = (['lantern', 'lantern-refresh'] as const).map((kind) => buildPrompt(kind, 'English', undefined, 'claude', PROJECT)).join('\n');

function withoutCommandsSection(text: string) {
  return text.split(/^## /m).filter((part) => !part.startsWith(COMMANDS_SECTION)).join('\n## ');
}

function spans(text: string) {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => ({ span: m[1].trim(), line: text.slice(text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index)) }));
}

function commandsIn(text: string) {
  return spans(text).filter(({ span }) => PROGRAMS.has(span.split(/\s+/)[0]));
}

const programOf = (span: string) => span.split(/\s+/)[0];
const ruleCovers = (allowed: string[], program: string) => allowed.some((rule) => rule === `Bash(${program}:*)`);

describe('the commands the skill and the mapper agent prescribe are all allowed in a headless run', () => {
  const allowed = allowedToolsFor('lantern');
  const sources = [
    { name: 'lantern-setup/SKILL.md', text: withoutCommandsSection(skillText) },
    { name: 'agents/lantern-mapper.md', text: mapperText },
  ];

  it('finds the commands it is meant to check', () => {
    const nodes = sources.flatMap((s) => commandsIn(s.text)).filter(({ span }) => programOf(span) === 'node');
    expect(nodes.length).toBeGreaterThan(20);
    expect(nodes.some(({ span }) => span.includes('areas.mjs . lookup run'))).toBe(false);
    expect(commandsIn(skillText).some(({ span }) => span.startsWith('du -sk .lantern'))).toBe(true);
  });

  it('allows every program a prescribed command starts with, or names it only to forbid it', () => {
    const uncovered: string[] = [];
    for (const { name, text } of sources) {
      for (const { span, line } of commandsIn(text)) {
        const program = programOf(span);
        if (ruleCovers(allowed, program)) continue;
        if (EXEMPT.some(({ match }) => match.test(span))) continue;
        if (NAMED_TO_FORBID.includes(program) && /\b(never|no|not|refused|refuse)\b/i.test(line)) continue;
        uncovered.push(`${name}: \`${span}\` (program ${program} is in none of --allowedTools)`);
      }
    }
    expect(uncovered, 'allow the program in allowedToolsFor (lantern kinds), or change the prose').toEqual([]);
  });

  it('prescribes node commands in one plain shape: no chain, pipe, redirect, substitution or heredoc', () => {
    const odd: string[] = [];
    for (const { name, text } of sources) {
      for (const { span } of commandsIn(text).filter(({ span }) => programOf(span) === 'node')) {
        const bare = span.replace(/<[^>]*>/g, 'x').replace(/\|\s*(?!(?:head|tail|grep|wc|sort|uniq|cut|cat|xargs|tee|sed|awk)\b)/g, 'or ');
        if (/[;&|><`]|\$\(/.test(bare)) odd.push(`${name}: \`${span}\``);
      }
    }
    expect(odd).toEqual([]);
  });

  it('keeps a shell variable out of the agent and the app prompts: only the skill uses $L, as notation', () => {
    expect(commandsIn(mapperText).filter(({ span }) => span.includes('$L'))).toEqual([]);
    expect(promptText).not.toMatch(/node \$L/);
    expect(skillText).toContain(`## ${COMMANDS_SECTION}`);
    const section = skillText.split(/^## /m).find((part) => part.startsWith(COMMANDS_SECTION)) ?? '';
    for (const refused of ['`cd`', 'shell variable', 'heredoc', 'redirect', '`find -exec`', '`xargs`', '`python`']) expect(section, refused).toContain(refused);
    expect(section).toContain('`$L` in this\nfile is notation');
  });

  it('allows the one exception the last step makes: the size of .lantern/, without find -exec', () => {
    expect(ruleCovers(allowed, 'du')).toBe(true);
    expect(skillText).not.toMatch(/find \.lantern[^\n]*-exec/);
  });
});

describe('what the run is given', () => {
  const args = buildArgs('lantern', 'p');

  it('runs in acceptEdits, pinned to the mapping model, with node, Read and Agent allowed', () => {
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    expect(args[args.indexOf('--model') + 1]).toBe(LANTERN_MODEL);
    const tools = args.slice(args.indexOf('--allowedTools') + 1);
    expect(tools).toEqual(expect.arrayContaining(['Bash(node:*)', 'Read', 'Agent']));
    expect(buildArgs('lantern-refresh', 'p')).toEqual(args);
  });

  it('gives the mapper worker the tools the skill has it use, and the same model', () => {
    const front = mapperText.split('---')[1];
    const field = (name: string) => front.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1].trim() ?? '';
    const tools = field('tools').split(',').map((t) => t.trim());
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash']));
    expect(field('model')).toBe(LANTERN_MODEL);
    expect(field('name')).toBe('lantern-mapper');
    expect(skillText).toContain('subagent_type: "lantern-mapper"');
  });

  it('writes only under the project: every .lantern path the prose names is relative and outside the protected .claude folder', () => {
    const named = new Set<string>();
    for (const text of [skillText, mapperText, promptText]) for (const m of text.matchAll(/\.lantern\/[A-Za-z0-9_<>*%./{}-]*/g)) named.add(m[0]);
    for (const required of ['.lantern/map', '.lantern/areas', '.lantern/features', '.lantern/platforms', '.lantern/.project/areas']) {
      expect([...named].some((p) => p.startsWith(required)), `the scan must find ${required}`).toBe(true);
    }
    const protectedFolder = [...named].filter((p) => /(^|\/)\.claude(\/|$)/.test(p));
    expect(protectedFolder, 'a Write or Edit under .claude is refused; spell it %2Eclaude and run fold.mjs').toEqual([]);
    expect(mapperText).toContain('%2Eclaude');
    expect(mapperText).toContain('fold.mjs');
  });

  it('puts the blind lookup scratch folder inside .lantern/, where the app keeps an ignore file', () => {
    expect(promptText).toContain('--out .lantern/.project/areas');
  });
});

describe('the prompt names the step a model skipped and the commands it may type', () => {
  const prompt = buildPrompt('lantern-refresh', 'English', undefined, 'claude', PROJECT);

  it('names areas as step 4a, the finish command with --require-areas, and who runs the loop', () => {
    expect(prompt).toContain('areas (step 4a)');
    expect(prompt).toContain('Finish with validate.mjs . --settled --require-areas passing');
    expect(prompt).toContain('never in a worker');
    expect(prompt).toContain('A run that has not done step 4a is reported as failed');
  });

  it('types the skill and project paths out, so a worker can copy them into every command', () => {
    expect(prompt).toContain(`Project root: ${PROJECT}. Skill folder: ${PROJECT}/.claude/skills/lantern-setup.`);
    expect(prompt).toContain(`node ${PROJECT}/.claude/skills/lantern-setup/scripts/plan.mjs ${PROJECT} status`);
    expect(prompt).toMatch(/refuses cd, shell variables/);
    expect(prompt).toContain('Put the same rule and the literal paths in the brief of every lantern-mapper worker');
  });

  it('is the same for Set up and Refresh, and for Codex with its own skills folder', () => {
    const setup = buildPrompt('lantern', 'English', undefined, 'claude', PROJECT);
    for (const text of [setup, prompt]) for (const piece of ['step 4a', '--require-areas', 'Skill folder:', '--out .lantern/.project/areas']) expect(text).toContain(piece);
    expect(buildPrompt('lantern', 'English', undefined, 'codex', PROJECT)).toContain(`Skill folder: ${PROJECT}/.agents/skills/lantern-setup.`);
  });

  it('says step 5 and the retag finish need the tree too, in the skill', () => {
    expect(skillText).toMatch(/5\. \*\*Finish\.\*\* `validate\.mjs \. --settled --require-areas` exits 0/);
    expect(skillText).toContain('`validate.mjs . --settled --strict --require-areas`');
    expect(skillText).toMatch(/Skipping this step is not possible: step 5\s+stays red/);
  });
});
