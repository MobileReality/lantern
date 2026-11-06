import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installBundle } from '../scripts/lantern-bundle.mjs';
import { buildArgs, buildPrompt, ensureLanternSkills, ensureMapperAgent, exitEvent, handleLine, preflight, languageCode, LANTERN_MODEL, LANTERN_SKILLS, skillLinked, start, toolDetail } from '../src/main/agent';
import { isSessionId } from '../src/main/provider';

const UNKNOWN_KIND = 'dataflow';

describe('agent kinds', () => {
  it.each(['claude', 'codex'] as const)('rejects an unknown kind on %s before spawning anything', (provider) => {
    const res = start({ project: os.tmpdir(), kind: UNKNOWN_KIND as never, provider, onEvent: () => {} });
    expect(res).toEqual({ ok: false, error: `Unknown agent kind: ${UNKNOWN_KIND}` });
  });
});

describe('skillLinked', () => {
  let project: string;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-agent-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('is false when the skill directory is absent', () => {
    expect(skillLinked(project, 'lantern-plan')).toBe(false);
  });

  it('is true once the skill is present under .claude/skills', () => {
    fs.mkdirSync(path.join(project, '.claude', 'skills', 'lantern-plan'), { recursive: true });
    expect(skillLinked(project, 'lantern-plan')).toBe(true);
  });

  it('detects a symlinked skill, not just a real directory', () => {
    const realSkill = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skill-'));
    const dest = path.join(project, '.claude', 'skills');
    fs.mkdirSync(dest, { recursive: true });
    fs.symlinkSync(realSkill, path.join(dest, 'lantern-plan'));
    expect(skillLinked(project, 'lantern-plan')).toBe(true);
    fs.rmSync(realSkill, { recursive: true, force: true });
  });

  it('uses the native Codex skill directory when selected', () => {
    fs.mkdirSync(path.join(project, '.agents', 'skills', 'lantern-plan'), { recursive: true });
    expect(skillLinked(project, 'lantern-plan', 'codex')).toBe(true);
    expect(skillLinked(project, 'lantern-plan', 'claude')).toBe(false);
  });
});

describe('lantern run flags', () => {
  it('pins the model floor for lantern kinds only', () => {
    for (const kind of ['lantern', 'lantern-refresh'] as const) {
      const args = buildArgs(kind, 'p');
      expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-5-5');
      expect(args[args.indexOf('--model') + 1]).toBe(LANTERN_MODEL);
    }
    expect(buildArgs('plan-fix', 'p')).not.toContain('--model');
  });

  it('maps the offered languages to codes, unknown to en', () => {
    expect(languageCode('English')).toBe('en');
    expect(languageCode('Polish')).toBe('pl');
    expect(languageCode('Ukrainian')).toBe('uk');
    expect(languageCode('Klingon')).toBe('en');
    expect(languageCode(undefined)).toBe('en');
  });

  it('prompts follow platforms and sections, refresh migrates legacy maps, no language suffix', () => {
    for (const kind of ['lantern', 'lantern-refresh'] as const) {
      const p = buildPrompt(kind, 'Polish');
      expect(p).toContain('step 1a');
      expect(p).toContain('step 4');
      expect(p).not.toContain('in Polish');
    }
    expect(buildPrompt('lantern-refresh')).toContain('migrate-lang.mjs');
  });

  it('accepts native session identifiers and rejects option-shaped values', () => {
    expect(isSessionId('01a0fc31-fd36-7051-91b9-e594352e2387')).toBe(true);
    expect(isSessionId('thr_12345678')).toBe(true);
    expect(isSessionId('--dangerously-bypass')).toBe(false);
  });

  it('surfaces a clean exit that never emitted a terminal event', () => {
    expect(exitEvent(0, false, '', false, 'codex')).toEqual({ kind: 'error', text: 'Codex exited without a completion event.' });
    expect(exitEvent(0, false, '', true, 'codex')).toBeNull();
  });
});

describe('ensureMapperAgent', () => {
  let project: string;
  let home: string;
  let root: string;
  const rel = path.join('.claude', 'agents', 'lantern-mapper.md');
  const marker = () => path.join(project, '.claude', 'agents', '.lantern-bundle-agents');
  const source = () => path.join(root, 'lantern-setup', 'agents', 'lantern-mapper.md');

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-mapper-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-home-'));
    root = path.join(project, 'bundled');
    fs.mkdirSync(path.dirname(source()), { recursive: true });
    fs.writeFileSync(source(), 'from skill');
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('copies the skill agent into the project with the bundle marker when absent everywhere', () => {
    expect(ensureMapperAgent(project, home, root)).toBe('installed');
    expect(fs.readFileSync(path.join(project, rel), 'utf8')).toBe('from skill');
    expect(fs.readFileSync(marker(), 'utf8').split('\n')).toContain('lantern-mapper.md');
    expect(fs.existsSync(path.join(home, rel))).toBe(false);
    expect(ensureMapperAgent(project, home, root)).toBe('exists');
  });

  it('refreshes an owned copy when the bundled file changes', () => {
    ensureMapperAgent(project, home, root);
    fs.writeFileSync(source(), 'newer rules');
    expect(ensureMapperAgent(project, home, root)).toBe('refreshed');
    expect(fs.readFileSync(path.join(project, rel), 'utf8')).toBe('newer rules');
  });

  it('replaces an old unmarked copy once, marks it, and changes nothing the next run', () => {
    fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    fs.writeFileSync(path.join(project, rel), 'copied by an old build');
    expect(ensureMapperAgent(project, home, root)).toBe('refreshed');
    expect(fs.readFileSync(path.join(project, rel), 'utf8')).toBe('from skill');
    expect(fs.readFileSync(marker(), 'utf8').split('\n')).toContain('lantern-mapper.md');
    expect(ensureMapperAgent(project, home, root)).toBe('exists');
    fs.writeFileSync(path.join(project, rel), 'edited after');
    expect(ensureMapperAgent(project, home, root)).toBe('exists');
    expect(fs.readFileSync(path.join(project, rel), 'utf8')).toBe('edited after');
  });

  it('replaces an old unmarked copy even when a marker exists for other agents', () => {
    fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(marker(), 'oldhash\nreviewer.md\n');
    fs.writeFileSync(path.join(project, rel), 'mine');
    expect(ensureMapperAgent(project, home, root)).toBe('refreshed');
    expect(fs.readFileSync(path.join(project, rel), 'utf8')).toBe('from skill');
  });

  it('keeps an unmarked copy of any other agent', () => {
    const delegates = path.join(root, 'lantern-delegate', 'agents');
    fs.mkdirSync(delegates, { recursive: true });
    fs.writeFileSync(path.join(delegates, 'reviewer.md'), 'reviewer');
    fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'agents', 'reviewer.md'), 'mine');
    installBundle({ project, root, home, skills: [], agents: ['reviewer.md'] });
    ensureMapperAgent(project, home, root);
    expect(fs.readFileSync(path.join(project, '.claude', 'agents', 'reviewer.md'), 'utf8')).toBe('mine');
  });

  it('installs next to a marker written by the delegate agents install', () => {
    const delegates = path.join(root, 'lantern-delegate', 'agents');
    fs.mkdirSync(delegates, { recursive: true });
    fs.writeFileSync(path.join(delegates, 'reviewer.md'), 'reviewer');
    installBundle({ project, root, home, skills: [], agents: ['reviewer.md'] });
    expect(fs.existsSync(path.join(project, rel))).toBe(false);
    expect(ensureMapperAgent(project, home, root)).toBe('installed');
    expect(fs.existsSync(path.join(project, '.claude', 'agents', 'reviewer.md'))).toBe(true);
    expect(fs.readFileSync(marker(), 'utf8').split('\n')).toEqual(expect.arrayContaining(['lantern-mapper.md', 'reviewer.md']));
  });

  it('lets a user-level copy win and never writes to home', () => {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), 'home');
    expect(ensureMapperAgent(project, home, root)).toBe('exists');
    expect(fs.existsSync(path.join(project, rel))).toBe(false);
    expect(fs.readFileSync(path.join(home, rel), 'utf8')).toBe('home');
    fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    fs.writeFileSync(path.join(project, rel), 'old');
    expect(ensureMapperAgent(project, home, root)).toBe('exists');
    expect(fs.readFileSync(path.join(project, rel), 'utf8')).toBe('old');
  });

  it('reports a missing source instead of throwing', () => {
    fs.rmSync(path.dirname(source()), { recursive: true });
    expect(ensureMapperAgent(project, home, root)).toBe('missing-source');
  });
});

describe('ensureLanternSkills', () => {
  let project: string;
  let home: string;
  let root: string;
  const dest = (name = 'lantern-setup') => path.join(project, '.claude', 'skills', name);

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-ls-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-lshome-'));
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-lsb-'));
    for (const name of LANTERN_SKILLS) {
      fs.mkdirSync(path.join(root, name, 'scripts'), { recursive: true });
      if (name === 'lantern-setup') fs.mkdirSync(path.join(root, name, 'example-web'));
      fs.writeFileSync(path.join(root, name, 'SKILL.md'), `skill ${name}`);
      fs.writeFileSync(path.join(root, name, 'scripts', 'run.mjs'), 'v');
      if (name === 'lantern-setup') fs.writeFileSync(path.join(root, name, 'example-web', 'big.json'), '{}');
    }
  });

  afterEach(() => {
    for (const d of [project, home, root]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('installs both skills when absent, without example-web and without touching home', () => {
    expect(ensureLanternSkills(project, home, root)).toEqual({ 'lantern-setup': 'installed', 'lantern-sync': 'installed' });
    for (const name of LANTERN_SKILLS) {
      expect(fs.readFileSync(path.join(dest(name), 'SKILL.md'), 'utf8')).toBe(`skill ${name}`);
      expect(fs.existsSync(path.join(dest(name), 'scripts', 'run.mjs'))).toBe(true);
    }
    expect(fs.existsSync(path.join(dest(), 'example-web'))).toBe(false);
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('skips per skill when a directory exists and never overwrites it', () => {
    fs.mkdirSync(dest('lantern-sync'), { recursive: true });
    fs.writeFileSync(path.join(dest('lantern-sync'), 'SKILL.md'), 'mine');
    expect(ensureLanternSkills(project, home, root)).toEqual({ 'lantern-setup': 'installed', 'lantern-sync': 'unmarked' });
    expect(fs.readFileSync(path.join(dest('lantern-sync'), 'SKILL.md'), 'utf8')).toBe('mine');
    expect(fs.existsSync(path.join(dest('lantern-sync'), 'scripts'))).toBe(false);
  });

  it('skips when a symlink exists, even a dangling one', () => {
    fs.mkdirSync(path.dirname(dest()), { recursive: true });
    fs.symlinkSync(path.join(project, 'nowhere'), dest('lantern-sync'));
    expect(ensureLanternSkills(project, home, root)['lantern-sync']).toBe('symlink');
    expect(fs.lstatSync(dest('lantern-sync')).isSymbolicLink()).toBe(true);
  });

  it('skips a skill the home skills folder has, including a dangling symlink', () => {
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'lantern-setup'), { recursive: true });
    fs.symlinkSync(path.join(home, 'nowhere'), path.join(home, '.claude', 'skills', 'lantern-sync'));
    expect(ensureLanternSkills(project, home, root)).toEqual({ 'lantern-setup': 'home', 'lantern-sync': 'home' });
    for (const name of LANTERN_SKILLS) expect(fs.existsSync(dest(name))).toBe(false);
  });

  it('reports a missing bundled source', () => {
    expect(ensureLanternSkills(project, home, path.join(project, 'none'))['lantern-sync']).toBe('missing-source');
  });

  it('finds the repo copies of both skills by default', () => {
    expect(ensureLanternSkills(project, home)).toEqual({ 'lantern-setup': 'installed', 'lantern-sync': 'installed' });
    expect(fs.existsSync(path.join(dest(), 'agents', 'lantern-mapper.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest(), 'example-web'))).toBe(false);
    expect(fs.existsSync(path.join(dest('lantern-sync'), 'scripts', 'sync.mjs'))).toBe(true);
  });

  it('installs Codex Lantern skills under .agents without a mapper profile', () => {
    expect(ensureLanternSkills(project, home, root, 'codex')).toEqual({ 'lantern-setup': 'installed', 'lantern-sync': 'installed' });
    for (const name of LANTERN_SKILLS) expect(fs.existsSync(path.join(project, '.agents', 'skills', name, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.codex'))).toBe(false);
  });
});

describe('preflight', () => {
  it('lets lantern kinds run unlinked but still requires the skill for a plan fix', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-pf-'));
    expect(preflight(project, 'lantern')).toBeNull();
    expect(preflight(project, 'lantern-refresh')).toBeNull();
    expect(preflight(project, 'plan-fix')).toMatch(/lantern-plan skill is not linked/);
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('preflights only the selected provider skill root', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-pf-'));
    fs.mkdirSync(path.join(project, '.claude', 'skills', 'lantern-plan'), { recursive: true });
    expect(preflight(project, 'plan-fix', 'codex')).toMatch(/not linked for Codex/);
    fs.mkdirSync(path.join(project, '.agents', 'skills', 'lantern-plan'), { recursive: true });
    expect(preflight(project, 'plan-fix', 'codex')).toBeNull();
    fs.rmSync(project, { recursive: true, force: true });
  });
});

describe('tool events for the run screen', () => {
  const assistant = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { content } });

  it('carries what a tool call acted on', () => {
    const events: any[] = [];
    handleLine(assistant([{ type: 'tool_use', name: 'Read', input: { file_path: '/p/src/a.ts' } }, { type: 'tool_use', name: 'Bash', input: { command: 'node  plan.mjs .\n  chunk 7' } }]), (e) => events.push(e));
    expect(events).toEqual([
      { kind: 'tool', tool: 'Read', detail: '/p/src/a.ts' },
      { kind: 'tool', tool: 'Bash', detail: 'node plan.mjs . chunk 7' },
    ]);
  });

  it('has no detail when the call has none, and caps a long one', () => {
    expect(toolDetail(undefined)).toBeUndefined();
    expect(toolDetail({ file_path: 42 })).toBeUndefined();
    expect(toolDetail({ command: '   ' })).toBeUndefined();
    expect(toolDetail({ command: 'x'.repeat(500) })).toHaveLength(400);
  });
});

describe('Lantern prompts on a continued run', () => {
  it('tell the run that finished chunks stay finished', () => {
    for (const kind of ['lantern', 'lantern-refresh'] as const) {
      const prompt = buildPrompt(kind);
      expect(prompt).toContain('plan.mjs . pending');
      expect(prompt).toContain('never redo a chunk that is done');
    }
  });
});
