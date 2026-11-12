import { describe, expect, it } from 'vitest';
import { attachedRows, candidateRows, canLinkIntoProject, defaultScope, effectiveExtras, hasProjectScope, isLinkable, linkProblems, nextIndex, otherScope, pickerSkills, roleAfter, roleSummary, skillRowKind, slotRows } from '../src/renderer/features/skills-state';

describe('pickerSkills', () => {
  const none = { locked: ['lantern-commit', 'lantern-sync'] };

  it('without a linker offers the installed skills, minus the locked and lantern-plan names, once each and sorted', () => {
    const installed = ['zod-schemas', 'lantern-commit', 'typescript', 'lantern-plan-review', 'react-spa-forms', 'typescript', 'lantern-sync'];
    expect(pickerSkills({ ...none, installed, skillLinkerState: 'unset' }, ['from-repo'])).toEqual(['react-spa-forms', 'typescript', 'zod-schemas']);
    expect(pickerSkills({ ...none, installed, skillLinkerState: 'invalid' }, ['from-repo'])).toEqual(['react-spa-forms', 'typescript', 'zod-schemas']);
  });

  it('with a valid linker adds the repo skills to the installed ones, still without locked or repeated names', () => {
    const state = { ...none, installed: ['typescript', 'lantern-commit'], skillLinkerState: 'initialized' as const };
    expect(pickerSkills(state, ['alpha', 'typescript', 'lantern-sync', 'lantern-plan'])).toEqual(['alpha', 'typescript']);
  });

  it('is empty when nothing is installed and there is no linker', () => {
    expect(pickerSkills({ ...none, installed: [], skillLinkerState: 'unset' }, ['alpha'])).toEqual([]);
  });
});

const slots = (delegate: string[] = [], orchestrator: string[] = [], reviewer: string[] = []) => ({ delegate, orchestrator, reviewer });

describe('slotRows', () => {
  const installed = ['lantern-plan-x', 'mine', 'other', 'typescript'];
  const alwaysOn = { delegate: ['lantern-commit', 'lantern-setup'], orchestrator: ['lantern-sync', 'lantern-setup'], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] };
  const switchable = { delegate: ['lantern-commit'], orchestrator: [], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] };
  const off = { delegate: ['lantern-commit'], orchestrator: [], reviewer: [] };
  const rows = (slot: 'delegate' | 'orchestrator' | 'reviewer') => slotRows(slot, { alwaysOn, switchable, off, installed });

  it('marks the switchable rows and carries what is switched off, leaving the locked ones plain', () => {
    expect(rows('delegate').switchable).toEqual(['lantern-commit']);
    expect(rows('delegate').off).toEqual(['lantern-commit']);
    expect(rows('delegate').locked).toContain('lantern-setup');
    expect(rows('orchestrator').switchable).toEqual([]);
  });

  it('shows the always on skills of the slot and the installed lantern-plan ones', () => {
    expect(rows('delegate').locked).toEqual(['lantern-commit', 'lantern-setup', 'lantern-plan-x']);
    expect(rows('reviewer').locked).toEqual(['lantern-no-comments', 'lantern-code-reviewer', 'lantern-plan-x']);
  });

  it('keeps the other slot own skills out', () => {
    expect(rows('orchestrator').locked).not.toContain('lantern-commit');
  });
});

const board = (global: string[], project: string[], projectRoot: string | null = '/p', installed = ['a', 'b', 'c', 'typescript', 'lantern-plan-x']) => ({
  slots: slots(global),
  projectSlots: slots(project),
  projectRoot,
  alwaysOn: slots(),
  switchable: slots(),
  off: slots(),
  locked: ['lantern-commit', 'lantern-sync'],
  installed,
  skillLinkerState: 'unset' as const,
});

describe('the merge rule', () => {
  it('lists the global names first, then the project ones, without a repeat', () => {
    expect(effectiveExtras('delegate', board(['a', 'b'], ['c', 'a']))).toEqual(['a', 'b', 'c']);
    expect(effectiveExtras('delegate', board([], ['c']))).toEqual(['c']);
    expect(effectiveExtras('reviewer', board(['a'], ['c']))).toEqual([]);
  });
});

describe('attachedRows', () => {
  it('shows the global rows first, then the project ones, each with its scope and a missing flag', () => {
    expect(attachedRows('delegate', board(['b', 'gone'], ['c']))).toEqual([
      { name: 'b', scope: 'global', missing: false },
      { name: 'gone', scope: 'global', missing: true },
      { name: 'c', scope: 'project', missing: false },
    ]);
  });

  it('shows a name held in both scopes once, as global', () => {
    expect(attachedRows('delegate', board(['a'], ['a', 'b']))).toEqual([
      { name: 'a', scope: 'global', missing: false },
      { name: 'b', scope: 'project', missing: false },
    ]);
  });
});

describe('candidateRows', () => {
  it('lists the attachable skills with the scope each is attached in, and never a locked one until a search names it', () => {
    const state = board(['a'], ['b'], '/p', ['a', 'b', 'c', 'lantern-commit', 'lantern-plan-x']);
    expect(candidateRows('delegate', state, [], '')).toEqual([
      { name: 'a', attached: 'global', locked: false, installed: true },
      { name: 'b', attached: 'project', locked: false, installed: true },
      { name: 'c', attached: null, locked: false, installed: true },
    ]);
    expect(candidateRows('reviewer', state, [], '')).toEqual([
      { name: 'a', attached: null, locked: false, installed: true },
      { name: 'b', attached: null, locked: false, installed: true },
      { name: 'c', attached: null, locked: false, installed: true },
    ]);
  });

  it('filters by the search text, ignoring case, and then explains the built-in names that match', () => {
    const state = board([], [], '/p', ['lantern-extra', 'typescript', 'lantern-plan-x']);
    expect(candidateRows('delegate', state, [], 'SCRIPT')).toEqual([{ name: 'typescript', attached: null, locked: false, installed: true }]);
    expect(candidateRows('delegate', state, [], 'lantern')).toEqual([
      { name: 'lantern-extra', attached: null, locked: false, installed: true },
      { name: 'lantern-commit', attached: null, locked: true, installed: true },
      { name: 'lantern-plan-x', attached: null, locked: true, installed: true },
      { name: 'lantern-sync', attached: null, locked: true, installed: true },
    ]);
    expect(candidateRows('delegate', state, [], 'nothing')).toEqual([]);
  });

  it('adds the repo skills only while the linker is initialized', () => {
    const state = board([], [], '/p', ['a']);
    expect(candidateRows('delegate', state, ['z'], '').map((row) => row.name)).toEqual(['a']);
    expect(candidateRows('delegate', { ...state, skillLinkerState: 'initialized' }, ['z'], '').map((row) => row.name)).toEqual(['a', 'z']);
  });

  it('marks a repo skill that is not installed in the project', () => {
    const state = { ...board([], [], '/p', ['a']), skillLinkerState: 'initialized' as const };
    expect(candidateRows('delegate', state, ['a', 'web-research'], 'web')).toEqual([{ name: 'web-research', attached: null, locked: false, installed: false }]);
    expect(candidateRows('delegate', state, ['a', 'web-research'], 'a').find((row) => row.name === 'a')).toMatchObject({ installed: true });
  });
});

describe('canLinkIntoProject', () => {
  it('needs an open project, a repo skill and a name that is not installed yet', () => {
    expect(canLinkIntoProject('web-research', { projectRoot: '/p', installed: ['a'] }, ['web-research'])).toBe(true);
    expect(canLinkIntoProject('web-research', { projectRoot: '/p', installed: ['web-research'] }, ['web-research'])).toBe(false);
    expect(canLinkIntoProject('web-research', { projectRoot: '/p', installed: [] }, [])).toBe(false);
    expect(canLinkIntoProject('web-research', { projectRoot: null, installed: [] }, ['web-research'])).toBe(false);
  });
});

describe('scope choice', () => {
  it('defaults to this project when one is open and to global otherwise', () => {
    expect(defaultScope({ projectRoot: '/p' })).toBe('project');
    expect(defaultScope({ projectRoot: null })).toBe('global');
    expect(defaultScope({ projectRoot: '/p' }, 'global')).toBe('global');
    expect(defaultScope({ projectRoot: null }, 'project')).toBe('global');
    expect(hasProjectScope({ projectRoot: null })).toBe(false);
    expect(otherScope('global')).toBe('project');
    expect(otherScope('project')).toBe('global');
  });
});

describe('keyboard movement', () => {
  it('moves by one, clamps at both ends and jumps with Home and End', () => {
    expect(nextIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextIndex('ArrowDown', 2, 3)).toBe(2);
    expect(nextIndex('ArrowUp', 0, 3)).toBe(0);
    expect(nextIndex('ArrowUp', 2, 3)).toBe(1);
    expect(nextIndex('Home', 2, 3)).toBe(0);
    expect(nextIndex('End', 0, 3)).toBe(2);
    expect(nextIndex('x', 1, 3)).toBe(1);
    expect(nextIndex('ArrowDown', 0, 0)).toBe(-1);
  });

  it('wraps the role selector in both directions', () => {
    expect(roleAfter('delegate', 'ArrowRight')).toBe('orchestrator');
    expect(roleAfter('reviewer', 'ArrowRight')).toBe('delegate');
    expect(roleAfter('delegate', 'ArrowLeft')).toBe('reviewer');
    expect(roleAfter('orchestrator', 'End')).toBe('reviewer');
    expect(roleAfter('reviewer', 'Home')).toBe('delegate');
    expect(roleAfter('orchestrator', 'x')).toBe('orchestrator');
  });
});

const state = { linked: ['foo'], bundled: ['shipped'], local: ['mine'] };

describe('skillRowKind', () => {
  it('classifies each name by where it is installed', () => {
    expect(skillRowKind('shipped', state)).toBe('bundled');
    expect(skillRowKind('mine', state)).toBe('local');
    expect(skillRowKind('foo', state)).toBe('linked');
    expect(skillRowKind('other', state)).toBe('available');
  });

  it('only offers free names for linking', () => {
    expect(['shipped', 'mine', 'foo', 'other'].filter((n) => isLinkable(n, state))).toEqual(['other']);
  });
});

describe('roleSummary', () => {
  it('counts bundled and linked as installed and keeps bundled out of the actions', () => {
    const res = roleSummary(['shipped', 'foo', 'other', 'mine'], state);
    expect(res).toEqual({ installed: 3, linkable: ['other'], unlinkable: ['foo'] });
  });
});

describe('linkProblems', () => {
  it('names every skipped or failed skill and ignores successes', () => {
    const lines = linkProblems({ a: 'linked', shipped: 'skipped-bundled', b: 'missing-source', c: 'failed' });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('shipped');
    expect(lines[0]).toContain('bundled');
  });

  it('is empty without results', () => {
    expect(linkProblems(undefined)).toEqual([]);
  });
});
