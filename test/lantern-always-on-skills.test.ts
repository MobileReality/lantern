import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadExtensionsPanel } from '../src/main/extensions';
import { slotRows } from '../src/renderer/features/skills-state';
import { EXTENSION_SLOTS } from '../src/shared/extension-slots';
// @ts-expect-error plain ES module, no declarations
import * as bundled from '../skills/lantern-delegate/scripts/bundled-skills.mjs';
// @ts-expect-error plain ES module, no declarations
import * as extensionSkills from '../skills/lantern-delegate/scripts/extension-skills.mjs';
// @ts-expect-error plain ES module, no declarations
import * as required from '../skills/lantern-delegate/scripts/required-skills.mjs';

const PLAN_SKILLS: string[] = required.PLAN_SKILLS;
const GENERIC = ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop'];

let home: string;

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-always-on-')));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const windowRows = (slot: (typeof EXTENSION_SLOTS)[number]) => slotRows(slot, loadExtensionsPanel(PLAN_SKILLS, home)).locked;

describe('the always on list in the window and the scripts agree', () => {
  it('shows every skill a role reads in full as always on', () => {
    for (const slot of EXTENSION_SLOTS) {
      const needed: string[] = required.requiredSkills(slot, [], { plan: true });
      expect(windowRows(slot), slot).toEqual(expect.arrayContaining(needed));
    }
  });

  it('shows the Lantern generic skills for the delegate', () => {
    expect(windowRows('delegate')).toEqual(expect.arrayContaining(GENERIC));
  });

  it('offers only bundled skills and the planning skills, nothing the scripts do not know', () => {
    for (const slot of EXTENSION_SLOTS) {
      const unknown = windowRows(slot).filter((name) => !bundled.BUNDLED_SKILLS.includes(name) && !PLAN_SKILLS.includes(name));
      expect(unknown, slot).toEqual([]);
    }
  });

  it('locks exactly the bundled skills the scripts list', () => {
    expect(loadExtensionsPanel([], home).locked).toEqual(bundled.BUNDLED_SKILLS);
  });

  it('warns, naming each dropped skill, when the scripts read a config that lists one', () => {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), JSON.stringify({ delegate: ['lantern-code-reviewer', 'typescript'] }));
    const { slots, warnings } = extensionSkills.configuredExtras(home);
    expect(slots.delegate).toEqual(['typescript']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('lantern-code-reviewer');
  });
});
