import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

import { createExtensionSkill, extensionsPath, importExtensionsList, loadExtensionsPanel, readSkillLinker, saveExtensionsSlot, saveSkillLinker, writeExtensions, writeSkillLinker } from '../src/main/extensions';
import { installedNames } from '../src/main/skills';
import { pickerSkills } from '../src/renderer/features/skills-state';
import { msg } from '../src/shared/lang/messages';
// @ts-expect-error plain ES module, no declarations
import { alwaysOnSkills, BUNDLED_SKILLS, switchableSkills } from '../skills/lantern-delegate/scripts/bundled-skills.mjs';

let home: string;

beforeEach(() => {
  delete process.env.SKILLS_REPO;
  home =fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ext-panel-')));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function writeFileConfig(data: object) {
  fs.mkdirSync(path.dirname(extensionsPath(home)), { recursive: true });
  fs.writeFileSync(extensionsPath(home), JSON.stringify(data));
}

function skill(base: string, name: string) {
  fs.mkdirSync(path.join(base, '.claude', 'skills', name), { recursive: true });
  fs.writeFileSync(path.join(base, '.claude', 'skills', name, 'SKILL.md'), `# ${name}`);
}

describe('extensions panel', () => {
  it('loads empty slots and the installed names without an error', () => {
    expect(loadExtensionsPanel(['a'], home)).toEqual({ slots: { delegate: [], orchestrator: [], reviewer: [] }, projectSlots: { delegate: [], orchestrator: [], reviewer: [] }, projectRoot: null, projectError: null, alwaysOn: { delegate: alwaysOnSkills('delegate'), orchestrator: alwaysOnSkills('orchestrator'), reviewer: alwaysOnSkills('reviewer') }, switchable: { delegate: [...switchableSkills('delegate')], orchestrator: [], reviewer: [...switchableSkills('reviewer')] }, off: { delegate: [], orchestrator: [], reviewer: [] }, locked: BUNDLED_SKILLS, installed: ['a'], skillLinker: null, skillLinkerState: 'unset', skillLinkerProblem: null, skillLinkerPath: null, skillLinkerFromRepo: false, error: null });
  });

  it('names the locked skills it dropped from a file written by hand and keeps the rest', () => {
    fs.mkdirSync(path.dirname(extensionsPath(home)), { recursive: true });
    fs.writeFileSync(extensionsPath(home), JSON.stringify({ delegate: ['lantern-code-reviewer', 'typescript'] }));
    const panel = loadExtensionsPanel([], home);
    expect(panel.slots.delegate).toEqual(['typescript']);
    expect(panel.error).toBe(msg('extensions.droppedLocked', { names: 'lantern-code-reviewer' }));
  });

  it('keeps code-reviewer as a plain extra name and drops lantern-code-reviewer', () => {
    fs.mkdirSync(path.dirname(extensionsPath(home)), { recursive: true });
    fs.writeFileSync(extensionsPath(home), JSON.stringify({ reviewer: ['code-reviewer', 'lantern-code-reviewer', 'lantern-no-comments'] }));
    const panel = loadExtensionsPanel([], home);
    expect(panel.slots.reviewer).toEqual(['code-reviewer']);
    expect(panel.error).toBe(msg('extensions.droppedLocked', { names: 'lantern-code-reviewer, lantern-no-comments' }));
  });

  describe('switching built-in skills off', () => {
    it('carries what can be switched off and what is, and the locked rows are not switchable', () => {
      writeFileConfig({ off: { delegate: ['lantern-local-loop'], reviewer: ['lantern-code-reviewer'] } });
      const panel = loadExtensionsPanel([], home);
      expect(panel.error).toBeNull();
      expect(panel.off).toEqual({ delegate: ['lantern-local-loop'], orchestrator: [], reviewer: ['lantern-code-reviewer'] });
      expect(panel.switchable.delegate).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop']);
      expect(panel.switchable.reviewer).toEqual(['lantern-no-comments', 'lantern-code-reviewer']);
      expect(panel.switchable.orchestrator).toEqual([]);
      for (const slot of ['delegate', 'orchestrator', 'reviewer'] as const) expect(panel.alwaysOn[slot]).toEqual(expect.arrayContaining(panel.switchable[slot]));
      expect(panel.alwaysOn.delegate).toContain('lantern-setup');
      expect(panel.switchable.delegate).not.toContain('lantern-setup');
      expect(panel.alwaysOn.orchestrator).toContain('lantern-sync');
    });

    it('saves the off list of a slot through the same save as the extras and returns it', () => {
      const panel = saveExtensionsSlot('delegate', ['typescript'], ['typescript'], home, ['lantern-commit']);
      expect(panel.error).toBeNull();
      expect(panel.slots.delegate).toEqual(['typescript']);
      expect(panel.off.delegate).toEqual(['lantern-commit']);
      expect(JSON.parse(fs.readFileSync(extensionsPath(home), 'utf8'))).toEqual({ delegate: ['typescript'], off: { delegate: ['lantern-commit'] } });
      expect(saveExtensionsSlot('delegate', ['typescript'], ['typescript'], home, []).off.delegate).toEqual([]);
    });

    it('keeps the off list when only the extras are saved', () => {
      saveExtensionsSlot('delegate', [], [], home, ['lantern-commit']);
      const panel = saveExtensionsSlot('delegate', ['typescript'], ['typescript'], home);
      expect(panel.off.delegate).toEqual(['lantern-commit']);
    });

    it.each([
      ['a locked skill', 'delegate', ['lantern-sync']],
      ['a skill of another slot', 'delegate', ['lantern-code-reviewer']],
      ['anything for the orchestrator', 'orchestrator', ['lantern-sync']],
      ['a duplicate', 'delegate', ['lantern-commit', 'lantern-commit']],
    ])('refuses %s and changes nothing', (_label, slot, names) => {
      saveExtensionsSlot('delegate', ['typescript'], ['typescript'], home);
      const before = fs.readFileSync(extensionsPath(home), 'utf8');
      const panel = saveExtensionsSlot(slot, ['other'], [], home, names);
      expect(panel.error).not.toBeNull();
      expect(fs.readFileSync(extensionsPath(home), 'utf8')).toBe(before);
    });

    it('names the locked and unknown names it dropped from a file written by hand and keeps the switchable ones', () => {
      writeFileConfig({ off: { delegate: ['lantern-sync', 'lantern-commit', 'mystery'] } });
      const panel = loadExtensionsPanel([], home);
      expect(panel.off.delegate).toEqual(['lantern-commit']);
      expect(panel.error).toBe(msg('extensions.droppedOff', { names: 'lantern-sync, mystery' }));
    });

    it('names both kinds of drop in one error', () => {
      writeFileConfig({ delegate: ['lantern-code-reviewer'], off: { delegate: ['lantern-setup'] } });
      expect(loadExtensionsPanel([], home).error).toBe(`${msg('extensions.droppedLocked', { names: 'lantern-code-reviewer' })} ${msg('extensions.droppedOff', { names: 'lantern-setup' })}`);
    });
  });

  it('shows the reviewer slot with its always on skills and saves its extras', () => {
    const panel = saveExtensionsSlot('reviewer', ['typescript'], ['typescript'], home);
    expect(panel.error).toBeNull();
    expect(panel.slots).toEqual({ delegate: [], orchestrator: [], reviewer: ['typescript'] });
    expect(panel.alwaysOn.reviewer).toEqual(expect.arrayContaining(['lantern-no-comments', 'lantern-code-reviewer']));
    expect(panel.alwaysOn.reviewer).toEqual(alwaysOnSkills('reviewer'));
  });

  it('refuses the reviewer skill itself as an extra of the reviewer slot', () => {
    const panel = saveExtensionsSlot('reviewer', ['lantern-code-reviewer'], [], home);
    expect(panel.error).toBe(msg('extensions.problem.locked', { name: 'lantern-code-reviewer' }));
    expect(panel.slots.reviewer).toEqual([]);
  });

  it('imports the reviewer list of a file add-only', () => {
    const list = path.join(home, 'list.json');
    fs.writeFileSync(list, JSON.stringify({ reviewer: ['typescript', 'lantern-no-comments'] }));
    const panel = importExtensionsList(list, [], home);
    expect(panel.slots.reviewer).toEqual(['typescript']);
  });

  it('saves a slot and returns what is now on disk', () => {
    const panel = saveExtensionsSlot('delegate', ['typescript'], ['typescript'], home);
    expect(panel.error).toBeNull();
    expect(panel.slots.delegate).toEqual(['typescript']);
  });

  it.each([
    ['a locked skill', ['lantern-sync'], msg('extensions.problem.locked', { name: 'lantern-sync' })],
    ['a duplicate', ['a', 'a'], msg('extensions.problem.duplicate', { name: 'a' })],
    ['a bad name', ['../x'], msg('extensions.problem.badName', { name: '../x' })],
  ])('refuses %s with its message and keeps the file', (_what, names, message) => {
    writeExtensions('delegate', ['keep'], home);
    const panel = saveExtensionsSlot('delegate', names, [], home);
    expect(panel.error).toBe(message);
    expect(panel.slots.delegate).toEqual(['keep']);
  });

  it('refuses an unknown slot and a non-list', () => {
    expect(saveExtensionsSlot('planning', [], [], home).error).toBe(msg('extensions.unknownSlot', { slot: 'planning' }));
    expect(saveExtensionsSlot('delegate', 'x', [], home).error).toBe(msg('extensions.slotNotList', { slot: 'delegate' }));
  });

  it('reports a damaged file and writes nothing over it', () => {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(extensionsPath(home), '{ nope');
    const panel = saveExtensionsSlot('delegate', ['typescript'], [], home);
    expect(panel.error).toContain(extensionsPath(home));
    expect(fs.readFileSync(extensionsPath(home), 'utf8')).toBe('{ nope');
    expect(loadExtensionsPanel([], home).error).toContain(extensionsPath(home));
  });
});

const LIST = { orchestrator: ['first-skill', 'second-skill'], delegate: ['third-skill'], skillLinker: '/opt/skills/skillLinker' };

function listFile(content: unknown = LIST) {
  const file = path.join(home, 'list.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

describe('Skill linker path', () => {
  it('saves a path, returns it in the panel and keeps the slots', () => {
    writeExtensions('delegate', ['typescript'], home);
    const panel = saveSkillLinker('/opt/skills/skillLinker', [], home);
    expect(panel.error).toBeNull();
    expect(panel.skillLinker).toBe('/opt/skills/skillLinker');
    expect(panel.slots.delegate).toEqual(['typescript']);
  });

  it.each([null, ''])('clears the path for %j and keeps the slots', (empty) => {
    writeExtensions('delegate', ['typescript'], home);
    writeSkillLinker('/opt/skills/skillLinker', home);
    const panel = saveSkillLinker(empty, [], home);
    expect(panel.error).toBeNull();
    expect(panel.skillLinker).toBeNull();
    expect(readSkillLinker(home)).toBeNull();
    expect(JSON.parse(fs.readFileSync(extensionsPath(home), 'utf8'))).toEqual({ delegate: ['typescript'] });
  });

  it('refuses a relative path with its message and keeps the file', () => {
    writeSkillLinker('/opt/skills/skillLinker', home);
    const panel = saveSkillLinker('skillLinker', [], home);
    expect(panel.error).toBe(msg('extensions.skillLinkerPath', { value: 'skillLinker' }));
    expect(panel.skillLinker).toBe('/opt/skills/skillLinker');
  });
});

describe('Skill linker state', () => {
  it('is unset without a path', () => {
    expect(loadExtensionsPanel([], home).skillLinkerState).toBe('unset');
  });

  it('is invalid for a path that is not an executable file', () => {
    expect(saveSkillLinker('/no/such/linker', [], home).skillLinkerState).toBe('invalid');
    const plain = path.join(home, 'plain');
    fs.mkdirSync(path.join(home, 'core'));
    fs.writeFileSync(plain, '#!/bin/sh\n', { mode: 0o644 });
    expect(saveSkillLinker(plain, [], home).skillLinkerState).toBe('invalid');
  });

  it('is initialized for an executable file with the skills repo beside it', () => {
    const linker = path.join(home, 'linker');
    fs.mkdirSync(path.join(home, 'core'));
    fs.writeFileSync(linker, '#!/bin/sh\n', { mode: 0o755 });
    const panel = saveSkillLinker(linker, [], home);
    expect(panel.error).toBeNull();
    expect(panel.skillLinkerState).toBe('initialized');
  });
});

describe('Skill linker folder', () => {
  const makeRepo = (name: string, files: Record<string, number>, core = true) => {
    const dir = path.join(home, name);
    fs.mkdirSync(dir);
    if (core) fs.mkdirSync(path.join(dir, 'core'));
    for (const [file, mode] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), '#!/bin/sh\n', { mode });
    return dir;
  };

  it('accepts the repo folder and saves the path of the executable inside it', () => {
    const dir = makeRepo('my-repo', { 'my-linker': 0o755, 'README.md': 0o644 });
    const panel = saveSkillLinker(dir, [], home);
    expect(panel.skillLinkerState).toBe('initialized');
    expect(panel.skillLinkerProblem).toBeNull();
    expect(panel.skillLinker).toBe(path.join(dir, 'my-linker'));
    expect(readSkillLinker(home)).toBe(path.join(dir, 'my-linker'));
  });

  it('says the folder holds no executable', () => {
    const panel = saveSkillLinker(makeRepo('no-exec', { 'notes.txt': 0o644 }), [], home);
    expect(panel.skillLinkerState).toBe('invalid');
    expect(panel.skillLinkerProblem).toContain('holds no executable file');
    expect(panel.skillLinker).toBe(path.join(home, 'no-exec'));
  });

  it('says the executables have no core folder beside them', () => {
    const panel = saveSkillLinker(makeRepo('no-core', { 'my-linker': 0o755 }, false), [], home);
    expect(panel.skillLinkerProblem).toContain('no "core" folder beside them');
  });

  it('prefers the one executable without an extension over helper scripts', () => {
    const dir = makeRepo('with-helper', { 'my-linker': 0o755, 'install.sh': 0o755, 'README.md': 0o644 });
    const panel = saveSkillLinker(dir, [], home);
    expect(panel.skillLinkerState).toBe('initialized');
    expect(panel.skillLinker).toBe(path.join(dir, 'my-linker'));
  });

  it('names the linkers when the folder holds several', () => {
    const panel = saveSkillLinker(makeRepo('two', { 'one-linker': 0o755, 'two-linker': 0o755 }), [], home);
    expect(panel.skillLinkerProblem).toContain('several skill linkers (one-linker, two-linker)');
  });

  it('gives each cause of a bad path its own message', () => {
    const plain = path.join(makeRepo('plain', { 'my-linker': 0o644 }), 'my-linker');
    const noCore = path.join(makeRepo('bare', { 'my-linker': 0o755 }, false), 'my-linker');
    const problems = [path.join(home, 'absent'), plain, noCore].map((value) => saveSkillLinker(value, [], home).skillLinkerProblem);
    expect(problems[0]).toContain('does not exist');
    expect(problems[1]).toContain('not executable');
    expect(problems[2]).toContain('no "core" folder');
    expect(new Set(problems).size).toBe(3);
  });
});

describe('importing a list file', () => {
  it('adds the skills to their slots and sets the Skill linker path', () => {
    const panel = importExtensionsList(listFile(), [], home);
    expect(panel.error).toBeNull();
    expect(panel.slots).toEqual({ orchestrator: ['first-skill', 'second-skill'], delegate: ['third-skill'], reviewer: [] });
    expect(panel.skillLinker).toBe('/opt/skills/skillLinker');
    expect(JSON.parse(fs.readFileSync(extensionsPath(home), 'utf8'))).toEqual(LIST);
  });

  it('skips names already there and keeps the order of what was', () => {
    writeExtensions('orchestrator', ['mine', 'first-skill'], home);
    const panel = importExtensionsList(listFile(), [], home);
    expect(panel.slots.orchestrator).toEqual(['mine', 'first-skill', 'second-skill']);
  });

  it('drops duplicates inside the file', () => {
    const panel = importExtensionsList(listFile({ delegate: ['a', 'a', 'b'] }), [], home);
    expect(panel.slots.delegate).toEqual(['a', 'b']);
  });

  it('skips locked names and keeps the Skill linker path when the file has none', () => {
    writeSkillLinker('/opt/skills/skillLinker', home);
    const panel = importExtensionsList(listFile({ delegate: ['lantern-sync', 'third-skill'], orchestrator: ['lantern-plan-x'] }), [], home);
    expect(panel.slots).toEqual({ delegate: ['third-skill'], orchestrator: [], reviewer: [] });
    expect(panel.skillLinker).toBe('/opt/skills/skillLinker');
  });

  it('replaces the Skill linker path with the one in the file', () => {
    writeSkillLinker('/old/skillLinker', home);
    expect(importExtensionsList(listFile({ skillLinker: '/new/skillLinker' }), [], home).skillLinker).toBe('/new/skillLinker');
  });

  it('accepts a file with only some of the keys', () => {
    const panel = importExtensionsList(listFile({ delegate: ['third-skill'] }), [], home);
    expect(panel.error).toBeNull();
    expect(panel.slots).toEqual({ delegate: ['third-skill'], orchestrator: [], reviewer: [] });
    expect(panel.skillLinker).toBeNull();
  });

  it('writes nothing until a file is imported', () => {
    listFile();
    expect(loadExtensionsPanel([], home).slots).toEqual({ delegate: [], orchestrator: [], reviewer: [] });
    expect(fs.existsSync(extensionsPath(home))).toBe(false);
  });

  it.each([
    ['a missing file', () => path.join(home, 'nope.json'), (file: string) => expect.stringContaining(`The list ${file} could not be read`)],
    ['text that is not JSON', () => listFile('{ nope'), (file: string) => expect.stringContaining(`The list ${file} could not be read`)],
    ['a list instead of an object', () => listFile([]), (file: string) => msg('extensions.notObject', { file })],
    ['a slot that is not a list', () => listFile({ delegate: 'x' }), (file: string) => msg('extensions.importBadSlot', { file, slot: 'delegate' })],
    ['a slot with a non-string', () => listFile({ orchestrator: ['a', 1] }), (file: string) => msg('extensions.importBadSlot', { file, slot: 'orchestrator' })],
    ['a relative Skill linker path', () => listFile({ delegate: ['a'], skillLinker: 'skillLinker' }), () => msg('extensions.skillLinkerPath', { value: 'skillLinker' })],
  ])('reports %s and writes nothing', (_what, make, expected) => {
    const file = make();
    const panel = importExtensionsList(file, [], home);
    expect(panel.error).toEqual(expected(file));
    expect(fs.existsSync(extensionsPath(home))).toBe(false);
  });

  it('leaves an existing config untouched when the file is malformed', () => {
    writeExtensions('delegate', ['keep'], home);
    const before = fs.readFileSync(extensionsPath(home), 'utf8');
    importExtensionsList(listFile({ delegate: ['new'], skillLinker: 'relative' }), [], home);
    expect(fs.readFileSync(extensionsPath(home), 'utf8')).toBe(before);
  });
});

describe('creating a skill for a slot', () => {
  let project: string;
  const skillFile = (name: string) => path.join(project, '.claude', 'skills', name, 'SKILL.md');
  const create = (name: unknown, content: unknown, installed: string[] = [], slot: unknown = 'delegate') => createExtensionSkill({ project, slot, name, content }, installed, home);

  beforeEach(() => {
    project = path.join(home, 'proj');
    fs.mkdirSync(project);
  });

  it('writes SKILL.md into the project and adds the name to the slot', () => {
    const panel = create('my-skill', '---\nname: my-skill\n---\nBody\n');
    expect(panel.error).toBeNull();
    expect(fs.readFileSync(skillFile('my-skill'), 'utf8')).toBe('---\nname: my-skill\n---\nBody\n');
    expect(panel.slots.delegate).toEqual(['my-skill']);
    expect(panel.installed).toContain('my-skill');
    expect(readExtensionsFile().delegate).toEqual(['my-skill']);
  });

  it('adds to the asked slot only and keeps the names already there', () => {
    writeExtensions('orchestrator', ['mine'], home);
    const panel = create('my-skill', 'text', [], 'orchestrator');
    expect(panel.slots).toEqual({ delegate: [], orchestrator: ['mine', 'my-skill'], reviewer: [] });
  });

  it('only adds the name when the skill is installed and the content is empty', () => {
    const panel = create('typescript', '  \n', ['typescript']);
    expect(panel.error).toBeNull();
    expect(panel.slots.delegate).toEqual(['typescript']);
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });

  it('refuses an existing folder when content is given and overwrites nothing', () => {
    fs.mkdirSync(path.dirname(skillFile('mine')), { recursive: true });
    fs.writeFileSync(skillFile('mine'), 'original');
    const panel = create('mine', 'replacement', ['mine']);
    expect(panel.error).toBe(msg('extensions.skillExists', { name: 'mine' }));
    expect(fs.readFileSync(skillFile('mine'), 'utf8')).toBe('original');
    expect(panel.slots.delegate).toEqual([]);
  });

  it('refuses a skill that is not installed when the content is empty', () => {
    const panel = create('ghost', '');
    expect(panel.error).toBe(msg('extensions.emptyContent', { name: 'ghost' }));
    expect(panel.slots.delegate).toEqual([]);
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });

  it.each([
    ['a bad name', '../evil', msg('extensions.problem.badName', { name: '../evil' })],
    ['a locked name', 'lantern-sync', msg('extensions.problem.locked', { name: 'lantern-sync' })],
    ['a name already in the slot', 'taken', msg('extensions.problem.duplicate', { name: 'taken' })],
  ])('refuses %s before writing anything', (_what, name, message) => {
    writeExtensions('delegate', ['taken'], home);
    const panel = create(name, 'text');
    expect(panel.error).toBe(message);
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
    expect(panel.slots.delegate).toEqual(['taken']);
  });

  it('refuses an unknown slot, a missing project and non-text input', () => {
    expect(create('a', 'x', [], 'planning').error).toBe(msg('extensions.unknownSlot', { slot: 'planning' }));
    expect(createExtensionSkill({ project: null, slot: 'delegate', name: 'a', content: 'x' }, [], home).error).toBe(msg('extensions.noProject'));
    expect(createExtensionSkill({ project: path.join(home, 'nope'), slot: 'delegate', name: 'a', content: 'x' }, [], home).error).toBe(msg('extensions.noProject'));
    expect(create('a', 5).error).toBe(msg('extensions.badSkill'));
    expect(createExtensionSkill(undefined, [], home).error).toBe(msg('extensions.unknownSlot', { slot: 'undefined' }));
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });
});

function readExtensionsFile(): Record<string, string[]> {
  return JSON.parse(fs.readFileSync(extensionsPath(home), 'utf8'));
}

describe('installedNames', () => {
  it('merges project and user skills that hold a SKILL.md, sorted and unique', () => {
    const project = path.join(home, 'proj');
    skill(project, 'b');
    skill(project, 'shared');
    skill(home, 'a');
    skill(home, 'shared');
    fs.mkdirSync(path.join(project, '.claude', 'skills', 'empty'));
    expect(installedNames(project, 'claude', home)).toEqual(['a', 'b', 'shared']);
  });

  it('reads only the user skills without a project', () => {
    skill(home, 'a');
    expect(installedNames(null, 'claude', home)).toEqual(['a']);
  });
});

describe('extras picker source without a skill linker', () => {
  const project = () => path.join(home, 'proj');
  const picker = (): string[] => pickerSkills(loadExtensionsPanel(installedNames(project(), 'claude', home), home), []);

  it('is the project and user skills, minus the locked ones, once each', () => {
    skill(project(), 'typescript');
    skill(project(), 'lantern-commit');
    skill(project(), 'lantern-plan-review');
    skill(home, 'typescript');
    skill(home, 'react-spa-forms');
    skill(home, 'zod-schemas');
    skill(home, 'lantern-local-loop');
    expect(loadExtensionsPanel([], home).skillLinkerState).toBe('unset');
    expect(picker()).toEqual(['react-spa-forms', 'typescript', 'zod-schemas']);
  });

  it('offers a skill added to the project later on the next load', () => {
    skill(home, 'typescript');
    expect(picker()).toEqual(['typescript']);
    skill(project(), 'new-one');
    expect(picker()).toEqual(['new-one', 'typescript']);
  });

  it('keeps a chosen extra in the stored slot exactly as before', () => {
    skill(home, 'typescript');
    const panel = saveExtensionsSlot('reviewer', ['typescript'], installedNames(project(), 'claude', home), home);
    expect(panel.error).toBeNull();
    expect(readExtensionsFile()).toEqual({ reviewer: ['typescript'] });
  });
});

describe('Skill linker from the Skills repo', () => {
  const makeRepo = (name: string) => {
    const dir = path.join(home, name);
    fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'my-linker'), '#!/bin/sh\n', { mode: 0o755 });
    return dir;
  };

  afterEach(() => {
    delete process.env.SKILLS_REPO;
  });

  it('resolves to the script the same folder typed into the field resolves to', () => {
    const repo = makeRepo('repo');
    process.env.SKILLS_REPO = repo;
    const panel = loadExtensionsPanel([], home);
    expect(panel).toMatchObject({ skillLinker: null, skillLinkerState: 'initialized', skillLinkerProblem: null, skillLinkerFromRepo: true, skillLinkerPath: path.join(repo, 'my-linker') });
    delete process.env.SKILLS_REPO;
    expect(saveSkillLinker(repo, [], home).skillLinkerPath).toBe(panel.skillLinkerPath);
  });

  it('writes nothing to the extensions file', () => {
    process.env.SKILLS_REPO = makeRepo('repo');
    loadExtensionsPanel([], home);
    expect(fs.existsSync(extensionsPath(home))).toBe(false);
  });

  it('lets an explicit path win over the repo', () => {
    process.env.SKILLS_REPO = makeRepo('repo');
    const other = makeRepo('other');
    expect(saveSkillLinker(other, [], home)).toMatchObject({ skillLinkerFromRepo: false, skillLinkerPath: path.join(other, 'my-linker') });
  });

  it('does not fall back to the repo when the explicit path is broken', () => {
    process.env.SKILLS_REPO = makeRepo('repo');
    expect(saveSkillLinker('/no/such/linker', [], home)).toMatchObject({ skillLinkerState: 'invalid', skillLinkerPath: null });
  });

  it('returns to the repo when the path is cleared', () => {
    process.env.SKILLS_REPO = makeRepo('repo');
    saveSkillLinker(makeRepo('other'), [], home);
    expect(saveSkillLinker(null, [], home)).toMatchObject({ skillLinker: null, skillLinkerFromRepo: true, skillLinkerState: 'initialized' });
  });

  it('stays unset with no repo, and with a repo that holds no linker', () => {
    delete process.env.SKILLS_REPO;
    expect(loadExtensionsPanel([], home)).toMatchObject({ skillLinkerState: 'unset', skillLinkerPath: null, skillLinkerFromRepo: false });
    const bare = path.join(home, 'bare');
    fs.mkdirSync(bare);
    process.env.SKILLS_REPO = bare;
    expect(loadExtensionsPanel([], home)).toMatchObject({ skillLinkerState: 'unset', skillLinkerProblem: null });
  });
});
