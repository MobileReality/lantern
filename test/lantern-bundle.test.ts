import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS_MARKER, BUNDLE_SKILLS, installBundle, installBundleGuarded, SKILL_MARKER } from '../scripts/lantern-bundle.mjs';
import { bundledSkillsRoot } from '../src/main/agent';
import { extensionsPath } from '../src/main/extensions';
import { forgetAttempts, installLanternBundle, installOnOpen, settled, settledFor } from '../src/main/bundle';
import { AGENT_NAMES, git, makeBundle, makeRepo, snapshot } from './support/bundle-fixtures';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const ALL_SKILLS = BUNDLE_SKILLS.map((s) => s.name);
const INTEGRATION_SKILLS = ['lantern-jira', 'lantern-bitbucket', 'lantern-github'];
const CODEX_SKILLS = ['lantern-setup', 'lantern-sync', 'lantern-delegate', ...INTEGRATION_SKILLS];
const COMPLEX_FILES = ['fable', 'opus'].flatMap((model) => ['high', 'medium', 'xhigh'].map((effort) => `lantern-delegate-complex-${model}-${effort}.md`));

let tmp: string;
let project: string;
let home: string;
let root: string;

const skillDir = (name: string, at = project) => path.join(at, '.claude', 'skills', name);
const agentsDir = (at = project) => path.join(at, '.claude', 'agents');
const run = (at = project) => installBundleGuarded({ project: at, root, home });
const agentFiles = (at = project) => (fs.existsSync(agentsDir(at)) ? fs.readdirSync(agentsDir(at)).sort() : []);

function callsOf(source: string, fn: string): string[] {
  const args: string[] = [];
  for (const match of source.matchAll(new RegExp(`\\b${fn}\\(`, 'g'))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (depth > 0 && end < source.length) {
      const char = source[end++];
      if (char === '(') depth++;
      if (char === ')') depth--;
    }
    args.push(source.slice(start, end - 1));
  }
  return args;
}

beforeEach(() => {
  forgetAttempts();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-bundle-'));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'bundle');
  project = makeRepo(path.join(tmp, 'project'));
  fs.mkdirSync(home);
  makeBundle(root);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('installing on open', () => {
  it('installs all bundled skills and the agent types into a git repo that ignores .claude', async () => {
    const result = await run();
    expect(result.skills).toEqual(Object.fromEntries(ALL_SKILLS.map((n) => [n, 'installed'])));
    for (const name of ALL_SKILLS) {
      expect(fs.readFileSync(path.join(skillDir(name), 'SKILL.md'), 'utf8')).toBe(`${name} v1`);
      expect(fs.readFileSync(path.join(skillDir(name), SKILL_MARKER), 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
    }
    expect(fs.existsSync(skillDir('lantern-setup') + '/example-web')).toBe(false);
    expect(fs.existsSync(skillDir('lantern-delegate') + '/agents')).toBe(false);
    expect(agentFiles()).toEqual([AGENTS_MARKER, ...AGENT_NAMES.map((n) => `${n}.md`)].sort());
    expect(fs.readFileSync(path.join(agentsDir(), AGENTS_MARKER), 'utf8')).toMatch(/^[0-9a-f]{64}\nlantern-delegate-complex-fable-high\.md\n/);
  });

  it('leaves git status of the project clean and writes nothing to home', async () => {
    await run();
    expect(git(project, 'status', '--short')).toBe('');
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('installs the real bundle, agents included', async () => {
    const result = await installBundleGuarded({ project, root: bundledSkillsRoot(), home });
    expect(result.skills['lantern-delegate']).toBe('installed');
    expect(result.skills['lantern-delegate-complex']).toBe('installed');
    for (const name of ['lantern-delegate-low', 'lantern-delegate-medium', 'lantern-delegate-high', 'lantern-delegate-xhigh', 'reviewer', ...COMPLEX_FILES.map((file) => file.replace('.md', '')), 'reviewer-complex', 'lantern-mapper']) {
      expect(fs.existsSync(path.join(agentsDir(), `${name}.md`)), name).toBe(true);
    }
    expect(fs.existsSync(skillDir('lantern-setup') + '/example-web')).toBe(false);
    expect(git(project, 'status', '--short')).toBe('');
  });

  it('installs the per-file reasons: docs, protocol and a sync.mjs that accepts --why', async () => {
    await installBundleGuarded({ project, root: bundledSkillsRoot(), home });
    expect(fs.readFileSync(path.join(skillDir('lantern-sync'), 'SKILL.md'), 'utf8')).toContain('--reason-file');
    expect(fs.readFileSync(path.join(skillDir('lantern-delegate'), 'protocol.md'), 'utf8')).toContain('--require-reason');
    expect(fs.readFileSync(path.join(skillDir('lantern-setup'), 'references', 'format.md'), 'utf8')).toContain('#reason <path> <reason>');
    const usage = spawnSync(process.execPath, [path.join(skillDir('lantern-sync'), 'scripts', 'sync.mjs')], { cwd: project, encoding: 'utf8' });
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain('[--reason <path>=<reason>]... [--reason-file <json>]');
    expect(usage.stderr).toContain('--require-reason');
  });
});

describe('extras on a fresh install', () => {
  it('ships no preset list and writes nothing into the user config', async () => {
    await installBundleGuarded({ project, root: bundledSkillsRoot(), home });
    expect(fs.existsSync(path.join(bundledSkillsRoot(), 'lantern-delegate', 'presets'))).toBe(false);
    expect(fs.existsSync(path.join(skillDir('lantern-delegate'), 'presets'))).toBe(false);
    expect(fs.existsSync(extensionsPath(home))).toBe(false);
    expect(fs.readdirSync(home)).toEqual([]);
  });
});

describe('default integration skills', () => {
  const USER_SKILLS = ['team-tickets', 'team-pr', 'team-merge'];

  function writeUserSkills(at: string) {
    for (const name of USER_SKILLS) {
      fs.mkdirSync(path.join(at, name, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(at, name, 'SKILL.md'), `---\nname: ${name}\n---\nmy own ${name}\n`);
      fs.writeFileSync(path.join(at, name, 'scripts', 'run.sh'), `echo ${name}\n`);
    }
  }

  it('installs the three beside a project user skill of the same purpose and leaves it byte for byte', async () => {
    writeUserSkills(path.join(project, '.claude', 'skills'));
    const before = USER_SKILLS.map((name) => snapshot(skillDir(name)));
    const result = await installBundleGuarded({ project, root: bundledSkillsRoot(), home });
    for (const name of INTEGRATION_SKILLS) {
      expect(result.skills[name], name).toBe('installed');
      expect(fs.existsSync(path.join(skillDir(name), 'SKILL.md')), name).toBe(true);
      expect(fs.existsSync(path.join(skillDir(name), SKILL_MARKER)), name).toBe(true);
    }
    expect(USER_SKILLS.map((name) => snapshot(skillDir(name)))).toEqual(before);
    for (const name of USER_SKILLS) {
      expect(result.skills[name]).toBeUndefined();
      expect(fs.existsSync(path.join(skillDir(name), SKILL_MARKER)), name).toBe(false);
    }
  });

  it('leaves the user skills in ~/.claude/skills alone and still installs the three', async () => {
    writeUserSkills(path.join(home, '.claude', 'skills'));
    const before = snapshot(path.join(home, '.claude', 'skills'));
    const result = await installBundleGuarded({ project, root: bundledSkillsRoot(), home });
    expect(INTEGRATION_SKILLS.map((name) => result.skills[name])).toEqual(['installed', 'installed', 'installed']);
    expect(snapshot(path.join(home, '.claude', 'skills'))).toEqual(before);
  });

  it('never overwrites an unmarked folder that already carries one of the three names', async () => {
    fs.mkdirSync(skillDir('lantern-jira'), { recursive: true });
    fs.writeFileSync(path.join(skillDir('lantern-jira'), 'SKILL.md'), 'the user wrote this');
    const result = await installBundleGuarded({ project, root: bundledSkillsRoot(), home });
    expect(result.skills['lantern-jira']).toBe('unmarked');
    expect(fs.readFileSync(path.join(skillDir('lantern-jira'), 'SKILL.md'), 'utf8')).toBe('the user wrote this');
    expect(result.skills['lantern-github']).toBe('installed');
  });

  it('keeps a copy under the same name in ~/.claude/skills instead of installing a second one', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'lantern-github'), { recursive: true });
    const result = await installBundleGuarded({ project, root: bundledSkillsRoot(), home });
    expect(result.skills['lantern-github']).toBe('home');
    expect(fs.existsSync(skillDir('lantern-github'))).toBe(false);
  });

  it('says in each description that a user skill of the same purpose takes precedence and that no setup beyond Lantern is needed', () => {
    for (const name of INTEGRATION_SKILLS) {
      const text = fs.readFileSync(path.join(bundledSkillsRoot(), name, 'SKILL.md'), 'utf8');
      const description = /^description: (.+)$/m.exec(text)?.[1] ?? '';
      expect(description.length, name).toBeLessThanOrEqual(1536);
      expect(description, name).toMatch(/own .*skill/);
      expect(description, name).toMatch(/use that one instead/);
      expect(description, name).toContain('Needs no setup beyond adding');
      expect(description, name).toContain('in Lantern (command palette, Integrations)');
    }
  });
});

describe('Codex bundle', () => {
  const codexSkillDir = (name: string, at = project) => path.join(at, '.agents', 'skills', name);

  beforeEach(() => {
    project = makeRepo(path.join(tmp, 'codex-project'), '.agents/');
  });

  it('installs the three Lantern skills and the integration skills without copying unsupported agent profiles', async () => {
    const first = await installBundleGuarded({ project, root, home, provider: 'codex' });
    expect(first.skills).toEqual(Object.fromEntries(CODEX_SKILLS.map((name) => [name, 'installed'])));
    expect(first.agents).toBeNull();
    expect(fs.existsSync(path.join(codexSkillDir('lantern-setup'), 'agents'))).toBe(false);
    expect(fs.existsSync(path.join(codexSkillDir('lantern-delegate'), 'agents'))).toBe(false);
    expect(fs.existsSync(path.join(project, '.codex'))).toBe(false);
    expect((await installBundleGuarded({ project, root, home, provider: 'codex' })).agents).toBeNull();
    expect(git(project, 'status', '--short')).toBe('');
  });

  it('does not use ignored Claude paths as authority for Codex writes', async () => {
    const claudeOnly = makeRepo(path.join(tmp, 'claude-only'), '.claude/');
    const result = await installBundleGuarded({ project: claudeOnly, root, home, provider: 'codex' });
    expect(result).toMatchObject({ skipped: null, agents: null });
    const exclude = fs.readFileSync(path.join(claudeOnly, '.git', 'info', 'exclude'), 'utf8').split('\n');
    expect(exclude).toEqual(expect.arrayContaining(['.agents/skills/lantern-setup', '.agents/skills/lantern-sync', '.agents/skills/lantern-delegate']));
    expect(exclude.some((line) => line.startsWith('.claude/'))).toBe(false);
    expect(fs.existsSync(path.join(claudeOnly, '.codex'))).toBe(false);
    expect(git(claudeOnly, 'status', '--short')).toBe('');
  });

  it('needs only the Codex skills directory to be ignored', async () => {
    const skillsOnly = makeRepo(path.join(tmp, 'codex-skills-only'), '.agents/skills/');
    const result = await installBundleGuarded({ project: skillsOnly, root, home, provider: 'codex' });
    expect(Object.values(result.skills)).toEqual(CODEX_SKILLS.map(() => 'installed'));
    expect(result.agents).toBeNull();
    expect(fs.existsSync(path.join(skillsOnly, '.codex'))).toBe(false);
  });

  it('installs directly into a folder outside any git repository', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-codex-plain-'));
    try {
      const result = await installBundleGuarded({ project: plain, root, home, provider: 'codex' });
      expect(result).toMatchObject({ skipped: null, agents: null });
      expect(Object.values(result.skills)).toEqual(CODEX_SKILLS.map(() => 'installed'));
      expect(fs.existsSync(path.join(plain, '.claude'))).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('keeps home and symlinked Codex skill entries', async () => {
    fs.mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
    fs.symlinkSync(path.join(home, 'missing'), path.join(home, '.agents', 'skills', 'lantern-sync'));
    const result = await installBundleGuarded({ project, root, home, provider: 'codex' });
    expect(result.skills['lantern-sync']).toBe('home');
    expect(result.agents).toBeNull();
  });

  it('honors CODEX_HOME skill collisions', async () => {
    const codexHome = path.join(tmp, 'custom-codex-home');
    fs.mkdirSync(path.join(codexHome, 'skills', 'lantern-setup'), { recursive: true });
    const result = await installBundleGuarded({ project, root, home, codexHome, provider: 'codex' });
    expect(result.skills['lantern-setup']).toBe('home');
    expect(fs.existsSync(codexSkillDir('lantern-setup'))).toBe(false);
    expect(fs.existsSync(path.join(codexSkillDir('lantern-sync'), 'references', 'authority.md'))).toBe(true);
    expect(fs.existsSync(path.join(codexSkillDir('lantern-delegate'), 'references', 'authority.md'))).toBe(true);
  });
});

describe('guards', () => {
  const exclude = (at: string) => fs.readFileSync(path.join(at, '.git', 'info', 'exclude'), 'utf8');

  it('excludes the bundle paths in .git/info/exclude and installs when .claude is not ignored', async () => {
    const plain = makeRepo(path.join(tmp, 'plain'), null);
    const result = await run(plain);
    expect(result.skipped).toBeNull();
    expect(result.skills['lantern-delegate']).toBe('installed');
    expect(agentFiles(plain)).toEqual([AGENTS_MARKER, ...AGENT_NAMES.map((n) => `${n}.md`)].sort());
    for (const line of ['.claude/agents/.lantern-bundle-agents', '.claude/agents/lantern-delegate-*.md', '.claude/agents/reviewer.md', '.claude/skills/lantern-sync']) {
      expect(exclude(plain)).toContain(line);
    }
    expect(git(plain, 'status', '--short')).toBe('');
    expect(fs.existsSync(path.join(plain, '.gitignore'))).toBe(false);
  });

  it('never duplicates exclude lines on a second run', async () => {
    const plain = makeRepo(path.join(tmp, 'plain'), null);
    await run(plain);
    const first = exclude(plain);
    fs.rmSync(path.join(plain, '.claude'), { recursive: true });
    await run(plain);
    expect(exclude(plain)).toBe(first);
  });

  it('installs when .claude holds tracked files but the bundle paths are untracked', async () => {
    const tracked = makeRepo(path.join(tmp, 'tracked'), null);
    fs.mkdirSync(path.join(tracked, '.claude'));
    fs.writeFileSync(path.join(tracked, '.claude', 'settings.json'), '{}');
    git(tracked, 'add', '-A');
    git(tracked, 'commit', '-q', '-m', 'track .claude');
    expect((await run(tracked)).skipped).toBeNull();
    expect(fs.existsSync(skillDir('lantern-sync', tracked))).toBe(true);
    expect(git(tracked, 'status', '--short')).toBe('');
  });

  it('installs straight into a directory that is not in a git repo', async () => {
    const plain = path.join(tmp, 'nogit');
    fs.mkdirSync(plain);
    const result = await run(plain);
    expect(result.skipped).toBeNull();
    expect(result.skills).toEqual(Object.fromEntries(ALL_SKILLS.map((n) => [n, 'installed'])));
    expect(agentFiles(plain)).toEqual([AGENTS_MARKER, ...AGENT_NAMES.map((n) => `${n}.md`)].sort());
    expect(fs.readdirSync(plain)).toEqual(['.claude']);
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('keeps the guard for a symlinked path into a git repo', async () => {
    const sub = path.join(makeRepo(path.join(tmp, 'plainrepo'), null), 'sub');
    fs.mkdirSync(sub);
    const link = path.join(tmp, 'link');
    fs.symlinkSync(sub, link);
    expect((await run(link)).skipped).toBe('not-ignored');
    expect(fs.existsSync(path.join(sub, '.claude'))).toBe(false);
  });

  it('keeps the guard when git itself fails inside a repo', async () => {
    const saved = process.env.PATH;
    process.env.PATH = path.join(tmp, 'no-git-here');
    try {
      expect((await run()).skipped).toBe('not-ignored');
    } finally {
      process.env.PATH = saved;
    }
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });

  it('still refuses the home directory when it is not in a git repo', async () => {
    expect((await run(home)).skipped).toBe('home');
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('excludes and installs the agents when only .claude/skills is ignored', async () => {
    const half = makeRepo(path.join(tmp, 'half'), '.claude/skills/');
    const result = await run(half);
    expect(result.skills['lantern-delegate']).toBe('installed');
    expect(result.agents?.status).toBe('installed');
    expect(result.agentsSkipped).toBeUndefined();
    expect(agentFiles(half)).toEqual([AGENTS_MARKER, ...AGENT_NAMES.map((n) => `${n}.md`)].sort());
    expect(git(half, 'status', '--short')).toBe('');
  });

  it('never excludes or reports an agent file of the user that sits at a bundle name', async () => {
    const half = makeRepo(path.join(tmp, 'half-own'), '.claude/skills/');
    fs.mkdirSync(agentsDir(half), { recursive: true });
    fs.writeFileSync(path.join(agentsDir(half), 'reviewer.md'), 'mine');
    fs.writeFileSync(path.join(agentsDir(half), 'lantern-delegate-low.md'), 'mine');
    const result = await run(half);
    expect(result.agentsSkipped).toBeUndefined();
    expect(fs.readFileSync(path.join(agentsDir(half), 'reviewer.md'), 'utf8')).toBe('mine');
    expect(fs.readFileSync(path.join(agentsDir(half), 'lantern-delegate-low.md'), 'utf8')).toBe('mine');
    const exclude = fs.readFileSync(path.join(half, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).not.toContain('.claude/agents/reviewer.md');
    expect(exclude).not.toContain('lantern-delegate-*.md');
    expect(git(half, 'status', '--short', '-uall')).toContain('.claude/agents/reviewer.md');
    expect(git(half, 'status', '--short', '-uall')).toContain('.claude/agents/lantern-delegate-low.md');
    expect(fs.existsSync(path.join(agentsDir(half), 'lantern-delegate-medium.md'))).toBe(true);
  });

  it('writes only the skills and agent files that git ignores one by one', async () => {
    const picky = makeRepo(path.join(tmp, 'picky'), '.claude/skills/*\n!.claude/skills/lantern-sync\n.claude/agents/*\n!.claude/agents/reviewer.md');
    const result = await run(picky);
    expect(result.skills).toEqual({ ...Object.fromEntries(ALL_SKILLS.filter((n) => n !== 'lantern-sync').map((n) => [n, 'installed'])), 'lantern-sync': 'not-ignored' });
    expect(result.agentsSkipped).toEqual(['reviewer.md']);
    expect(fs.existsSync(skillDir('lantern-sync', picky))).toBe(false);
    expect(result.agents?.files).toEqual(AGENT_NAMES.filter((n) => n !== 'reviewer').map((n) => `${n}.md`).sort());
    expect(fs.existsSync(path.join(agentsDir(picky), 'reviewer.md'))).toBe(false);
    expect(git(picky, 'status', '--short')).toBe('');
  });

  it('never writes through a marker that is a symlink', async () => {
    const target = path.join(home, 'precious.txt');
    fs.writeFileSync(target, 'keep');
    fs.mkdirSync(agentsDir(), { recursive: true });
    fs.symlinkSync(target, path.join(agentsDir(), AGENTS_MARKER));
    expect((await run()).agents).toEqual({ status: 'symlink', files: [] });
    expect(fs.readFileSync(target, 'utf8')).toBe('keep');
    expect(fs.readdirSync(agentsDir())).toEqual([AGENTS_MARKER]);
  });

  it('never writes through a .claude symlink to another directory', async () => {
    const elsewhere = path.join(tmp, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(project, '.claude'));
    expect((await run()).skipped).toBe('not-ignored');
    const result = installBundle({ project, root, home });
    expect(Object.values(result.skills)).toEqual(ALL_SKILLS.map(() => 'symlink'));
    expect(result.agents?.status).toBe('symlink');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('never writes through a .claude/agents symlink', async () => {
    const elsewhere = path.join(tmp, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.join(project, '.claude'));
    fs.symlinkSync(elsewhere, agentsDir());
    expect(installBundle({ project, root, home }).agents?.status).toBe('symlink');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('never installs into the home directory itself', async () => {
    makeRepo(home);
    expect((await run(home)).skipped).toBe('home');
    expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
  });

  it('reports a missing project as skipped', () => {
    expect(installBundle({ project: path.join(tmp, 'missing'), root, home }).skipped).toBe('not-a-directory');
  });
});

describe('unmarked entries', () => {
  it('never overwrites a directory without the marker', async () => {
    fs.mkdirSync(skillDir('lantern-sync'), { recursive: true });
    fs.writeFileSync(path.join(skillDir('lantern-sync'), 'SKILL.md'), 'mine');
    const result = await run();
    expect(result.skills['lantern-sync']).toBe('unmarked');
    expect(result.skills['lantern-setup']).toBe('installed');
    expect(fs.readdirSync(skillDir('lantern-sync'))).toEqual(['SKILL.md']);
    expect(fs.readFileSync(path.join(skillDir('lantern-sync'), 'SKILL.md'), 'utf8')).toBe('mine');
  });

  it('never overwrites or follows a symlink, even a dangling one', async () => {
    const real = path.join(tmp, 'real-skill');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, SKILL_MARKER), 'x');
    fs.mkdirSync(path.dirname(skillDir('lantern-setup')), { recursive: true });
    fs.symlinkSync(real, skillDir('lantern-setup'));
    fs.symlinkSync(path.join(tmp, 'nowhere'), skillDir('lantern-sync'));
    const first = await run();
    const second = await run();
    for (const result of [first, second]) {
      expect(result.skills['lantern-setup']).toBe('symlink');
      expect(result.skills['lantern-sync']).toBe('symlink');
    }
    expect(fs.readdirSync(real)).toEqual([SKILL_MARKER]);
    expect(fs.lstatSync(skillDir('lantern-sync')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'nowhere'))).toBe(false);
  });

  it('leaves a skill that exists in the home skills folder alone', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'lantern-delegate'), { recursive: true });
    fs.symlinkSync(path.join(home, 'nowhere'), path.join(home, '.claude', 'skills', 'lantern-sync'));
    const result = await run();
    expect(result.skills).toEqual(Object.fromEntries(ALL_SKILLS.map((n) => [n, ['lantern-sync', 'lantern-delegate'].includes(n) ? 'home' : 'installed'])));
    expect(fs.existsSync(skillDir('lantern-sync'))).toBe(false);
  });
});

describe('refresh', () => {
  it('replaces a marked copy after the bundle changes', async () => {
    await run();
    const stray = path.join(skillDir('lantern-sync'), 'stray.txt');
    fs.writeFileSync(stray, 'edit');
    fs.rmSync(root, { recursive: true });
    makeBundle(root, 'v2');
    const result = await run();
    expect(Object.values(result.skills)).toEqual(ALL_SKILLS.map(() => 'refreshed'));
    expect(fs.readFileSync(path.join(skillDir('lantern-sync'), 'SKILL.md'), 'utf8')).toBe('lantern-sync v2');
    expect(fs.existsSync(stray)).toBe(false);
    expect(fs.readdirSync(path.join(project, '.claude', 'skills')).sort()).toEqual([...ALL_SKILLS].sort());
    expect(git(project, 'status', '--short')).toBe('');
  });

  it('does nothing when the bundle is unchanged, even with local edits inside a copy', async () => {
    await run();
    const edited = path.join(skillDir('lantern-sync'), 'SKILL.md');
    fs.writeFileSync(edited, 'edited');
    const result = await run();
    expect(Object.values(result.skills)).toEqual(ALL_SKILLS.map(() => 'current'));
    expect(result.agents).toEqual({ status: 'current', files: [] });
    expect(fs.readFileSync(edited, 'utf8')).toBe('edited');
  });

  it('keeps a copy pinned once its marker is removed', async () => {
    await run();
    fs.rmSync(path.join(skillDir('lantern-sync'), SKILL_MARKER));
    fs.rmSync(root, { recursive: true });
    makeBundle(root, 'v2');
    const result = await run();
    expect(result.skills['lantern-sync']).toBe('unmarked');
    expect(fs.readFileSync(path.join(skillDir('lantern-sync'), 'SKILL.md'), 'utf8')).toBe('lantern-sync v1');
    expect(result.skills['lantern-setup']).toBe('refreshed');
  });

  it('does not refresh a marked directory that was swapped for a symlink', async () => {
    await run();
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    fs.rmSync(skillDir('lantern-sync'), { recursive: true });
    fs.symlinkSync(real, skillDir('lantern-sync'));
    fs.rmSync(root, { recursive: true });
    makeBundle(root, 'v2');
    expect((await run()).skills['lantern-sync']).toBe('symlink');
    expect(fs.readdirSync(real)).toEqual([]);
  });
});

describe('agent files', () => {
  it('skips names that exist in the project or in home, and writes nothing to home', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'agents', 'reviewer.md'), 'mine in home');
    fs.mkdirSync(agentsDir(), { recursive: true });
    fs.writeFileSync(path.join(agentsDir(), 'lantern-delegate-low.md'), 'mine in project');
    fs.symlinkSync(path.join(tmp, 'nowhere'), path.join(agentsDir(), 'lantern-delegate-high.md'));
    const homeBefore = fs.readdirSync(path.join(home, '.claude', 'agents'));

    const result = await run();
    expect(result.agents?.status).toBe('installed');
    expect(result.agents?.files).toEqual([...COMPLEX_FILES, 'lantern-delegate-medium.md', 'lantern-delegate-xhigh.md', 'reviewer-complex.md', 'reviewer.md']);
    expect(agentFiles()).toEqual([AGENTS_MARKER, ...COMPLEX_FILES, 'lantern-delegate-high.md', 'lantern-delegate-low.md', 'lantern-delegate-medium.md', 'lantern-delegate-xhigh.md', 'reviewer-complex.md', 'reviewer.md']);
    expect(fs.readFileSync(path.join(agentsDir(), 'lantern-delegate-low.md'), 'utf8')).toBe('mine in project');
    expect(fs.lstatSync(path.join(agentsDir(), 'lantern-delegate-high.md')).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(path.join(home, '.claude', 'agents'))).toEqual(homeBefore);
    expect(fs.readFileSync(path.join(home, '.claude', 'agents', 'reviewer.md'), 'utf8')).toBe('mine in home');
    expect(fs.readdirSync(path.join(home, '.claude'))).toEqual(['agents']);
  });

  it('installs reviewer into the project even when home has one, and adds it to an older install', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'agents', 'reviewer.md'), 'mine in home');
    const result = await run();
    expect(result.agents?.files).toContain('reviewer.md');
    expect(fs.readFileSync(path.join(agentsDir(), 'reviewer.md'), 'utf8')).toBe('reviewer v1');
    fs.rmSync(path.join(agentsDir(), 'reviewer.md'));
    expect((await run()).agents?.files).toContain('reviewer.md');
    expect(fs.existsSync(path.join(agentsDir(), 'reviewer.md'))).toBe(true);
    expect(fs.readFileSync(path.join(home, '.claude', 'agents', 'reviewer.md'), 'utf8')).toBe('mine in home');
  });

  it('keeps an unmarked project reviewer.md even when home has one', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'agents', 'reviewer.md'), 'mine in home');
    fs.mkdirSync(agentsDir(), { recursive: true });
    fs.writeFileSync(path.join(agentsDir(), 'reviewer.md'), 'mine in project');
    const result = await run();
    expect(result.agents?.files).not.toContain('reviewer.md');
    expect(fs.readFileSync(path.join(agentsDir(), 'reviewer.md'), 'utf8')).toBe('mine in project');
  });

  it('writes no marker when every name already exists', async () => {
    fs.mkdirSync(agentsDir(), { recursive: true });
    for (const n of AGENT_NAMES) fs.writeFileSync(path.join(agentsDir(), `${n}.md`), 'mine');
    expect((await run()).agents).toEqual({ status: 'kept', files: [] });
    expect(fs.existsSync(path.join(agentsDir(), AGENTS_MARKER))).toBe(false);
  });

  it('refreshes only the files it installed when the bundle changes', async () => {
    fs.mkdirSync(agentsDir(), { recursive: true });
    fs.writeFileSync(path.join(agentsDir(), 'reviewer.md'), 'mine');
    await run();
    fs.rmSync(root, { recursive: true });
    makeBundle(root, 'v2');
    const result = await run();
    expect(result.agents?.status).toBe('refreshed');
    expect(result.agents?.files).not.toContain('reviewer.md');
    expect(fs.readFileSync(path.join(agentsDir(), 'reviewer.md'), 'utf8')).toBe('mine');
    expect(fs.readFileSync(path.join(agentsDir(), 'lantern-delegate-medium.md'), 'utf8')).toBe('lantern-delegate-medium v2');
    expect((await run()).agents).toEqual({ status: 'current', files: [] });
  });

  it('leaves agents alone once their marker is removed', async () => {
    await run();
    fs.rmSync(path.join(agentsDir(), AGENTS_MARKER));
    fs.rmSync(root, { recursive: true });
    makeBundle(root, 'v2');
    expect((await run()).agents?.status).toBe('kept');
    expect(fs.readFileSync(path.join(agentsDir(), 'reviewer.md'), 'utf8')).toBe('reviewer v1');
  });
});

describe('complex delegate agents', () => {
  const exclude = (at: string) => fs.readFileSync(path.join(at, '.git', 'info', 'exclude'), 'utf8').split('\n');

  it('takes the agent types from the lantern-delegate-complex folder, not from lantern-delegate', async () => {
    await run();
    for (const name of COMPLEX_FILES) expect(fs.readFileSync(path.join(agentsDir(), name), 'utf8')).toBe(`${name.replace('.md', '')} v1`);
    expect(fs.readFileSync(path.join(agentsDir(), 'reviewer-complex.md'), 'utf8')).toBe('reviewer-complex v1');
    expect(fs.existsSync(path.join(root, 'lantern-delegate', 'agents', COMPLEX_FILES[0]))).toBe(false);
  });

  it('excludes them with the delegate glob that already covers every lantern-delegate- name, and reviewer-complex by name', async () => {
    const plain = makeRepo(path.join(tmp, 'plain'), null);
    await run(plain);
    const lines = exclude(plain);
    expect(lines).toContain('.claude/agents/lantern-delegate-*.md');
    expect(lines).toContain('.claude/agents/reviewer-complex.md');
    expect(lines.filter((line) => line.includes('lantern-delegate-complex-'))).toEqual([]);
    expect(lines).toContain('.claude/skills/lantern-delegate-complex');
    expect(git(plain, 'status', '--short', '-uall')).toBe('');
  });

  it('falls back to one line per name, not the glob, when the user owns one of the complex names in home', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'agents', 'lantern-delegate-complex-fable-high.md'), 'mine in home');
    const plain = makeRepo(path.join(tmp, 'plain'), null);
    const result = await run(plain);
    const lines = exclude(plain);
    expect(lines).not.toContain('.claude/agents/lantern-delegate-*.md');
    expect(lines).toContain('.claude/agents/lantern-delegate-complex-opus-medium.md');
    expect(lines).toContain('.claude/agents/lantern-delegate-low.md');
    expect(lines).not.toContain('.claude/agents/lantern-delegate-complex-fable-high.md');
    expect(result.agents?.files).not.toContain('lantern-delegate-complex-fable-high.md');
    expect(fs.existsSync(path.join(agentsDir(plain), 'lantern-delegate-complex-fable-high.md'))).toBe(false);
    expect(fs.readFileSync(path.join(home, '.claude', 'agents', 'lantern-delegate-complex-fable-high.md'), 'utf8')).toBe('mine in home');
  });

  it('puts reviewer-complex in the project even when home has one', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'agents', 'reviewer-complex.md'), 'mine in home');
    await run();
    expect(fs.readFileSync(path.join(agentsDir(), 'reviewer-complex.md'), 'utf8')).toBe('reviewer-complex v1');
    expect(fs.readFileSync(path.join(home, '.claude', 'agents', 'reviewer-complex.md'), 'utf8')).toBe('mine in home');
  });

  it('cannot be switched off: the skill stays installed when every switchable skill is off', async () => {
    fs.mkdirSync(path.dirname(extensionsPath(home)), { recursive: true });
    fs.writeFileSync(extensionsPath(home), JSON.stringify({ off: { delegate: ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop'], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] } }));
    const result = await run();
    expect(result.skills['lantern-delegate-complex']).toBe('installed');
    expect(result.skills['lantern-commit']).toBe('off');
    expect(fs.existsSync(path.join(agentsDir(), 'reviewer-complex.md'))).toBe(true);
  });

  it('stays out of the Codex bundle', async () => {
    const codex = makeRepo(path.join(tmp, 'codex'), '.agents/');
    const result = await installBundleGuarded({ project: codex, root, home, provider: 'codex' });
    expect(Object.keys(result.skills).sort()).toEqual([...CODEX_SKILLS].sort());
    expect(result.skills['lantern-delegate-complex']).toBeUndefined();
  });
});

describe('opening a project', () => {
  it('returns before the install has run and never throws', async () => {
    const before = installOnOpen(project, { home, root });
    expect(before).toBeUndefined();
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
    await settled();
    expect(fs.existsSync(path.join(skillDir('lantern-delegate'), SKILL_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(agentsDir(), 'lantern-delegate-medium.md'))).toBe(true);
  });

  it('installs at most once per project per run', async () => {
    expect(await installLanternBundle(project, { home, root })).toMatchObject({ skipped: null });
    fs.rmSync(path.join(project, '.claude'), { recursive: true });
    expect(await installLanternBundle(project, { home, root })).toBeNull();
    installOnOpen(project, { home, root });
    await settled();
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });

  it('resolves to null instead of throwing for a bad project or bundle', async () => {
    expect(await installLanternBundle(path.join(tmp, 'missing'), { home, root })).toMatchObject({ skipped: 'not-a-directory' });
    expect(await installLanternBundle(42 as unknown as string, { home, root })).toBeNull();
    const other = makeRepo(path.join(tmp, 'other'));
    expect(await installLanternBundle(other, { home, root: path.join(tmp, 'no-bundle') })).toMatchObject({ skills: { 'lantern-setup': 'missing-source' } });
  });

  it('lets a session start wait for that project\'s pending install only', async () => {
    const slow = path.join(tmp, 'slow');
    const other = path.join(tmp, 'other-project');
    fs.mkdirSync(slow);
    fs.mkdirSync(other);
    const order: string[] = [];
    const slowRoot = path.join(tmp, 'slow-root');
    makeBundle(slowRoot);
    fs.mkdirSync(path.join(slowRoot, 'extra'));
    installOnOpen(slow, { home, root: slowRoot });
    const untouched = settledFor(other).then(() => order.push('other'));
    const waited = settledFor(slow).then(() => {
      order.push('session');
      return fs.existsSync(path.join(slow, '.claude', 'skills', 'lantern-delegate', SKILL_MARKER));
    });
    order.push('started');
    await untouched;
    expect(order).toEqual(['started', 'other']);
    expect(await waited).toBe(true);
    expect(order).toEqual(['started', 'other', 'session']);
  });

  it('wires the agent run to wait for the install and never blocks on its failure', async () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toMatch(/ipcMain\.handle\('agent:run', fromWorkspace\(async[^\n]*\n\s*await settledFor\(project\);/);
    const broken = path.join(tmp, 'broken');
    fs.mkdirSync(broken);
    installOnOpen(broken, { home, root: path.join(tmp, 'no-bundle') });
    await expect(settledFor(broken)).resolves.toBeDefined();
  });

  it('is triggered from every open path without being awaited, each naming the project assistant', () => {
    const sources = fs
      .readdirSync(path.join(__dirname, '..', 'src', 'main'))
      .filter((name) => name.endsWith('.ts') && name !== 'bundle.ts')
      .map((name) => ({ name, text: fs.readFileSync(path.join(__dirname, '..', 'src', 'main', name), 'utf8') }));
    const calls = sources.flatMap(({ name, text }) => callsOf(text, 'installOnOpen').map((args) => ({ name, args })));
    expect([...new Set(calls.map((call) => call.name))].sort()).toEqual(['main.ts', 'windows.ts']);
    expect(calls.filter((call) => call.name === 'windows.ts')).toHaveLength(1);
    for (const { name, args } of calls) expect(args, `${name}: installOnOpen(${args})`).toMatch(/\{\s*provider:\s*settings\.provider\(/);
    for (const { text } of sources) expect(text).not.toMatch(/await\s+installOnOpen/);
  });

  it('notices an installOnOpen call that leaves the provider out', () => {
    expect(callsOf('installOnOpen(root, { provider: settings.provider(root) }); installOnOpen(root);', 'installOnOpen')).toEqual([
      'root, { provider: settings.provider(root) }',
      'root',
    ]);
  });
});
