import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLE_SKILLS, installBundleGuarded, OBSOLETE_AGENTS, OBSOLETE_SKILLS, SKILL_MARKER, skippedEntries } from '../scripts/lantern-bundle.mjs';
import { AGENT_NAMES, git, makeBundle, makeHome, makeLinker, makeRepo, snapshot } from './support/bundle-fixtures';

const run = promisify(execFile);
const SCRIPT = path.join(__dirname, '..', 'scripts', 'install-skills.mjs');
const SKILL_NAMES = BUNDLE_SKILLS.map((s) => s.name);

let tmp: string;
let project: string;
let skills: string;
let agents: string;
let home: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-skills-'));
  project = makeRepo(path.join(tmp, 'project'));
  skills = path.join(project, '.claude', 'skills');
  agents = path.join(project, '.claude', 'agents');
  home = path.join(tmp, 'home');
  fs.mkdirSync(home);
}, 30_000);

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
}, 30_000);

function install(...args: string[]) {
  return run(process.execPath, [SCRIPT, ...args], { env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex') } });
}

function installFrom(source: string, at: string, homeDir = home) {
  return run(process.execPath, [SCRIPT, at], { env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, CODEX_HOME: path.join(homeDir, '.codex'), INSTALL_SKILLS_SOURCE: source } });
}

describe('install-skills', () => {
  it('installs the Codex bundle into native project directories', async () => {
    project = makeRepo(path.join(tmp, 'codex-project'), '.agents/');
    const { stdout } = await install('--provider', 'codex', project);
    expect(stdout).toMatch(/installed +lantern-setup/);
    expect(fs.existsSync(path.join(project, '.agents', 'skills', 'lantern-sync', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.codex'))).toBe(false);
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
    expect(git(project, 'status', '--short')).toBe('');
  });

  it('installs lantern-setup without example-web, and lantern-sync', async () => {
    const { stdout } = await install(project);
    expect(stdout).toMatch(/installed +lantern-setup/);
    expect(stdout).toMatch(/installed +lantern-sync/);
    expect(fs.existsSync(path.join(skills, 'lantern-setup', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(skills, 'lantern-setup', 'scripts', 'lib.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(skills, 'lantern-setup', 'example-web'))).toBe(false);
    expect(fs.existsSync(path.join(skills, 'lantern-sync', 'scripts', 'sync.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(skills, 'lantern-sync', SKILL_MARKER))).toBe(true);
  });

  it('installs all sixteen bundled skills into a fresh project, lantern-local-loop with its nested files and executable loop.sh', async () => {
    const { stdout } = await install(project);
    const all = ['lantern-setup', 'lantern-sync', 'lantern-delegate', 'lantern-delegate-complex', 'lantern-plan', 'lantern-plan-impact', 'lantern-plan-stages', 'lantern-plan-review', 'lantern-plan-handoff', 'lantern-commit', 'lantern-local-loop', 'lantern-no-comments', 'lantern-code-reviewer', 'lantern-jira', 'lantern-bitbucket', 'lantern-github'];
    expect(SKILL_NAMES).toEqual(all);
    for (const name of all) {
      expect(stdout, name).toMatch(new RegExp(`installed +${name}\\b`));
      expect(fs.existsSync(path.join(skills, name, 'SKILL.md')), name).toBe(true);
      expect(fs.existsSync(path.join(skills, name, SKILL_MARKER)), name).toBe(true);
    }
    const loop = path.join(skills, 'lantern-local-loop');
    expect(fs.readdirSync(path.join(loop, 'references')).length).toBeGreaterThan(0);
    expect(fs.statSync(path.join(loop, 'scripts', 'loop.sh')).mode & 0o111).not.toBe(0);
    expect(git(project, 'status', '--short')).toBe('');
  });

  it('keeps a bundled generic skill that exists in ~/.claude/skills and refreshes the others', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'lantern-code-reviewer'), { recursive: true });
    const source = path.join(tmp, 'source');
    makeBundle(source);
    const { stdout } = await installFrom(source, project);
    expect(stdout).toMatch(/kept +lantern-code-reviewer \(already in ~\/\.claude\/skills\)/);
    expect(fs.existsSync(path.join(skills, 'lantern-code-reviewer'))).toBe(false);
    for (const name of ['lantern-commit', 'lantern-local-loop', 'lantern-no-comments']) expect(fs.existsSync(path.join(skills, name, 'SKILL.md')), name).toBe(true);
    makeBundle(source, 'v2');
    const { stdout: again } = await installFrom(source, project);
    expect(again).toMatch(/refreshed +lantern-local-loop/);
    expect(fs.readFileSync(path.join(skills, 'lantern-no-comments', 'SKILL.md'), 'utf8')).toBe('lantern-no-comments v2');
  });

  it('installs lantern-delegate with its scripts, and its agents into .claude/agents', async () => {
    const { stdout } = await install(project);
    expect(stdout).toMatch(/installed +lantern-delegate\b/);
    const dest = path.join(skills, 'lantern-delegate');
    for (const rel of ['SKILL.md', 'protocol.md', 'scripts/preflight.mjs', 'scripts/pr-create.mjs', 'scripts/host-skill.mjs', 'scripts/preferences.mjs', 'scripts/github/identity.mjs']) {
      expect(fs.existsSync(path.join(dest, rel)), rel).toBe(true);
    }
    for (const rel of ['scripts/bitbucket/pr-create.mjs', 'scripts/github/pr-create.mjs', 'scripts/bitbucket/credentials.mjs', 'scripts/github/credentials.mjs']) {
      expect(fs.existsSync(path.join(dest, rel)), rel).toBe(false);
    }
    expect(fs.existsSync(path.join(dest, 'agents'))).toBe(false);
    expect(stdout).toMatch(/installed +lantern-delegate agents/);
    expect(stdout).toMatch(/retry of the dispatch/);
    for (const name of ['lantern-delegate-low', 'lantern-delegate-medium', 'lantern-delegate-high', 'lantern-delegate-xhigh', 'reviewer']) {
      expect(fs.existsSync(path.join(agents, `${name}.md`)), name).toBe(true);
    }
    expect(fs.existsSync(path.join(agents, '.lantern-bundle-agents'))).toBe(true);
    expect(git(project, 'status', '--short')).toBe('');
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('lists lantern-delegate-complex, its three Opus and three Fable agent types and reviewer-complex, from the real bundle', async () => {
    const real = path.join(tmp, 'real-project');
    makeRepo(real);
    const { stdout } = await install(real);
    expect(stdout).toMatch(/installed +lantern-delegate-complex\b/);
    const listed = /lantern-delegate agents \(([^)]*)\)/.exec(stdout)?.[1].split(', ') ?? [];
    const typeFiles = ['opus', 'fable'].flatMap((model) => ['medium', 'high', 'xhigh'].map((level) => ({ model, level, file: `lantern-delegate-complex-${model}-${level}.md` })));
    expect(typeFiles).toHaveLength(6);
    expect(listed).toEqual(expect.arrayContaining([...typeFiles.map(({ file }) => file), 'reviewer-complex.md', 'lantern-mapper.md']));
    for (const { model, level, file } of typeFiles) {
      const text = fs.readFileSync(path.join(real, '.claude', 'agents', file), 'utf8');
      expect(text, file).toMatch(new RegExp(`^model: ${model}$`, 'm'));
      expect(text, file).toMatch(new RegExp(`^effort: ${level}$`, 'm'));
      expect(text, file).toMatch(/^isolation: worktree$/m);
    }
    expect(fs.readFileSync(path.join(real, '.claude', 'agents', 'reviewer-complex.md'), 'utf8')).toMatch(/^model: fable$/m);
    expect(fs.existsSync(path.join(real, '.claude', 'skills', 'lantern-delegate-complex', 'agents'))).toBe(false);
    expect(fs.existsSync(path.join(real, '.claude', 'skills', 'lantern-delegate-complex', 'protocol.md'))).toBe(false);
    expect(git(real, 'status', '--short')).toBe('');
  });

  it('does not install lantern-delegate-complex or its agents for Codex', async () => {
    const codex = makeRepo(path.join(tmp, 'codex-only'), '.agents/');
    const { stdout } = await install('--provider', 'codex', codex);
    expect(stdout).not.toMatch(/lantern-delegate-complex/);
    expect(fs.existsSync(path.join(codex, '.agents', 'skills', 'lantern-delegate-complex'))).toBe(false);
  });

  describe('old bundled folders', () => {
    function oldCopy(name: string, marked: boolean) {
      const dir = path.join(skills, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `old ${name}`);
      if (marked) fs.writeFileSync(path.join(dir, SKILL_MARKER), 'old\n');
      return dir;
    }

    it('removes marked copies of the old names and says so', async () => {
      for (const name of OBSOLETE_SKILLS) oldCopy(name, true);
      const { stdout } = await install(project);
      for (const name of OBSOLETE_SKILLS) {
        expect(stdout).toMatch(new RegExp(`removed +${name} \\(old bundled copy\\)`));
        expect(fs.existsSync(path.join(skills, name))).toBe(false);
      }
      expect(fs.readdirSync(skills).filter((n) => !SKILL_NAMES.includes(n))).toEqual([]);
    });

    it('removes a marked code-reviewer folder and installs lantern-code-reviewer', async () => {
      oldCopy('code-reviewer', true);
      const { stdout } = await install(project);
      expect(OBSOLETE_SKILLS).toContain('code-reviewer');
      expect(stdout).toMatch(/removed +code-reviewer/);
      expect(fs.existsSync(path.join(skills, 'code-reviewer'))).toBe(false);
      expect(fs.existsSync(path.join(skills, 'lantern-code-reviewer', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(skills, 'lantern-code-reviewer', SKILL_MARKER))).toBe(true);
    });

    it('keeps a code-reviewer folder without the marker and a code-reviewer symlink', async () => {
      const mine = oldCopy('code-reviewer', false);
      await install(project);
      expect(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8')).toBe('old code-reviewer');
      fs.rmSync(mine, { recursive: true });
      const real = path.join(tmp, 'elsewhere-reviewer');
      fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, SKILL_MARKER), 'x\n');
      const link = path.join(skills, 'code-reviewer');
      fs.symlinkSync(real, link);
      const { stdout } = await install(project);
      expect(stdout).not.toMatch(/removed/);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(real, SKILL_MARKER))).toBe(true);
    });

    it('keeps an old-named folder without the marker', async () => {
      const mine = oldCopy('commit', false);
      const { stdout } = await install(project);
      expect(stdout).not.toMatch(/removed/);
      expect(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8')).toBe('old commit');
    });

    it('keeps an old-named symlink and what it points at', async () => {
      const real = path.join(tmp, 'elsewhere');
      fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, SKILL_MARKER), 'x\n');
      fs.mkdirSync(skills, { recursive: true });
      const link = path.join(skills, 'no-comments');
      fs.symlinkSync(real, link);
      const { stdout } = await install(project);
      expect(stdout).not.toMatch(/removed/);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(real, SKILL_MARKER))).toBe(true);
    });

    it('prints nothing about them when there are none, and a second run is a no-op', async () => {
      const first = await install(project);
      expect(first.stdout).not.toMatch(/removed/);
      oldCopy('local-loop', true);
      const second = await install(project);
      expect(second.stdout).toMatch(/removed +local-loop/);
      const third = await install(project);
      expect(third.stdout).not.toMatch(/removed/);
      expect(fs.existsSync(path.join(skills, 'local-loop'))).toBe(false);
    });

    it('the app path removes them too', async () => {
      oldCopy('commit', true);
      const result = await installBundleGuarded({ project, root: path.join(__dirname, '..', 'skills'), home });
      expect(result.obsolete).toEqual(['commit']);
      expect(fs.existsSync(path.join(skills, 'commit'))).toBe(false);
    });
  });

  describe('the obsolete delegate skill and agent types', () => {
    const OBSOLETE_DELEGATE = OBSOLETE_SKILLS.find((name) => name.startsWith('delegate')) as string;
    const CURRENT_AGENT_FILES = [...AGENT_NAMES, 'lantern-mapper'].map((name) => `${name}.md`).concat('.lantern-bundle-agents').sort();
    const markerText = () => fs.readFileSync(path.join(agents, '.lantern-bundle-agents'), 'utf8');

    function seedObsolete(markedAgents: boolean) {
      fs.mkdirSync(path.join(skills, OBSOLETE_DELEGATE, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(skills, OBSOLETE_DELEGATE, 'SKILL.md'), OBSOLETE_DELEGATE);
      fs.writeFileSync(path.join(skills, OBSOLETE_DELEGATE, SKILL_MARKER), 'x\n');
      fs.mkdirSync(agents, { recursive: true });
      for (const file of OBSOLETE_AGENTS) fs.writeFileSync(path.join(agents, file), file);
      if (markedAgents) fs.writeFileSync(path.join(agents, '.lantern-bundle-agents'), `hash\n${[...OBSOLETE_AGENTS, 'reviewer.md'].join('\n')}\n`);
    }

    it('lists the obsolete skill and four agent files that no current agent type uses', () => {
      expect(OBSOLETE_DELEGATE).toBeTruthy();
      expect(OBSOLETE_AGENTS).toHaveLength(4);
      for (const file of OBSOLETE_AGENTS) expect(CURRENT_AGENT_FILES).not.toContain(file);
    });

    it('ends with only the current skill folders and agent types', async () => {
      seedObsolete(true);
      const { stdout } = await install(project);
      expect(stdout).toMatch(new RegExp(`removed +${OBSOLETE_DELEGATE}\\b`));
      expect(fs.readdirSync(skills).sort()).toEqual([...SKILL_NAMES].sort());
      expect(fs.readdirSync(agents).sort()).toEqual(CURRENT_AGENT_FILES);
      for (const file of OBSOLETE_AGENTS) expect(markerText()).not.toContain(file);
      expect(git(project, 'status', '--short')).toBe('');
    });

    it('the app path ends the same way and a second run changes nothing', async () => {
      seedObsolete(true);
      const root = path.join(__dirname, '..', 'skills');
      const result = await installBundleGuarded({ project, root, home });
      expect(result.obsolete).toEqual([OBSOLETE_DELEGATE]);
      expect(fs.readdirSync(agents).sort()).toEqual(CURRENT_AGENT_FILES);
      const tree = snapshot(path.join(project, '.claude'));
      const again = await installBundleGuarded({ project, root, home });
      expect(again.obsolete).toEqual([]);
      expect(snapshot(path.join(project, '.claude'))).toEqual(tree);
    });

    it('removes the marked skill folder from the Codex skill root too', async () => {
      project = makeRepo(path.join(tmp, 'codex-project'), '.agents/');
      const codexSkills = path.join(project, '.agents', 'skills');
      fs.mkdirSync(path.join(codexSkills, OBSOLETE_DELEGATE), { recursive: true });
      fs.writeFileSync(path.join(codexSkills, OBSOLETE_DELEGATE, SKILL_MARKER), 'x\n');
      const { stdout } = await install('--provider', 'codex', project);
      expect(stdout).toMatch(new RegExp(`removed +${OBSOLETE_DELEGATE}\\b`));
      expect(fs.existsSync(path.join(codexSkills, OBSOLETE_DELEGATE))).toBe(false);
      expect(fs.existsSync(path.join(codexSkills, 'lantern-delegate', 'SKILL.md'))).toBe(true);
    });

    it('keeps agent files the marker does not list and a skill folder without the marker', async () => {
      seedObsolete(false);
      fs.rmSync(path.join(skills, OBSOLETE_DELEGATE, SKILL_MARKER));
      const { stdout } = await install(project);
      expect(stdout).not.toMatch(/removed/);
      expect(fs.existsSync(path.join(skills, OBSOLETE_DELEGATE, 'SKILL.md'))).toBe(true);
      for (const file of OBSOLETE_AGENTS) expect(fs.readFileSync(path.join(agents, file), 'utf8')).toBe(file);
    });
  });

  describe('a project that holds an older install', () => {
    const NEW_NAMES = ['lantern-commit', 'lantern-local-loop', 'lantern-no-comments', 'lantern-delegate-complex'];
    let source: string;
    let older: string;

    const excludeFile = () => path.join(older, '.git', 'info', 'exclude');
    const excludeLines = () => fs.readFileSync(excludeFile(), 'utf8').split('\n').filter(Boolean);

    beforeEach(() => {
      source = path.join(tmp, 'source');
      makeBundle(source);
      older = makeRepo(path.join(tmp, 'older'), null);
      const previous = SKILL_NAMES.filter((name) => !NEW_NAMES.includes(name)).map((name) => `.claude/skills/${name}`);
      fs.appendFileSync(excludeFile(), `${['.claude/agents/.lantern-bundle-agents', '.claude/agents/lantern-delegate-*.md', '.claude/agents/reviewer.md', ...previous, '.claude/skills/commit', '.claude/skills/no-comments', '.claude/skills/local-loop'].join('\n')}\n`);
    });

    it('installs the skills added to the bundle later and adds their exclude lines', async () => {
      const { stdout } = await installFrom(source, older);
      for (const name of NEW_NAMES) {
        expect(stdout, name).toMatch(new RegExp(`installed +${name}\\b`));
        expect(fs.existsSync(path.join(older, '.claude', 'skills', name, SKILL_MARKER)), name).toBe(true);
        expect(excludeLines()).toContain(`.claude/skills/${name}`);
      }
      expect(stdout).not.toMatch(/skipped/);
      expect(git(older, 'status', '--short')).toBe('');
      expect(fs.existsSync(path.join(older, '.gitignore'))).toBe(false);
    });

    it('adds only paths the installer ships to the exclude file', async () => {
      const before = excludeLines();
      await installFrom(source, older);
      const added = excludeLines().filter((line) => !before.includes(line));
      expect(added.sort()).toEqual([...NEW_NAMES.map((name) => `.claude/skills/${name}`), '.claude/agents/reviewer-complex.md'].sort());
    });

    it('covers the complex delegate agents with the delegate glob the older install already holds', async () => {
      await installFrom(source, older);
      expect(excludeLines().filter((line) => line.includes('lantern-delegate-complex-'))).toEqual([]);
      for (const model of ['opus', 'fable']) {
        for (const level of ['medium', 'high', 'xhigh']) expect(fs.existsSync(path.join(older, '.claude', 'agents', `lantern-delegate-complex-${model}-${level}.md`)), `${model} ${level}`).toBe(true);
      }
      expect(git(older, 'status', '--short')).toBe('');
    });

    it('reports a name git still does not ignore, with the reason, and installs the rest', async () => {
      const negated = makeRepo(path.join(tmp, 'negated'), '.claude/skills/*\n!.claude/skills/lantern-commit');
      const { stdout } = await installFrom(source, negated);
      expect(stdout).toMatch(/skipped +lantern-commit \(git does not ignore \.claude\/skills\/lantern-commit/);
      expect(fs.existsSync(path.join(negated, '.claude', 'skills', 'lantern-commit'))).toBe(false);
      expect(stdout).toMatch(/installed +lantern-no-comments\b/);
      expect(git(negated, 'status', '--short')).toBe('');
    });

    it('reports a name that is not in the bundle', async () => {
      fs.rmSync(path.join(source, 'lantern-commit'), { recursive: true });
      const { stdout } = await installFrom(source, older);
      expect(stdout).toMatch(/missing +lantern-commit \(not in the bundle\)/);
      expect(excludeLines()).not.toContain('.claude/skills/lantern-commit');
      expect(stdout).toMatch(/installed +lantern-local-loop\b/);
    });

    it('leaves the user symlink and the unmarked folder of a bundle name untouched and unexcluded', async () => {
      const real = path.join(tmp, 'elsewhere');
      fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, 'SKILL.md'), 'linked');
      const mine = path.join(older, '.claude', 'skills', 'lantern-local-loop');
      fs.mkdirSync(mine, { recursive: true });
      fs.writeFileSync(path.join(mine, 'SKILL.md'), 'mine');
      const link = path.join(older, '.claude', 'skills', 'lantern-commit');
      fs.symlinkSync(real, link);
      const { stdout } = await installFrom(source, older);
      expect(stdout).toMatch(/kept +lantern-commit \(symlink\)/);
      expect(stdout).toMatch(/kept +lantern-local-loop \(no \.lantern-bundle marker/);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readdirSync(real)).toEqual(['SKILL.md']);
      expect(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8')).toBe('mine');
      expect(fs.existsSync(path.join(mine, SKILL_MARKER))).toBe(false);
      expect(excludeLines()).not.toContain('.claude/skills/lantern-commit');
      expect(excludeLines()).not.toContain('.claude/skills/lantern-local-loop');
      expect(excludeLines()).toContain('.claude/skills/lantern-no-comments');
      expect(stdout).toMatch(/installed +lantern-no-comments\b/);
    });

    it('a second run installs nothing, skips nothing and leaves the exclude file as it was', async () => {
      await installFrom(source, older);
      const after = fs.readFileSync(excludeFile(), 'utf8');
      const tree = snapshot(path.join(older, '.claude'));
      const { stdout } = await installFrom(source, older);
      expect(stdout).not.toMatch(/^(installed|refreshed|skipped|missing)/m);
      expect(stdout).toMatch(/current +lantern-commit/);
      expect(fs.readFileSync(excludeFile(), 'utf8')).toBe(after);
      expect(snapshot(path.join(older, '.claude'))).toEqual(tree);
    }, 30_000);

    it('the app path installs the new names and carries what it leaves out in its result', async () => {
      const result = await installBundleGuarded({ project: older, root: source, home });
      for (const name of NEW_NAMES) expect(result.skills[name], name).toBe('installed');
      expect(result.agentsSkipped).toBeUndefined();
      expect(skippedEntries(result)).toEqual([]);

      const negated = makeRepo(path.join(tmp, 'negated'), '.claude/skills/*\n!.claude/skills/lantern-commit\n.claude/agents/*\n!.claude/agents/reviewer.md');
      const left = await installBundleGuarded({ project: negated, root: source, home });
      expect(left.skills['lantern-commit']).toBe('not-ignored');
      expect(left.agentsSkipped).toEqual(['reviewer.md']);
      expect(skippedEntries(left).map(({ name }) => name)).toEqual(['lantern-commit', 'reviewer.md']);
      for (const { reason } of skippedEntries(left)) expect(reason).toMatch(/^git does not ignore /);
    });
  });

  it('ignores a literal -- separator from pnpm', async () => {
    await install('--', project);
    expect(fs.existsSync(path.join(skills, 'lantern-sync', 'SKILL.md'))).toBe(true);
  });

  it('a second run changes nothing', async () => {
    await install(project);
    const { stdout } = await install(project);
    expect(stdout).toMatch(/current +lantern-sync/);
    expect(stdout).toMatch(/current +lantern-delegate agents/);
  }, 30_000);

  it('keeps an existing unmarked directory', async () => {
    const mine = path.join(skills, 'lantern-sync');
    fs.mkdirSync(mine, { recursive: true });
    fs.writeFileSync(path.join(mine, 'SKILL.md'), 'mine');
    const { stdout } = await install(project);
    expect(stdout).toMatch(/kept +lantern-sync/);
    expect(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8')).toBe('mine');
    expect(fs.existsSync(path.join(skills, 'lantern-setup', 'SKILL.md'))).toBe(true);
  });

  it('keeps an existing symlink', async () => {
    const real = path.join(tmp, 'elsewhere');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'SKILL.md'), 'linked');
    fs.mkdirSync(skills, { recursive: true });
    const link = path.join(skills, 'lantern-setup');
    fs.symlinkSync(real, link);

    const { stdout } = await install(project);
    expect(stdout).toMatch(/kept +lantern-setup \(symlink\)/);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(real)).toEqual(['SKILL.md']);
  });

  it('refreshes a marked copy after the bundle changes', async () => {
    const source = path.join(tmp, 'source');
    makeBundle(source);
    await installFrom(source, project);
    const installed = path.join(skills, 'lantern-sync', 'SKILL.md');
    fs.writeFileSync(installed, 'edited');
    const { stdout: same } = await installFrom(source, project);
    expect(same).toMatch(/current +lantern-sync/);
    expect(fs.readFileSync(installed, 'utf8')).toBe('edited');

    makeBundle(source, 'v2');
    const { stdout } = await installFrom(source, project);
    expect(stdout).toMatch(/refreshed +lantern-sync/);
    expect(fs.readFileSync(installed, 'utf8')).toBe('lantern-sync v2');
    expect(fs.readFileSync(path.join(agents, 'reviewer.md'), 'utf8')).toBe('reviewer v2');
  });

  it('excludes the bundle paths locally in a repo that does not ignore .claude, and installs into a non-git directory directly', async () => {
    const plain = makeRepo(path.join(tmp, 'plain'), null);
    const { stdout } = await install(plain);
    expect(stdout).toMatch(/installed +lantern-delegate agents/);
    expect(fs.readFileSync(path.join(plain, '.git', 'info', 'exclude'), 'utf8')).toContain('.claude/agents/lantern-delegate-*.md');
    expect(git(plain, 'status', '--short')).toBe('');
    const nogit = path.join(tmp, 'nogit');
    fs.mkdirSync(nogit, { recursive: true });
    expect((await install(nogit)).stdout).toMatch(/installed +lantern-delegate agents/);
    expect(fs.existsSync(path.join(nogit, '.claude', 'skills', 'lantern-delegate', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(nogit, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(nogit, '.gitignore'))).toBe(false);
  });

  it('rejects a target that is not a directory', async () => {
    const file = path.join(tmp, 'file.txt');
    fs.writeFileSync(file, 'x');
    await expect(install(file)).rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/is not a directory/) });
    await expect(install(path.join(tmp, 'missing'))).rejects.toMatchObject({ code: 1 });
    expect(fs.existsSync(path.join(tmp, 'missing'))).toBe(false);
  });

  it('rejects a missing project argument and the retired --force', async () => {
    await expect(install()).rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/project directory missing/) });
    await expect(install(project, '--force')).rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/unknown argument --force/) });
  });

  it('keeps a skill that exists in ~/.claude/skills, even a dangling symlink', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'lantern-setup'), { recursive: true });
    fs.symlinkSync(path.join(home, 'nowhere'), path.join(home, '.claude', 'skills', 'lantern-sync'));
    const { stdout } = await install(project);
    expect(stdout).toMatch(/kept +lantern-setup \(already in ~\/\.claude\/skills\)/);
    expect(stdout).toMatch(/kept +lantern-sync/);
    expect(fs.existsSync(path.join(skills, 'lantern-setup'))).toBe(false);
    expect(fs.existsSync(path.join(skills, 'lantern-sync'))).toBe(false);
  });

  it('skips agent names that exist in the project, but installs reviewer even when ~/.claude/agents has one', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'agents', 'reviewer.md'), 'mine');
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, 'lantern-delegate-low.md'), 'mine');
    await install(project);
    expect(fs.readFileSync(path.join(agents, 'lantern-delegate-low.md'), 'utf8')).toBe('mine');
    expect(fs.existsSync(path.join(agents, 'reviewer.md'))).toBe(true);
    expect(fs.readFileSync(path.join(home, '.claude', 'agents', 'reviewer.md'), 'utf8')).toBe('mine');
    expect(fs.existsSync(path.join(agents, 'lantern-delegate-medium.md'))).toBe(true);
    expect(fs.readdirSync(path.join(home, '.claude', 'agents'))).toEqual(['reviewer.md']);
  });

  it('installs the same as the app for every project/home combination', async () => {
    const source = path.join(tmp, 'source');
    makeBundle(source);
    const places = ['none', 'project', 'home'] as const;
    const template = makeRepo(path.join(tmp, 'template'));
    const repoFromTemplate = (to: string) => {
      fs.cpSync(template, to, { recursive: true });
      return to;
    };
    let n = 0;
    for (const setupAt of places) {
      for (const syncAt of places) {
        for (const agentAt of places) {
          const at: Record<string, string> = { 'lantern-setup': setupAt, 'lantern-sync': syncAt };
          const dirs = { script: repoFromTemplate(path.join(tmp, `s${n}`)), app: repoFromTemplate(path.join(tmp, `a${n}`)), home: path.join(tmp, `h${n}`) };
          n++;
          fs.mkdirSync(dirs.home);
          for (const name of Object.keys(at)) {
            if (at[name] === 'project') for (const d of [dirs.script, dirs.app]) fs.mkdirSync(path.join(d, '.claude', 'skills', name), { recursive: true });
            if (at[name] === 'home') {
              fs.mkdirSync(path.join(dirs.home, '.claude', 'skills'), { recursive: true });
              fs.symlinkSync(path.join(tmp, 'nowhere'), path.join(dirs.home, '.claude', 'skills', name));
            }
          }
          for (const d of agentAt === 'project' ? [dirs.script, dirs.app] : []) {
            fs.mkdirSync(path.join(d, '.claude', 'agents'), { recursive: true });
            fs.writeFileSync(path.join(d, '.claude', 'agents', 'reviewer.md'), 'mine');
          }
          if (agentAt === 'home') {
            fs.mkdirSync(path.join(dirs.home, '.claude', 'agents'), { recursive: true });
            fs.writeFileSync(path.join(dirs.home, '.claude', 'agents', 'reviewer.md'), 'mine');
          }
          await installFrom(source, dirs.script, dirs.home);
          await installBundleGuarded({ project: dirs.app, root: source, home: dirs.home });
          const tree = (d: string) => {
            const out: string[] = [];
            const walk = (rel: string) => {
              for (const e of fs.readdirSync(path.join(d, rel), { withFileTypes: true })) {
                const r = path.join(rel, e.name);
                if (e.isDirectory()) walk(r);
                else out.push(`${r}:${fs.readFileSync(path.join(d, r), 'utf8')}`);
              }
            };
            if (fs.existsSync(path.join(d, '.claude'))) walk('.claude');
            return out.sort();
          };
          expect(tree(dirs.script)).toEqual(tree(dirs.app));
          for (const name of SKILL_NAMES) {
            const installed = !!fs.lstatSync(path.join(dirs.app, '.claude', 'skills', name), { throwIfNoEntry: false });
            expect(installed).toBe(at[name] === 'home' ? false : true);
          }
        }
      }
    }
  }, 120_000);

  it('rewrites the delegate permissions for a different HOME and a different skill linker, and leaves a settled file alone', async () => {
    const settings = path.join(project, '.claude', 'settings.local.json');
    const rules = () => JSON.parse(fs.readFileSync(settings, 'utf8')).permissions.allow as string[];
    const homeA = makeHome(path.join(tmp, 'home-a'), makeLinker(path.join(tmp, 'linker-x')));
    const linkerY = makeLinker(path.join(tmp, 'linker-y'));
    const homeB = makeHome(path.join(tmp, 'home-b'), linkerY);
    const at = (homeDir: string) => run(process.execPath, [SCRIPT, project], { env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, CODEX_HOME: path.join(homeDir, '.codex'), SKILL_LINKER: '' } });
    await at(homeA);
    expect(rules()).toContain(`Bash(node ${path.join(homeA, '.claude', 'skills')}/*)`);
    const { stdout } = await at(homeB);
    expect(stdout).toMatch(/written +delegate permissions/);
    expect(rules()).toContain(`Bash(node ${path.join(homeB, '.claude', 'skills')}/*)`);
    expect(rules()).toContain(`Bash(node ${path.join(homeA, '.claude', 'skills')}/*)`);
    expect(rules()).toContain(`Bash(${linkerY} --list)`);
    const bytes = fs.readFileSync(settings, 'utf8');
    const mtime = fs.statSync(settings).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await at(homeB)).stdout).toMatch(/current +delegate permissions/);
    expect(fs.readFileSync(settings, 'utf8')).toBe(bytes);
    expect(fs.statSync(settings).mtimeMs).toBe(mtime);
  }, 60_000);
});
