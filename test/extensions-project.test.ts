import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

import { loadExtensionsPanel, moveExtension, projectExtensionsPath as projectFileInApp, projectRootFor, readProjectExtensions as readProjectInApp, saveExtensionsSlot, writeProjectExtensions as writeProjectInApp } from '../src/main/extensions';
import { guardProjectFile } from '../src/main/extensions-ignore';
import { createExtensionSkill } from '../src/main/extensions';
import { EXTENSION_SCOPE, EXTENSION_SCOPES, mergeExtras as mergeInApp } from '../src/shared/extension-slots';
import { msg } from '../src/shared/lang/messages';
// @ts-expect-error plain ES module, no declarations
import { configuredExtras, resolvedExtras } from '../skills/lantern-delegate/scripts/extension-skills.mjs';
// @ts-expect-error plain ES module, no declarations
import * as script from '../skills/lantern-delegate/scripts/extensions.mjs';
import { git, makeRepo } from './support/bundle-fixtures';

let tmp: string;
let home: string;
let project: string;

const projectFile = (root = project) => path.join(root, '.claude', 'lantern-extensions.json');
const globalFile = () => path.join(home, '.claude', 'lantern-extensions.json');
const put = (file: string, data: object | string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
};
const none = { delegate: [], orchestrator: [], reviewer: [] };

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ext-project-')));
  home = path.join(tmp, 'home');
  project = path.join(tmp, 'northwind');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the merge rule', () => {
  it.each([
    ['script', script.mergeExtras],
    ['app', mergeInApp],
  ])('%s: global first, then the project, each name once', (_name, merge) => {
    expect(merge(['a', 'b'], ['c', 'a', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    expect(merge([], ['x'])).toEqual(['x']);
    expect(merge(['x'], [])).toEqual(['x']);
    expect(merge([], [])).toEqual([]);
  });

  it('keeps the two scope lists apart and the roles apart in the effective slots', () => {
    put(globalFile(), { delegate: ['g1', 'shared'], reviewer: ['g2'] });
    put(projectFile(), { delegate: ['shared', 'p1'], orchestrator: ['p2'] });
    const config = configuredExtras(home, project);
    expect(config.slots).toEqual({ delegate: ['g1', 'shared', 'p1'], orchestrator: ['p2'], reviewer: ['g2'] });
    expect(config.scopes.global).toEqual({ delegate: ['g1', 'shared'], orchestrator: [], reviewer: ['g2'] });
    expect(config.scopes.project).toEqual({ delegate: ['shared', 'p1'], orchestrator: ['p2'], reviewer: [] });
    expect(config.warnings).toEqual([]);
  });

  it('is the global list alone when there is no project, and when the project has no file', () => {
    put(globalFile(), { delegate: ['g1'] });
    expect(configuredExtras(home).slots).toEqual({ delegate: ['g1'], orchestrator: [], reviewer: [] });
    expect(configuredExtras(home, null).slots.delegate).toEqual(['g1']);
    expect(configuredExtras(home, project).slots.delegate).toEqual(['g1']);
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });

  it('gives a project extra to that project and to no other', () => {
    const other = path.join(tmp, 'other');
    fs.mkdirSync(other);
    put(globalFile(), { delegate: ['g1'] });
    put(projectFile(), { delegate: ['only-here'] });
    expect(configuredExtras(home, project).slots.delegate).toEqual(['g1', 'only-here']);
    expect(configuredExtras(home, other).slots.delegate).toEqual(['g1']);
    expect(resolvedExtras('delegate', configuredExtras(home, other).slots.delegate, [path.join(other, '.claude', 'skills')]).warnings).toHaveLength(1);
    expect(resolvedExtras('delegate', configuredExtras(home, other).slots.delegate, [path.join(other, '.claude', 'skills')]).warnings[0]).not.toContain('only-here');
  });

  it('warns about a project extra that is not installed, with the effective list of that project only', () => {
    put(projectFile(), { reviewer: ['absent'] });
    const effective = configuredExtras(home, project).slots.reviewer;
    expect(resolvedExtras('reviewer', effective, [path.join(project, '.claude', 'skills')])).toEqual({ present: [], warnings: [expect.stringContaining('"absent"')] });
  });

  it('keeps the off list and the skill linker in the global file only', () => {
    put(globalFile(), { off: { delegate: ['lantern-commit'] } });
    put(projectFile(), { off: { delegate: ['lantern-no-comments'] }, skillLinker: '/elsewhere', delegate: ['p1'] });
    const config = configuredExtras(home, project);
    expect(config.off.delegate).toEqual(['lantern-commit']);
    expect(config.slots.delegate).toEqual(['p1']);
    expect(script.readProjectExtensions(project)).toEqual({ delegate: ['p1'], orchestrator: [], reviewer: [] });
  });

  it('ignores a project that is the home folder, so the global file is not read twice', () => {
    put(globalFile(), { delegate: ['g1'] });
    expect(configuredExtras(home, home).slots.delegate).toEqual(['g1']);
    expect(projectRootFor(home, home)).toBeNull();
    expect(projectRootFor(project, home)).toBe(project);
    expect(projectRootFor('', home)).toBeNull();
    expect(projectRootFor(null, home)).toBeNull();
  });
});

describe('the project file', () => {
  it('lives in .claude of the project, beside the global file name', () => {
    expect(script.projectExtensionsPath(project)).toBe(projectFile());
    expect(projectFileInApp(project)).toBe(projectFile());
    expect(script.EXTENSION_SCOPES).toEqual(EXTENSION_SCOPES);
    expect(EXTENSION_SCOPES).toEqual(['global', 'project']);
    expect(script.EXTENSION_SCOPE).toEqual(EXTENSION_SCOPE);
  });

  describe.each([
    ['script', script.readProjectExtensions, script.setProjectExtensions],
    ['app', (root: string) => readProjectInApp(root).slots, writeProjectInApp],
  ])('%s reader and writer', (_name, read, write) => {
    it('reads a missing file as empty slots without creating anything', () => {
      expect(read(project)).toEqual(none);
      expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
    });

    it('writes a slot, creates the folder, keeps the other slots, and leaves no temporary file', () => {
      put(projectFile(), { orchestrator: ['mine'] });
      write('delegate', ['typescript'], project);
      expect(JSON.parse(fs.readFileSync(projectFile(), 'utf8'))).toEqual({ orchestrator: ['mine'], delegate: ['typescript'] });
      expect(fs.readdirSync(path.join(project, '.claude'))).toEqual(['lantern-extensions.json']);
      expect(read(project)).toEqual({ delegate: ['typescript'], orchestrator: ['mine'], reviewer: [] });
    });

    it('creates the .claude folder on the first write and writes nothing outside it', () => {
      write('reviewer', ['biome'], project);
      expect(fs.readdirSync(project)).toEqual(['.claude']);
      expect(fs.readdirSync(path.join(project, '.claude'))).toEqual(['lantern-extensions.json']);
      expect(fs.existsSync(globalFile())).toBe(false);
    });

    it('refuses a locked skill and writes nothing', () => {
      expect(() => write('delegate', ['lantern-code-reviewer'], project)).toThrow();
      expect(fs.existsSync(projectFile())).toBe(false);
    });

    it('refuses a damaged file by name and leaves it untouched', () => {
      put(projectFile(), '{not json');
      expect(() => read(project)).toThrow(projectFile());
      expect(() => write('delegate', ['typescript'], project)).toThrow(projectFile());
      expect(fs.readFileSync(projectFile(), 'utf8')).toBe('{not json');
    });

    it('refuses to write through a symbolic link, into a file that is not a file, or into a folder that is not there', () => {
      const elsewhere = path.join(tmp, 'elsewhere');
      fs.mkdirSync(elsewhere);
      fs.symlinkSync(elsewhere, path.join(project, '.claude'));
      expect(() => write('delegate', ['a'], project)).toThrow();
      expect(fs.readdirSync(elsewhere)).toEqual([]);
      fs.rmSync(path.join(project, '.claude'));
      fs.mkdirSync(path.join(project, '.claude'));
      fs.symlinkSync(path.join(elsewhere, 'target.json'), projectFile());
      expect(() => write('delegate', ['a'], project)).toThrow();
      expect(fs.existsSync(path.join(elsewhere, 'target.json'))).toBe(false);
      expect(() => write('delegate', ['a'], path.join(tmp, 'missing'))).toThrow();
      expect(fs.existsSync(path.join(tmp, 'missing'))).toBe(false);
    });
  });
});

describe('a damaged file in one scope', () => {
  it('names the damaged project file as a warning and keeps the global list', () => {
    put(globalFile(), { delegate: ['g1'] });
    put(projectFile(), '{oops');
    const config = configuredExtras(home, project);
    expect(config.slots.delegate).toEqual(['g1']);
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain(projectFile());
    expect(config.warnings[0]).toContain('global extras still apply');
  });

  it('keeps the project list when the global file is damaged, and names that file', () => {
    put(globalFile(), '{oops');
    put(projectFile(), { delegate: ['p1'] });
    const config = configuredExtras(home, project);
    expect(config.slots.delegate).toEqual(['p1']);
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain(globalFile());
  });

  it('names the project file when it lists a locked skill, and drops it', () => {
    put(projectFile(), { delegate: ['lantern-sync', 'p1'] });
    const config = configuredExtras(home, project);
    expect(config.slots.delegate).toEqual(['p1']);
    expect(config.warnings).toEqual([expect.stringContaining(projectFile())]);
    expect(config.warnings[0]).toContain('lantern-sync');
  });

  it('shows in the panel as a project error with the global slots intact', () => {
    put(globalFile(), { delegate: ['g1'] });
    put(projectFile(), '{oops');
    const panel = loadExtensionsPanel(['g1'], home, project);
    expect(panel.slots.delegate).toEqual(['g1']);
    expect(panel.projectSlots).toEqual(none);
    expect(panel.projectError).toContain(projectFile());
    expect(panel.error).toBeNull();
    expect(panel.projectRoot).toBe(project);
  });
});

describe('a project inside a worktree', () => {
  let main: string;
  let worktree: string;

  beforeEach(() => {
    main = fs.realpathSync(makeRepo(path.join(tmp, 'main-checkout'), '.claude/*'));
    worktree = path.join(main, '.claude', 'worktrees', 'agent-a1');
    git(main, 'worktree', 'add', '-q', '-b', 'agent-a1', worktree);
    worktree = fs.realpathSync(worktree);
  });

  it('resolves to the main checkout, from the worktree root and from a folder inside it', () => {
    expect(script.projectRootOf(worktree)).toBe(main);
    fs.mkdirSync(path.join(worktree, 'src', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(main, 'src', 'deep'), { recursive: true });
    expect(script.projectRootOf(path.join(worktree, 'src', 'deep'))).toBe(path.join(main, 'src', 'deep'));
    expect(projectRootFor(worktree, home)).toBe(main);
  });

  it('keeps a normal checkout, a folder of it and a folder that is no repository as they are', () => {
    expect(script.projectRootOf(main)).toBe(main);
    fs.mkdirSync(path.join(main, 'pkg'));
    expect(script.projectRootOf(path.join(main, 'pkg'))).toBe(path.join(main, 'pkg'));
    expect(script.projectRootOf(project)).toBe(project);
  });

  it('reads the project file of the main checkout when the work runs in a worktree that has none', () => {
    put(projectFile(main), { delegate: ['main-only'] });
    expect(fs.existsSync(projectFile(worktree))).toBe(false);
    const root = script.projectRootOf(worktree);
    expect(script.readProjectExtensions(root).delegate).toEqual(['main-only']);
    expect(configuredExtras(home, root).slots.delegate).toEqual(['main-only']);
    expect(loadExtensionsPanel([], home, worktree).projectSlots.delegate).toEqual(['main-only']);
  });

  it('writes the project file in the main checkout when a worktree is the open project', () => {
    const panel = saveExtensionsSlot('delegate', ['x'], [], home, undefined, { project: worktree, scope: 'project' });
    expect(panel.error).toBeNull();
    expect(JSON.parse(fs.readFileSync(projectFile(main), 'utf8'))).toEqual({ delegate: ['x'] });
    expect(fs.existsSync(projectFile(worktree))).toBe(false);
  });

  it('follows a relative gitdir pointer', () => {
    const pointer = fs.readFileSync(path.join(worktree, '.git'), 'utf8').trim();
    const target = pointer.replace(/^gitdir:\s*/, '');
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.relative(worktree, target)}\n`);
    expect(script.projectRootOf(worktree)).toBe(main);
  });

  it('leaves a submodule-style pointer as its own project', () => {
    const sub = path.join(tmp, 'sub');
    fs.mkdirSync(path.join(tmp, 'modules', 'sub'), { recursive: true });
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, '.git'), `gitdir: ${path.join(tmp, 'modules', 'sub')}\n`);
    expect(script.projectRootOf(sub)).toBe(sub);
  });
});

describe('saving to a scope from the app', () => {
  const installed = ['a', 'b'];

  it('writes the project file for the project scope and leaves the global file alone', () => {
    put(globalFile(), { delegate: ['g1'] });
    const panel = saveExtensionsSlot('delegate', ['a'], installed, home, undefined, { project, scope: 'project' });
    expect(panel.error).toBeNull();
    expect(panel.slots.delegate).toEqual(['g1']);
    expect(panel.projectSlots.delegate).toEqual(['a']);
    expect(panel.projectRoot).toBe(project);
    expect(JSON.parse(fs.readFileSync(globalFile(), 'utf8'))).toEqual({ delegate: ['g1'] });
    expect(JSON.parse(fs.readFileSync(projectFile(), 'utf8'))).toEqual({ delegate: ['a'] });
  });

  it('writes the global file by default and for the global scope', () => {
    expect(saveExtensionsSlot('delegate', ['a'], installed, home, undefined, { project }).slots.delegate).toEqual(['a']);
    expect(saveExtensionsSlot('reviewer', ['b'], installed, home, undefined, { project, scope: 'global' }).slots.reviewer).toEqual(['b']);
    expect(fs.existsSync(projectFile())).toBe(false);
  });

  it('keeps the off list global when it is saved with a project-scope list', () => {
    const panel = saveExtensionsSlot('delegate', ['a'], installed, home, ['lantern-commit'], { project, scope: 'project' });
    expect(panel.error).toBeNull();
    expect(JSON.parse(fs.readFileSync(globalFile(), 'utf8'))).toEqual({ off: { delegate: ['lantern-commit'] } });
    expect(JSON.parse(fs.readFileSync(projectFile(), 'utf8'))).toEqual({ delegate: ['a'] });
  });

  it.each([
    ['an unknown scope', { project, scope: 'team' }, msg('extensions.unknownScope', { scope: 'team' })],
    ['the project scope with no project open', { project: null, scope: 'project' }, msg('extensions.noProjectScope')],
    ['the project scope for the home folder', { project: '', scope: 'project' }, msg('extensions.noProjectScope')],
  ])('refuses %s and writes nothing', (_label, target, message) => {
    const panel = saveExtensionsSlot('delegate', ['a'], installed, home, undefined, target);
    expect(panel.error).toBe(message);
    expect(fs.existsSync(projectFile())).toBe(false);
    expect(fs.existsSync(globalFile())).toBe(false);
  });

  it('refuses a locked name in the project scope with the same words as the global one', () => {
    const message = msg('extensions.problem.locked', { name: 'lantern-sync' });
    expect(saveExtensionsSlot('delegate', ['lantern-sync'], installed, home, undefined, { project, scope: 'project' }).error).toBe(message);
    expect(fs.existsSync(projectFile())).toBe(false);
  });
});

describe('moving a skill between scopes', () => {
  const installed = ['a', 'b', 'c'];

  it('removes it from the global list and appends it to the project list, in one call', () => {
    put(globalFile(), { delegate: ['a', 'b'] });
    put(projectFile(), { delegate: ['c'] });
    const panel = moveExtension('delegate', 'a', 'global', 'project', installed, home, project);
    expect(panel.error).toBeNull();
    expect(panel.slots.delegate).toEqual(['b']);
    expect(panel.projectSlots.delegate).toEqual(['c', 'a']);
    expect(JSON.parse(fs.readFileSync(globalFile(), 'utf8'))).toEqual({ delegate: ['b'] });
  });

  it('moves it back, and keeps the other roles of both files', () => {
    put(globalFile(), { reviewer: ['b'] });
    put(projectFile(), { delegate: ['a'], orchestrator: ['c'] });
    const panel = moveExtension('delegate', 'a', 'project', 'global', installed, home, project);
    expect(panel.slots).toEqual({ delegate: ['a'], orchestrator: [], reviewer: ['b'] });
    expect(panel.projectSlots).toEqual({ delegate: [], orchestrator: ['c'], reviewer: [] });
  });

  it('writes the destination first, so a skill never drops out when the second write fails', () => {
    put(globalFile(), { delegate: ['a'] });
    put(projectFile(), { delegate: ['c'] });
    const real = fs.renameSync;
    let renames = 0;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      renames += 1;
      if (renames === 2) throw new Error('disk full');
      return real(from, to);
    });
    const panel = moveExtension('delegate', 'a', 'global', 'project', installed, home, project);
    spy.mockRestore();
    expect(panel.error).toBe('disk full');
    expect(JSON.parse(fs.readFileSync(projectFile(), 'utf8'))).toEqual({ delegate: ['c', 'a'] });
    expect(JSON.parse(fs.readFileSync(globalFile(), 'utf8'))).toEqual({ delegate: ['a'] });
    expect(configuredExtras(home, project).slots.delegate).toEqual(['a', 'c']);
  });

  it('refuses a skill that is not in the source list, an unknown scope, and a move with no project', () => {
    put(globalFile(), { delegate: ['a'] });
    expect(moveExtension('delegate', 'zzz', 'global', 'project', installed, home, project).error).toBe(msg('extensions.moveMissing', { name: 'zzz', scope: 'global', slot: 'delegate' }));
    expect(moveExtension('delegate', 'a', 'global', 'team', installed, home, project).error).toBe(msg('extensions.unknownScope', { scope: 'team' }));
    expect(moveExtension('delegate', 'a', 'global', 'project', installed, home, null).error).toBe(msg('extensions.noProjectScope'));
    expect(moveExtension('planning', 'a', 'global', 'project', installed, home, project).error).toBe(msg('extensions.unknownSlot', { slot: 'planning' }));
    expect(fs.existsSync(projectFile())).toBe(false);
    expect(JSON.parse(fs.readFileSync(globalFile(), 'utf8'))).toEqual({ delegate: ['a'] });
  });

  it('changes nothing when the two scopes are the same', () => {
    put(globalFile(), { delegate: ['a'] });
    const before = fs.readFileSync(globalFile(), 'utf8');
    expect(moveExtension('delegate', 'a', 'global', 'global', installed, home, project).error).toBeNull();
    expect(fs.readFileSync(globalFile(), 'utf8')).toBe(before);
  });
});

describe('adding a skill to a scope', () => {
  it('writes the skill folder and adds the name to the project file only', () => {
    const panel = createExtensionSkill({ project, slot: 'delegate', name: 'fresh', content: '---\nname: fresh\n---\n', scope: 'project' }, [], home);
    expect(panel.error).toBeNull();
    expect(fs.readFileSync(path.join(project, '.claude', 'skills', 'fresh', 'SKILL.md'), 'utf8')).toContain('name: fresh');
    expect(JSON.parse(fs.readFileSync(projectFile(), 'utf8'))).toEqual({ delegate: ['fresh'] });
    expect(fs.existsSync(globalFile())).toBe(false);
    expect(panel.projectSlots.delegate).toEqual(['fresh']);
  });

  it('adds it to the global file when asked for the global scope, as before', () => {
    const panel = createExtensionSkill({ project, slot: 'delegate', name: 'fresh', content: 'x', scope: 'global' }, [], home);
    expect(panel.slots.delegate).toEqual(['fresh']);
    expect(fs.existsSync(projectFile())).toBe(false);
  });

  it('refuses a name the scope already holds and writes no folder', () => {
    put(projectFile(), { delegate: ['fresh'] });
    const panel = createExtensionSkill({ project, slot: 'delegate', name: 'fresh', content: 'x', scope: 'project' }, [], home);
    expect(panel.error).toBe(msg('extensions.problem.duplicate', { name: 'fresh' }));
    expect(fs.existsSync(path.join(project, '.claude', 'skills', 'fresh'))).toBe(false);
  });
});

describe('keeping the project file out of git', () => {
  const settle = (root: string) => guardProjectFile(root, [], true, () => saveExtensionsSlot('delegate', ['a'], [], home, undefined, { project: root, scope: 'project' }), home);
  const excluded = (root: string) => fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8').split('\n');

  it('adds the file to the repository-local exclude before the first write', async () => {
    const repo = makeRepo(path.join(tmp, 'repo'), null);
    const panel = await settle(repo);
    expect(panel.error).toBeNull();
    expect(excluded(repo)).toContain('.claude/lantern-extensions.json');
    expect(git(repo, 'status', '--porcelain', '--', '.claude')).toBe('');
    expect(fs.existsSync(projectFile(repo))).toBe(true);
  });

  it('adds nothing when .gitignore already covers the file', async () => {
    const repo = makeRepo(path.join(tmp, 'repo'), '.claude/*');
    expect((await settle(repo)).error).toBeNull();
    expect(fs.existsSync(path.join(repo, '.git', 'info', 'exclude')) ? excluded(repo) : []).not.toContain('.claude/lantern-extensions.json');
  });

  it('writes in a folder that is no repository without touching git', async () => {
    expect((await settle(project)).error).toBeNull();
    expect(fs.existsSync(projectFile())).toBe(true);
  });

  it('refuses to write a file git would show, and says why, when it cannot be excluded', async () => {
    const repo = makeRepo(path.join(tmp, 'repo'), null);
    const inner = path.join(repo, 'packages', 'app');
    fs.mkdirSync(inner, { recursive: true });
    const panel = await settle(inner);
    expect(panel.error).toBe(msg('extensions.projectNotIgnored', { file: projectFile(inner) }));
    expect(fs.existsSync(projectFile(inner))).toBe(false);
  });

  it('refuses to write a project file that git tracks', async () => {
    const repo = makeRepo(path.join(tmp, 'repo'), null);
    put(projectFile(repo), { delegate: ['kept'] });
    git(repo, 'add', '-f', '.claude/lantern-extensions.json');
    git(repo, 'commit', '-q', '-m', 'track extras');
    const before = fs.readFileSync(projectFile(repo), 'utf8');
    expect((await settle(repo)).error).toBe(msg('extensions.projectNotIgnored', { file: projectFile(repo) }));
    expect(fs.readFileSync(projectFile(repo), 'utf8')).toBe(before);
  });

  it('does not look at git for a global write', async () => {
    const repo = makeRepo(path.join(tmp, 'repo'), null);
    const panel = await guardProjectFile(repo, [], false, () => saveExtensionsSlot('delegate', ['a'], [], home, undefined, { project: repo }), home);
    expect(panel.error).toBeNull();
    expect(fs.existsSync(path.join(repo, '.git', 'info', 'exclude')) ? excluded(repo) : []).not.toContain('.claude/lantern-extensions.json');
  });
});
