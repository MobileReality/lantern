import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readExtensions as readInApp, readSkillLinker as readSkillLinkerInApp, readSwitchedOff as readOffInApp, writeExtensions, writeSkillLinker, writeSwitchedOff as writeOffInApp } from '../src/main/extensions';
import { EXTENSION_SLOTS, LOCKED_SKILL_PREFIX } from '../src/shared/extension-slots';
// @ts-expect-error plain ES module, no declarations
import * as bundled from '../skills/lantern-delegate/scripts/bundled-skills.mjs';
// @ts-expect-error plain ES module, no declarations
import { BUNDLED_SKILLS as LOCKED_SKILLS } from '../skills/lantern-delegate/scripts/bundled-skills.mjs';
// @ts-expect-error plain ES module, no declarations
import * as script from '../skills/lantern-delegate/scripts/extensions.mjs';

let home: string;

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-ext-')));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const file = () => path.join(home, '.claude', 'lantern-extensions.json');

describe('shared constants', () => {
  it('match between the app and the script', () => {
    expect(script.EXTENSION_SLOTS).toEqual(EXTENSION_SLOTS);
    expect(EXTENSION_SLOTS).toEqual(['delegate', 'orchestrator', 'reviewer']);
    expect(script.LOCKED_SKILLS).toEqual(LOCKED_SKILLS);
    expect(script.LOCKED_SKILL_PREFIX).toBe(LOCKED_SKILL_PREFIX);
    expect(script.extensionsPath(home)).toBe(file());
  });
});

describe.each([
  ['script', script.readExtensions, script.setExtensions, script.readSkillLinker, script.setSkillLinker],
  ['app', readInApp, writeExtensions, readSkillLinkerInApp, writeSkillLinker],
])('%s reader and writer', (_name, read, write, readLinker, writeLinker) => {
  it('reads a missing file as empty slots without creating it', () => {
    expect(read(home)).toEqual({ delegate: [], orchestrator: [], reviewer: [] });
    expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
  });

  it('writes a slot, creates the folder and keeps unknown keys and the other slot', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ orchestrator: ['my-extra'], other: 1 }));
    write('delegate', ['typescript'], home);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ orchestrator: ['my-extra'], other: 1, delegate: ['typescript'] });
    expect(read(home)).toEqual({ delegate: ['typescript'], orchestrator: ['my-extra'], reviewer: [] });
  });

  it('writes and reads the reviewer slot and keeps the other slots', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ delegate: ['typescript'], orchestrator: ['my-extra'] }));
    write('reviewer', ['biome'], home);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ delegate: ['typescript'], orchestrator: ['my-extra'], reviewer: ['biome'] });
    expect(read(home)).toEqual({ delegate: ['typescript'], orchestrator: ['my-extra'], reviewer: ['biome'] });
  });

  it('locks the reviewer skill and its fixed skill in the reviewer slot', () => {
    for (const name of ['lantern-code-reviewer', 'lantern-no-comments']) expect(() => write('reviewer', [name], home)).toThrow();
    expect(fs.existsSync(file())).toBe(false);
  });

  it('accepts code-reviewer as a plain extra name', () => {
    write('reviewer', ['code-reviewer'], home);
    expect(read(home).reviewer).toEqual(['code-reviewer']);
  });

  it('drops a locked name stored in the reviewer slot', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ reviewer: ['lantern-code-reviewer', 'biome'] }));
    expect(read(home).reviewer).toEqual(['biome']);
  });

  it('refuses an unknown slot', () => {
    expect(() => write('planning', ['x'], home)).toThrow();
    expect(fs.existsSync(file())).toBe(false);
  });

  it.each([...LOCKED_SKILLS, 'lantern-plan', 'lantern-plan-impact'])('refuses the locked skill %s', (name) => {
    expect(() => write('delegate', [name], home)).toThrow();
    expect(fs.existsSync(file())).toBe(false);
  });

  it.each(['../evil', 'a/b', '', '.hidden', 'with space'])('refuses the non-folder name "%s"', (name) => {
    expect(() => write('delegate', [name], home)).toThrow();
  });

  it('refuses a duplicate', () => {
    expect(() => write('delegate', ['typescript', 'typescript'], home)).toThrow();
  });

  it('refuses a damaged file and leaves it untouched', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), '{not json');
    expect(() => read(home)).toThrow();
    expect(() => write('delegate', ['typescript'], home)).toThrow();
    expect(fs.readFileSync(file(), 'utf8')).toBe('{not json');
  });

  it('refuses a file that is not an object and a slot that is not a list', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), '[]');
    expect(() => read(home)).toThrow();
    fs.writeFileSync(file(), JSON.stringify({ delegate: 'typescript' }));
    expect(() => read(home)).toThrow();
  });

  it('drops a locked skill stored by hand and keeps the other names', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ delegate: ['lantern-code-reviewer', 'typescript'], orchestrator: ['lantern-jira', 'biome'] }));
    expect(read(home)).toEqual({ delegate: ['typescript'], orchestrator: ['biome'], reviewer: [] });
  });

  it('rewrites the file without the locked names when a slot is saved', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ delegate: ['lantern-code-reviewer', 'typescript'], orchestrator: ['lantern-commit', 'biome'] }));
    write('delegate', ['typescript', 'zod-schemas'], home);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ delegate: ['typescript', 'zod-schemas'], orchestrator: ['biome'] });
  });

  it('reads the skillLinker key as null when it is not set', () => {
    expect(readLinker(home)).toBeNull();
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ delegate: ['typescript'] }));
    expect(readLinker(home)).toBeNull();
  });

  it('writes the skillLinker key and keeps the slots', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ delegate: ['typescript'] }));
    writeLinker('/opt/skills/skillLinker', home);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ delegate: ['typescript'], skillLinker: '/opt/skills/skillLinker' });
    expect(readLinker(home)).toBe('/opt/skills/skillLinker');
    expect(read(home)).toEqual({ delegate: ['typescript'], orchestrator: [], reviewer: [] });
  });

  it.each(['skillLinker', './skillLinker', '', '~/skillLinker', 7, null])('refuses the skillLinker value %j', (value) => {
    expect(() => writeLinker(value, home)).toThrow();
    expect(fs.existsSync(file())).toBe(false);
  });

  it('refuses a skillLinker key stored by hand that is not an absolute path', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ skillLinker: 'skillLinker' }));
    expect(() => readLinker(home)).toThrow();
    fs.writeFileSync(file(), JSON.stringify({ skillLinker: 3 }));
    expect(() => readLinker(home)).toThrow();
  });
});

describe.each([
  ['script', script.readSwitchedOff, script.setSwitchedOff, script.setExtensions],
  ['app', readOffInApp, writeOffInApp, writeExtensions],
])('%s reader and writer of the off list', (_name, readOff, writeOff, writeExtras) => {
  it('reads a missing file and a file without the key as nothing switched off', () => {
    expect(readOff(home)).toEqual({ delegate: [], orchestrator: [], reviewer: [] });
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ delegate: ['typescript'] }));
    expect(readOff(home)).toEqual({ delegate: [], orchestrator: [], reviewer: [] });
  });

  it('writes the off list of one slot beside the extras and keeps the other keys', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ delegate: ['typescript'], skillLinker: '/opt/linker', off: { reviewer: ['lantern-no-comments'] } }));
    writeOff('delegate', ['lantern-commit', 'lantern-local-loop'], home);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({
      delegate: ['typescript'],
      skillLinker: '/opt/linker',
      off: { reviewer: ['lantern-no-comments'], delegate: ['lantern-commit', 'lantern-local-loop'] },
    });
    expect(readOff(home)).toEqual({ delegate: ['lantern-commit', 'lantern-local-loop'], orchestrator: [], reviewer: ['lantern-no-comments'] });
  });

  it('keeps the off list when the extras of a slot are saved', () => {
    writeOff('reviewer', ['lantern-code-reviewer'], home);
    writeExtras('reviewer', ['biome'], home);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ reviewer: ['biome'], off: { reviewer: ['lantern-code-reviewer'] } });
  });

  it.each([
    ['a locked skill', 'delegate', 'lantern-sync'],
    ['the delegate setup skill', 'delegate', 'lantern-setup'],
    ['a host skill', 'delegate', 'lantern-github'],
    ['a planning skill', 'delegate', 'lantern-plan'],
    ['the reviewer skill for the delegate', 'delegate', 'lantern-code-reviewer'],
    ['the commit skill for the reviewer', 'reviewer', 'lantern-commit'],
    ['anything for the orchestrator', 'orchestrator', 'lantern-sync'],
    ['an unknown name', 'delegate', 'typescript'],
  ])('refuses to switch off %s and writes nothing', (_label, slot, name) => {
    expect(() => writeOff(slot, [name], home)).toThrow();
    expect(fs.existsSync(file())).toBe(false);
  });

  it('refuses a duplicate, an unknown slot and a value that is not a list', () => {
    expect(() => writeOff('delegate', ['lantern-commit', 'lantern-commit'], home)).toThrow();
    expect(() => writeOff('planning', ['lantern-commit'], home)).toThrow();
    expect(() => writeOff('delegate', 'lantern-commit' as never, home)).toThrow();
    expect(fs.existsSync(file())).toBe(false);
  });

  it('drops locked and unknown names stored by hand and keeps the switchable ones', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ off: { delegate: ['lantern-sync', 'lantern-commit', 'mystery'], reviewer: ['lantern-commit', 'lantern-code-reviewer'], orchestrator: ['lantern-sync'] } }));
    expect(readOff(home)).toEqual({ delegate: ['lantern-commit'], orchestrator: [], reviewer: ['lantern-code-reviewer'] });
  });

  it('refuses an off key that is not an object and a slot of it that is not a list', () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify({ off: ['lantern-commit'] }));
    expect(() => readOff(home)).toThrow();
    fs.writeFileSync(file(), JSON.stringify({ off: { delegate: 'lantern-commit' } }));
    expect(() => readOff(home)).toThrow();
  });
});

describe('the switchable skills', () => {
  it('are one constant next to the role lists, all of them bundled and none locked by role', () => {
    expect(bundled.SWITCHABLE_SKILLS).toEqual({ delegate: ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop'], orchestrator: [], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] });
    for (const names of Object.values(bundled.SWITCHABLE_SKILLS) as string[][]) for (const name of names) expect(LOCKED_SKILLS).toContain(name);
    for (const locked of ['lantern-sync', 'lantern-setup', 'lantern-delegate', 'lantern-jira', 'lantern-bitbucket', 'lantern-github']) {
      for (const names of Object.values(bundled.SWITCHABLE_SKILLS) as string[][]) expect(names).not.toContain(locked);
    }
  });

  it('is the one source the app, the panel and the scripts share', () => {
    for (const slot of EXTENSION_SLOTS) {
      expect(bundled.switchableSkills(slot)).toEqual(bundled.SWITCHABLE_SKILLS[slot]);
      expect(bundled.alwaysOnSkills(slot)).toEqual(expect.arrayContaining(bundled.switchableSkills(slot)));
    }
  });

  it('is dropped from the enabled list per role and never touches a locked skill', () => {
    expect(bundled.enabledSkills('delegate', ['lantern-commit', 'lantern-sync'])).toEqual(['lantern-no-comments', 'lantern-local-loop']);
    expect(bundled.enabledSkills('reviewer', ['lantern-code-reviewer', 'lantern-commit'])).toEqual(['lantern-no-comments']);
    expect(bundled.enabledSkills('orchestrator', ['lantern-sync'])).toEqual(['lantern-sync']);
  });
});
