import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPTS = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts');
const SCRIPT = path.join(SCRIPTS, 'required-skills.mjs');
const SKILL_FILE = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'SKILL.md');
const PROTOCOL = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'protocol.md');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function world(config: object | string | null, installed: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'required-skills-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(project, '.claude', 'skills'), { recursive: true });
  if (config !== null) fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), typeof config === 'string' ? config : JSON.stringify(config));
  for (const name of installed) {
    fs.mkdirSync(path.join(project, '.claude', 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
  }
  return { home, project };
}

function list(args: string[], w: { home: string; project: string }) {
  const res = spawnSync('node', [SCRIPT, ...args, '--home', w.home], { cwd: w.project, encoding: 'utf8' });
  const lines = res.stdout.split('\n').filter(Boolean);
  return { status: res.status, names: lines.filter((l) => !l.startsWith('warning:')), warnings: lines.filter((l) => l.startsWith('warning:')), err: res.stderr };
}

describe('requiredSkills', () => {
  it('lists the fixed skills of the role, then the slot names, in order and without duplicates', async () => {
    const mod = await import(path.join(SCRIPTS, 'required-skills.mjs'));
    expect(mod.requiredSkills(mod.ROLE.delegate)).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop']);
    expect(mod.requiredSkills(mod.ROLE.delegate, ['alpha', 'lantern-commit', 'beta', 'alpha'])).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop', 'alpha', 'beta']);
    expect(mod.requiredSkills(mod.ROLE.orchestrator)).toEqual(['lantern-sync']);
    expect(mod.requiredSkills(mod.ROLE.orchestrator, ['gamma'], { host: 'lantern-github', plan: true })).toEqual([
      'lantern-sync',
      'lantern-github',
      'lantern-plan',
      'lantern-plan-handoff',
      'gamma',
    ]);
  });

  it('lists the fixed skills of the reviewer, then its slot names', async () => {
    const mod = await import(path.join(SCRIPTS, 'required-skills.mjs'));
    expect(mod.requiredSkills(mod.ROLE.reviewer)).toEqual(['lantern-no-comments', 'lantern-code-reviewer']);
    expect(mod.requiredSkills(mod.ROLE.reviewer, ['alpha', 'lantern-no-comments', 'alpha'])).toEqual(['lantern-no-comments', 'lantern-code-reviewer', 'alpha']);
    expect(mod.requiredSkills(mod.ROLE.reviewer, [], { host: 'lantern-github', plan: true })).toEqual(mod.REVIEWER_SKILLS);
  });

  it('keeps the host and planning skills out of the delegate list', async () => {
    const mod = await import(path.join(SCRIPTS, 'required-skills.mjs'));
    expect(mod.requiredSkills(mod.ROLE.delegate, [], { host: 'lantern-github', plan: true })).toEqual(mod.REQUIRED_SKILLS);
  });

  it('drops a switched-off switchable skill of the role and nothing else', async () => {
    const mod = await import(path.join(SCRIPTS, 'required-skills.mjs'));
    expect(mod.requiredSkills('delegate', [], { off: ['lantern-no-comments'] })).toEqual(['lantern-commit', 'lantern-local-loop']);
    expect(mod.requiredSkills('reviewer', [], { off: ['lantern-no-comments', 'lantern-code-reviewer'] })).toEqual([]);
    expect(mod.requiredSkills('reviewer', [], { off: ['lantern-commit'] })).toEqual(mod.REVIEWER_SKILLS);
    expect(mod.requiredSkills('orchestrator', [], { off: ['lantern-sync'] })).toEqual(['lantern-sync']);
    expect(mod.requiredSkills('orchestrator', [], { host: 'lantern-github', plan: true, off: ['lantern-github', 'lantern-plan', 'lantern-sync'] })).toEqual(['lantern-sync', 'lantern-github', 'lantern-plan', 'lantern-plan-handoff']);
  });

  it('keeps a switched-off name that is also an extra, as an extra', async () => {
    const mod = await import(path.join(SCRIPTS, 'required-skills.mjs'));
    expect(mod.requiredSkills('delegate', ['lantern-commit', 'alpha'], { off: ['lantern-commit'] })).toEqual(['lantern-no-comments', 'lantern-local-loop', 'lantern-commit', 'alpha']);
  });

  it('rejects a role that is not a slot', async () => {
    const mod = await import(path.join(SCRIPTS, 'required-skills.mjs'));
    expect(() => mod.requiredSkills('nobody')).toThrow('not a role');
  });
});

describe('required-skills.mjs', () => {
  it('prints the delegate list by default: the fixed skills, then the installed slot names', () => {
    const w = world({ delegate: ['alpha', 'beta'], orchestrator: ['gamma'] }, ['alpha', 'beta', 'gamma']);
    const r = list([], w);
    expect(r.status).toBe(0);
    expect(r.names).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop', 'alpha', 'beta']);
    expect(r.warnings).toEqual([]);
  });

  it('prints the orchestrator list for --role orchestrator, with --host and --plan when given', () => {
    const w = world({ delegate: ['alpha'], orchestrator: ['gamma'] }, ['alpha', 'gamma']);
    expect(list(['--role', 'orchestrator'], w).names).toEqual(['lantern-sync', 'gamma']);
    expect(list(['--role', 'orchestrator', '--host', 'lantern-bitbucket', '--plan'], w).names).toEqual([
      'lantern-sync',
      'lantern-bitbucket',
      'lantern-plan',
      'lantern-plan-handoff',
      'gamma',
    ]);
  });

  it('prints the reviewer list for --role reviewer: its fixed skills, then the installed reviewer slot names', () => {
    const w = world({ delegate: ['alpha'], orchestrator: ['gamma'], reviewer: ['delta', 'missing'] }, ['alpha', 'gamma', 'delta']);
    const r = list(['--role', 'reviewer'], w);
    expect(r.status).toBe(0);
    expect(r.names).toEqual(['lantern-no-comments', 'lantern-code-reviewer', 'delta']);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('missing');
  });

  it('prints extras chosen without any skill linker, from the project and from the home folder', () => {
    const w = world({ delegate: ['typescript', 'zod-schemas'], orchestrator: ['react-spa-forms'], reviewer: ['typescript'] }, ['typescript']);
    for (const name of ['zod-schemas', 'react-spa-forms']) {
      fs.mkdirSync(path.join(w.home, '.claude', 'skills', name), { recursive: true });
      fs.writeFileSync(path.join(w.home, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
    }
    expect(JSON.parse(fs.readFileSync(path.join(w.home, '.claude', 'lantern-extensions.json'), 'utf8'))).not.toHaveProperty('skillLinker');
    expect(list([], w)).toMatchObject({ names: ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop', 'typescript', 'zod-schemas'], warnings: [] });
    expect(list(['--role', 'orchestrator'], w)).toMatchObject({ names: ['lantern-sync', 'react-spa-forms'], warnings: [] });
    expect(list(['--role', 'reviewer'], w)).toMatchObject({ names: ['lantern-no-comments', 'lantern-code-reviewer', 'typescript'], warnings: [] });
  });

  it('prints only the fixed skills for an empty or missing config', () => {
    expect(list([], world(null, [])).names).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop']);
    expect(list([], world({ delegate: [], orchestrator: [] }, [])).names).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop']);
    expect(list(['--role', 'reviewer'], world(null, [])).names).toEqual(['lantern-no-comments', 'lantern-code-reviewer']);
  });

  it('skips a slot name that is not installed and warns with its name', () => {
    const w = world({ delegate: ['alpha', 'beta'] }, ['alpha']);
    const r = list([], w);
    expect(r.names).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop', 'alpha']);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('beta');
  });

  it('treats a damaged config as empty with a warning', () => {
    const r = list([], world('{ not json', []));
    expect(r.names).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop']);
    expect(r.warnings[0]).toContain('ignored');
  });

  it('leaves out a switched-off name of the delegate and keeps the rest, the extras included', () => {
    const w = world({ delegate: ['alpha'], off: { delegate: ['lantern-commit'] } }, ['alpha']);
    const r = list([], w);
    expect(r.names).toEqual(['lantern-no-comments', 'lantern-local-loop', 'alpha']);
    expect(r.warnings).toEqual([]);
  });

  it('leaves out a switched-off name of the reviewer, for the reviewer role only', () => {
    const w = world({ off: { reviewer: ['lantern-code-reviewer'], delegate: ['lantern-local-loop'] } }, []);
    expect(list(['--role', 'reviewer'], w).names).toEqual(['lantern-no-comments']);
    expect(list([], w).names).toEqual(['lantern-commit', 'lantern-no-comments']);
  });

  it('can switch every switchable skill of a role off and still prints the extras', () => {
    const w = world({ reviewer: ['delta'], off: { reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] } }, ['delta']);
    expect(list(['--role', 'reviewer'], w).names).toEqual(['delta']);
  });

  it('never drops a locked skill: an off list naming one warns, drops the name and prints the whole list', () => {
    const w = world({ off: { orchestrator: ['lantern-sync'], delegate: ['lantern-setup', 'lantern-github', 'lantern-plan', 'lantern-commit'] } }, []);
    const orchestrator = list(['--role', 'orchestrator', '--host', 'lantern-github', '--plan'], w);
    expect(orchestrator.names).toEqual(['lantern-sync', 'lantern-github', 'lantern-plan', 'lantern-plan-handoff']);
    expect(orchestrator.warnings).toHaveLength(1);
    expect(orchestrator.warnings[0]).toContain('lantern-sync');
    expect(orchestrator.warnings[0]).toContain('lantern-setup');
    const delegate = list([], w);
    expect(delegate.names).toEqual(['lantern-no-comments', 'lantern-local-loop']);
    expect(delegate.warnings[0]).toContain('lantern-github');
  });

  it('warns about an unknown name in the off list and drops it', () => {
    const r = list([], world({ off: { delegate: ['mystery', 'lantern-local-loop'] } }, []));
    expect(r.names).toEqual(['lantern-commit', 'lantern-no-comments']);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('mystery');
  });

  it('treats an off key of the wrong shape as a damaged config', () => {
    const r = list([], world({ off: ['lantern-commit'] }, []));
    expect(r.names).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop']);
    expect(r.warnings[0]).toContain('ignored');
  });

  it('exits 2 on a role that is not a slot, an unknown host skill or a stray argument', () => {
    const w = world(null, []);
    expect(list(['--role', 'nobody'], w).status).toBe(2);
    expect(list(['--role', 'orchestrator', '--host', 'jira'], w).status).toBe(2);
    expect(list(['stray'], w).status).toBe(2);
  });
});

describe('required-skills.mjs with project extras', () => {
  const CORE = ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop'];
  const putProject = (project: string, data: object | string) => {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'lantern-extensions.json'), typeof data === 'string' ? data : JSON.stringify(data));
  };
  const sibling = (w: { home: string; project: string }, installed: string[]) => {
    const dir = path.join(path.dirname(w.project), 'other-project');
    for (const name of installed) {
      fs.mkdirSync(path.join(dir, '.claude', 'skills', name), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
    }
    return { home: w.home, project: dir };
  };

  it('prints a project-level extra only when run inside that project, after the global ones', () => {
    const w = world({ delegate: ['alpha'] }, ['alpha', 'only-here']);
    putProject(w.project, { delegate: ['only-here'] });
    const inside = list([], w);
    expect(inside.status).toBe(0);
    expect(inside.names).toEqual([...CORE, 'alpha', 'only-here']);
    expect(inside.warnings).toEqual([]);
    const outside = list([], sibling(w, ['alpha', 'only-here']));
    expect(outside.names).toEqual([...CORE, 'alpha']);
    expect(outside.warnings).toEqual([]);
  });

  it('prints each role from its own lists, global first, without a repeat', () => {
    const w = world({ delegate: ['alpha', 'beta'], reviewer: ['rev-global'] }, ['alpha', 'beta', 'gamma', 'rev-global', 'rev-project', 'orch-project']);
    putProject(w.project, { delegate: ['gamma', 'alpha'], reviewer: ['rev-project'], orchestrator: ['orch-project'] });
    expect(list([], w).names).toEqual([...CORE, 'alpha', 'beta', 'gamma']);
    expect(list(['--role', 'reviewer'], w).names).toEqual(['lantern-no-comments', 'lantern-code-reviewer', 'rev-global', 'rev-project']);
    expect(list(['--role', 'orchestrator'], w).names).toEqual(['lantern-sync', 'orch-project']);
  });

  it('warns about a project extra that is not installed in that project, and in no other project', () => {
    const w = world({ delegate: ['alpha'] }, ['alpha']);
    putProject(w.project, { delegate: ['absent'] });
    const inside = list([], w);
    expect(inside.names).toEqual([...CORE, 'alpha']);
    expect(inside.warnings).toHaveLength(1);
    expect(inside.warnings[0]).toContain('absent');
    expect(list([], sibling(w, ['alpha'])).warnings).toEqual([]);
  });

  it('still warns about a global extra the project does not have, for that project only', () => {
    const w = world({ delegate: ['alpha', 'elsewhere'] }, ['alpha']);
    const r = list([], w);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('elsewhere');
    expect(list([], sibling(w, ['alpha', 'elsewhere'])).warnings).toEqual([]);
  });

  it('names a damaged project file, keeps the global extras and still exits 0', () => {
    const w = world({ delegate: ['alpha'] }, ['alpha']);
    putProject(w.project, '{ not json');
    const r = list([], w);
    expect(r.status).toBe(0);
    expect(r.names).toEqual([...CORE, 'alpha']);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(path.join(w.project, '.claude', 'lantern-extensions.json'));
  });

  it('drops a locked name in the project file with a warning that names the file', () => {
    const w = world(null, ['beta']);
    putProject(w.project, { delegate: ['lantern-sync', 'beta'] });
    const r = list([], w);
    expect(r.names).toEqual([...CORE, 'beta']);
    expect(r.warnings[0]).toContain('lantern-sync');
    expect(r.warnings[0]).toContain('lantern-extensions.json');
  });

  it('reads the project file of the main checkout when run in a worktree of it, and not in a worktree of another repository', () => {
    const w = world({ delegate: ['alpha'] }, ['alpha', 'only-here']);
    const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    git(w.project, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(w.project, '.gitignore'), '.claude/*\n');
    git(w.project, 'add', '.gitignore');
    git(w.project, 'commit', '-q', '-m', 'init');
    putProject(w.project, { delegate: ['only-here'] });
    const worktree = path.join(w.project, '.claude', 'worktrees', 'agent-1');
    expect(git(w.project, 'worktree', 'add', '-q', '-b', 'agent-1', worktree).status).toBe(0);
    fs.mkdirSync(path.join(worktree, '.claude'), { recursive: true });
    fs.symlinkSync(path.join(w.project, '.claude', 'skills'), path.join(worktree, '.claude', 'skills'));
    expect(fs.existsSync(path.join(worktree, '.claude', 'lantern-extensions.json'))).toBe(false);
    const fromWorktree = list([], { home: w.home, project: worktree });
    expect(fromWorktree.names).toEqual([...CORE, 'alpha', 'only-here']);
    expect(fromWorktree.warnings).toEqual([]);

    const stranger = sibling(w, ['alpha', 'only-here']);
    git(stranger.project, 'init', '-q', '-b', 'main');
    git(stranger.project, 'commit', '-q', '--allow-empty', '-m', 'init');
    const strangerTree = path.join(stranger.project, '.claude', 'worktrees', 'agent-1');
    expect(git(stranger.project, 'worktree', 'add', '-q', '-b', 'agent-1', strangerTree).status).toBe(0);
    expect(list([], { home: w.home, project: strangerTree }).names).toEqual([...CORE, 'alpha']);
  });

  it('takes the project from --project when it is given, from any working directory', () => {
    const w = world(null, ['only-here']);
    putProject(w.project, { delegate: ['only-here'] });
    const elsewhere = sibling(w, []);
    fs.mkdirSync(elsewhere.project, { recursive: true });
    const res = spawnSync('node', [SCRIPT, '--home', w.home, '--project', w.project], { cwd: elsewhere.project, encoding: 'utf8' });
    expect(res.stdout.split('\n').filter(Boolean)).toEqual([...CORE, 'only-here']);
    expect(spawnSync('node', [SCRIPT, '--home', w.home, '--project'], { cwd: w.project, encoding: 'utf8' }).status).toBe(2);
  });

  it('holds check-skill-use.mjs to the same effective list', () => {
    const w = world({ delegate: ['alpha'] }, ['alpha', 'only-here']);
    putProject(w.project, { delegate: ['only-here'] });
    const transcript = path.join(path.dirname(w.project), 'transcript.jsonl');
    const read = (name: string) => JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: `${w.project}/.claude/skills/${name}/SKILL.md` } }] } });
    fs.writeFileSync(transcript, [...CORE, 'alpha'].map(read).join('\n'));
    const check = path.join(SCRIPTS, 'check-skill-use.mjs');
    const inside = spawnSync('node', [check, '--home', w.home, transcript], { cwd: w.project, encoding: 'utf8' });
    expect(inside.status).toBe(1);
    expect(inside.stdout).toContain('skill-not-read only-here');
    const outside = spawnSync('node', [check, '--home', w.home, transcript], { cwd: sibling(w, ['alpha']).project, encoding: 'utf8' });
    expect(outside.stdout).not.toContain('only-here');
  });
});

describe('no text keeps a list of the switchable skills', () => {
  const AGENT_DIRS = ['lantern-delegate', 'lantern-delegate-complex'].map((skill) => path.join(__dirname, '..', 'skills', skill, 'agents'));
  const switchable = async () => {
    const bundled = await import(path.join(SCRIPTS, 'bundled-skills.mjs'));
    return [...new Set(Object.values(bundled.SWITCHABLE_SKILLS).flat())] as string[];
  };
  const namedIn = (text: string, names: string[]) => names.filter((name) => text.includes(name));

  it('the agent definitions name none of them, so a switched-off skill cannot be demanded by them', async () => {
    const names = await switchable();
    expect(names.length).toBeGreaterThan(0);
    for (const dir of AGENT_DIRS) {
      for (const file of fs.readdirSync(dir).filter((entry) => entry.endsWith('.md'))) {
        expect(namedIn(fs.readFileSync(path.join(dir, file), 'utf8'), names), file).toEqual([]);
      }
    }
  });

  it('protocol.md names none of them', async () => {
    expect(namedIn(fs.readFileSync(PROTOCOL, 'utf8'), await switchable())).toEqual([]);
  });

  it('no line of SKILL.md lists two of them', async () => {
    const names = await switchable();
    const lists = fs
      .readFileSync(SKILL_FILE, 'utf8')
      .split('\n')
      .filter((line) => namedIn(line, names).length > 1);
    expect(lists).toEqual([]);
  });
});
