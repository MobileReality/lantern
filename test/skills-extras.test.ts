// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionsPanel } from '../src/main/extensions';
import { mountExtras, mountLinker } from '../src/renderer/features/skills-extras';
import { renderAddSkillStep } from '../src/renderer/features/skills-extras-step';
import { resetBoardUi } from '../src/renderer/features/skills-roles';
import { msg } from '../src/shared/lang/messages';

const INSTALLED = ['alpha', 'beta', 'mine', 'other', 'typescript'];
const LOCKED = ['lantern-commit', 'lantern-sync'];
const SLOT_NAMES = ['delegate', 'orchestrator', 'reviewer'] as const;

type Slots = Record<(typeof SLOT_NAMES)[number], string[]>;

interface World {
  global?: Partial<Slots>;
  project?: Partial<Slots>;
  projectRoot?: string | null;
  refuse?: string;
  projectError?: string | null;
  linker?: string | null;
  linkerState?: 'initialized' | 'invalid';
  installed?: string[];
}

const slotsOf = (given: Partial<Slots> = {}): Slots => ({ delegate: [], orchestrator: [], reviewer: [], ...given });

function fakeIpc(world: World = {}) {
  let global = slotsOf(world.global);
  let project = slotsOf(world.project);
  let skillLinker = world.linker ?? null;
  let off: Record<string, string[]> = { delegate: [], orchestrator: [], reviewer: [] };
  const projectRoot = world.projectRoot === undefined ? '/p' : world.projectRoot;
  const panel = (error: string | null = null): ExtensionsPanel => ({
    slots: global,
    projectSlots: project,
    projectRoot,
    projectError: world.projectError ?? null,
    alwaysOn: { delegate: ['lantern-commit', 'lantern-setup'], orchestrator: ['lantern-sync'], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] },
    switchable: { delegate: ['lantern-commit'], orchestrator: [], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] },
    off: off as ExtensionsPanel['off'],
    locked: LOCKED,
    installed: world.installed ?? INSTALLED,
    skillLinker,
    skillLinkerState: skillLinker ? (world.linkerState ?? 'initialized') : 'unset',
    skillLinkerProblem: null,
    skillLinkerPath: null,
    skillLinkerFromRepo: false,
    skillLinkerSkills: 0,
    skillLinkerRoles: 0,
    error,
  });
  const write = (slot: string, names: string[], scope: string) => {
    if (scope === 'project') project = { ...project, [slot]: names };
    else global = { ...global, [slot]: names };
  };
  window.ccmws = {
    extensionsLoad: vi.fn(async () => panel()),
    extensionsSave: vi.fn(async (_project: string | null, slot: string, names: string[], nextOff?: string[], scope = 'global') => {
      if (world.refuse) return panel(world.refuse);
      if (nextOff) off = { ...off, [slot]: nextOff };
      write(slot, names, scope);
      return panel();
    }),
    extensionsMove: vi.fn(async (_project: string | null, slot: string, name: string, from: string, to: string) => {
      if (world.refuse) return panel(world.refuse);
      const lists = { global: global[slot as keyof Slots], project: project[slot as keyof Slots] };
      write(slot, [...new Set([...lists[to as 'global' | 'project'], name])], to);
      write(slot, lists[from as 'global' | 'project'].filter((taken) => taken !== name), from);
      return panel();
    }),
    extensionsCreate: vi.fn(async (_project: string | null, slot: string, name: string, _content: string, scope = 'global') => {
      if (world.refuse) return panel(world.refuse);
      write(slot, [...(scope === 'project' ? project : global)[slot as keyof Slots], name], scope);
      return panel();
    }),
    extensionsSkillLinker: vi.fn(async (_project: string | null, value: string | null) => {
      if (world.refuse) return panel(world.refuse);
      skillLinker = value;
      return panel();
    }),
    extensionsImport: vi.fn(async () => {
      if (world.refuse) return panel(world.refuse);
      global = { ...global, delegate: [...new Set([...global.delegate, 'typescript'])], orchestrator: ['other'] };
      skillLinker = '/imported/skillLinker';
      return panel();
    }),
  } as unknown as typeof window.ccmws;
  return panel;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const press = (target: Element, key: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

let host: HTMLElement;
let addSkill: ReturnType<typeof vi.fn>;

const q = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
const all = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const attachedNames = () => all('[data-extra]').map((row) => row.dataset.extra);
const pickNames = () => all('[data-pick]').map((row) => row.dataset.pick);
const role = (slot: string) => q(`[data-segment="${slot}"]`);
const scopeOption = (scope: string) => q(`.sk-scope-pick [data-segment="${scope}"]`);
const pick = (name: string) => q(`[data-pick="${name}"]`);
const extra = (name: string) => q(`[data-extra="${name}"]`);
const search = () => q<HTMLInputElement>('[data-pick-search]');
const type = (text: string) => {
  search().value = text;
  search().dispatchEvent(new Event('input', { bubbles: true }));
};

async function mount(world: World = {}, repo: string[] = [], project: string | null = '/p') {
  fakeIpc(world);
  await mountExtras(host, project, addSkill, repo);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById('host')!;
  addSkill = vi.fn();
  resetBoardUi();
});

describe('Role selector', () => {
  it('is a radio group of Delegate, Orchestrator and Reviewer with Delegate chosen and the attached count on each', async () => {
    await mount({ global: { delegate: ['mine'] }, project: { delegate: ['other', 'mine'], reviewer: ['beta'] } });
    expect(q('[role="radiogroup"]').getAttribute('aria-label')).toBe(msg('skillsExtras.roles.label'));
    expect(all('.sk-roles [role="radio"]').map((radio) => radio.dataset.segment)).toEqual(['delegate', 'orchestrator', 'reviewer']);
    expect(all('.sk-roles [role="radio"]').map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(all('.sk-roles .sk-seg-count').map((count) => count.textContent)).toEqual(['2', '0', '1']);
    expect(q('.sk-roles [aria-checked="true"]').textContent).toContain('Delegate');
    expect(q('[data-board]').dataset.board).toBe('delegate');
  });

  it('shows the attached skills of the chosen role on the left and the add list for it on the right', async () => {
    await mount({ global: { delegate: ['mine'], reviewer: ['alpha'] } });
    expect(q('[data-col="attached"] .sk-col-title').textContent).toBe(msg('skillsExtras.attached.title', { role: 'Delegate' }));
    expect(attachedNames()).toEqual(['mine']);
    role('reviewer').click();
    expect(q('[data-col="attached"] .sk-col-title').textContent).toBe(msg('skillsExtras.attached.title', { role: 'Reviewer' }));
    expect(q('[data-col="candidates"] .sk-col-title').textContent).toBe(msg('skillsExtras.attach.title', { role: 'Reviewer' }));
    expect(attachedNames()).toEqual(['alpha']);
    expect(q('.sk-board-note').textContent).toBe(msg('skillsExtras.roles.hint.reviewer'));
    expect(role('reviewer').getAttribute('aria-checked')).toBe('true');
    expect(all('[data-slot]').map((node) => node.dataset.slot)).toEqual(['reviewer']);
  });

  it('keeps the chosen role when the panel redraws after a change', async () => {
    await mount();
    role('orchestrator').click();
    pick('alpha').click();
    await settled();
    expect(role('orchestrator').getAttribute('aria-checked')).toBe('true');
    expect(attachedNames()).toEqual(['alpha']);
  });

  it('moves the choice with the arrow keys, wraps, and keeps the focus on the chosen option', async () => {
    await mount();
    role('delegate').focus();
    press(role('delegate'), 'ArrowRight');
    expect(role('orchestrator').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(role('orchestrator'));
    press(role('orchestrator'), 'End');
    expect(document.activeElement).toBe(role('reviewer'));
    press(role('reviewer'), 'ArrowRight');
    expect(role('delegate').getAttribute('aria-checked')).toBe('true');
    press(role('delegate'), 'ArrowLeft');
    expect(role('reviewer').getAttribute('aria-checked')).toBe('true');
    press(role('reviewer'), 'Home');
    expect(role('delegate').getAttribute('aria-checked')).toBe('true');
  });

  it('has exactly one tab stop in the selector, on the chosen option', async () => {
    await mount();
    expect(all('.sk-roles [role="radio"]').map((radio) => (radio as HTMLButtonElement).tabIndex)).toEqual([0, -1, -1]);
  });
});

describe('Attached list', () => {
  it('shows each skill with its scope, global ones first, and a warning for one that is not installed', async () => {
    await mount({ global: { delegate: ['mine', 'gone'] }, project: { delegate: ['other'] } });
    expect(attachedNames()).toEqual(['mine', 'gone', 'other']);
    expect(all('[data-extra] .sk-scope').map((badge) => badge.textContent)).toEqual(['Global', 'Global', 'This project']);
    expect(extra('gone').textContent).toContain(msg('skillsExtras.attached.notInstalled'));
    expect(extra('gone').querySelector('[role="status"]')).not.toBeNull();
    expect(extra('mine').textContent).not.toContain(msg('skillsExtras.attached.notInstalled'));
    expect(q('[data-col="attached"] .sk-count').textContent).toBe('3');
  });

  it('shows a name held in both scopes once', async () => {
    await mount({ global: { delegate: ['mine'] }, project: { delegate: ['mine', 'other'] } });
    expect(attachedNames()).toEqual(['mine', 'other']);
    expect(extra('mine').dataset.attachedScope).toBe('global');
  });

  it('says what to do when a role has nothing attached', async () => {
    await mount();
    expect(attachedNames()).toEqual([]);
    expect(q('[data-col="attached"] .sk-empty').textContent).toBe(msg('skillsExtras.attached.empty', { role: 'Delegate' }));
  });

  it('detaches with the Detach button, from the scope the row is in', async () => {
    await mount({ global: { delegate: ['mine'] }, project: { delegate: ['other'] } });
    q<HTMLButtonElement>('[data-detach="other"]').click();
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', [], undefined, 'project');
    expect(attachedNames()).toEqual(['mine']);
    q<HTMLButtonElement>('[data-detach="mine"]').click();
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', [], undefined, 'global');
    expect(attachedNames()).toEqual([]);
  });

  it.each(['Delete', 'Backspace'])('detaches the focused row with %s and moves the focus to the next one', async (key) => {
    await mount({ global: { delegate: ['alpha', 'beta', 'mine'] } });
    extra('beta').focus();
    press(extra('beta'), key);
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', ['alpha', 'mine'], undefined, 'global');
    expect(attachedNames()).toEqual(['alpha', 'mine']);
    expect(document.activeElement).toBe(extra('mine'));
  });

  it('moves the focus to the previous row when the last one is detached, and to the search when none is left', async () => {
    await mount({ global: { delegate: ['alpha', 'beta'] } });
    extra('beta').focus();
    press(extra('beta'), 'Delete');
    await settled();
    expect(document.activeElement).toBe(extra('alpha'));
    press(extra('alpha'), 'Delete');
    await settled();
    expect(document.activeElement).toBe(search());
  });

  it('walks the rows with the arrows, Home and End and has one tab stop', async () => {
    await mount({ global: { delegate: ['alpha', 'beta', 'mine'] } });
    expect(all('[data-extra]').map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    extra('alpha').focus();
    press(extra('alpha'), 'ArrowDown');
    expect(document.activeElement).toBe(extra('beta'));
    expect(all('[data-extra]').map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
    press(extra('beta'), 'End');
    expect(document.activeElement).toBe(extra('mine'));
    press(extra('mine'), 'ArrowDown');
    expect(document.activeElement).toBe(extra('mine'));
    press(extra('mine'), 'Home');
    expect(document.activeElement).toBe(extra('alpha'));
    press(extra('alpha'), 'ArrowUp');
    expect(document.activeElement).toBe(extra('alpha'));
  });

  it('describes the keys and exposes the row to assistive technology', async () => {
    await mount({ global: { delegate: ['alpha'] } });
    expect(q('[role="list"]').getAttribute('aria-label')).toBe(msg('skillsExtras.attached.list', { role: 'Delegate' }));
    expect(extra('alpha').getAttribute('role')).toBe('listitem');
    expect(extra('alpha').getAttribute('aria-keyshortcuts')).toBe('Delete Backspace');
    expect(q('[data-detach="alpha"]').getAttribute('aria-label')).toBe(msg('skillsExtras.attached.detachLabel', { name: 'alpha', role: 'Delegate' }));
    expect(q('[data-col="attached"] .sk-col-hint').textContent).toBe(msg('skillsExtras.attached.hint'));
  });
});

describe('Scope', () => {
  it('moves a skill to the other scope with the badge, through the one move call', async () => {
    await mount({ global: { delegate: ['mine'] }, project: { delegate: ['other'] } });
    q<HTMLButtonElement>('[data-extra="mine"] .sk-scope').click();
    await settled();
    expect(window.ccmws.extensionsMove).toHaveBeenLastCalledWith('/p', 'delegate', 'mine', 'global', 'project');
    expect(extra('mine').dataset.attachedScope).toBe('project');
    q<HTMLButtonElement>('[data-extra="other"] .sk-scope').click();
    await settled();
    expect(window.ccmws.extensionsMove).toHaveBeenLastCalledWith('/p', 'delegate', 'other', 'project', 'global');
    expect(attachedNames()).toEqual(['other', 'mine']);
    expect(q('[data-extra="mine"] .sk-scope').getAttribute('aria-label')).toBe(msg('skillsExtras.scope.moveLabel', { name: 'mine', scope: 'This project', other: 'Global' }));
  });

  it('moves the focused row with Enter and keeps the focus on it', async () => {
    await mount({ global: { delegate: ['mine'] } });
    extra('mine').focus();
    press(extra('mine'), 'Enter');
    await settled();
    expect(window.ccmws.extensionsMove).toHaveBeenLastCalledWith('/p', 'delegate', 'mine', 'global', 'project');
    expect(document.activeElement).toBe(extra('mine'));
  });

  it('offers the global scope only, with no badge and no toggle, when no project is open', async () => {
    await mount({ global: { delegate: ['mine'] }, projectRoot: null }, [], null);
    expect(all('.sk-scope')).toHaveLength(0);
    expect(all('.sk-scope-pick')).toHaveLength(0);
    expect(q('[data-col="attached"] .sk-col-hint').textContent).toBe(msg('skillsExtras.attached.hintGlobal'));
    extra('mine').focus();
    press(extra('mine'), 'Enter');
    expect(window.ccmws.extensionsMove).not.toHaveBeenCalled();
    pick('alpha').click();
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith(null, 'delegate', ['mine', 'alpha'], undefined, 'global');
  });

  it('attaches to this project by default when a project is open and offers both scopes as a radio group', async () => {
    await mount();
    expect(q('.sk-scope-pick').getAttribute('role')).toBe('radiogroup');
    expect(all('.sk-scope-pick [role="radio"]').map((option) => option.textContent)).toEqual(['Global', 'This project']);
    expect(scopeOption('project').getAttribute('aria-checked')).toBe('true');
    pick('alpha').click();
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', ['alpha'], undefined, 'project');
    expect(extra('alpha').dataset.attachedScope).toBe('project');
  });

  it('attaches globally once Global is chosen, keeps the choice, and appends to the global list', async () => {
    await mount({ global: { delegate: ['mine'] }, project: { delegate: ['other'] } });
    scopeOption('global').click();
    expect(scopeOption('global').getAttribute('aria-checked')).toBe('true');
    pick('alpha').click();
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', ['mine', 'alpha'], undefined, 'global');
    expect(scopeOption('global').getAttribute('aria-checked')).toBe('true');
    expect(extra('alpha').dataset.attachedScope).toBe('global');
    expect(pick('beta').getAttribute('aria-label')).toBe(msg('skillsExtras.attach.label', { name: 'beta', role: 'Delegate', scope: 'Global' }));
  });

  it('moves the scope choice with the arrow keys and labels the toggle', async () => {
    await mount();
    expect(q('.sk-scope-pick').getAttribute('aria-label')).toBe(msg('skillsExtras.scope.attachAs'));
    scopeOption('project').focus();
    press(scopeOption('project'), 'ArrowLeft');
    expect(scopeOption('global').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(scopeOption('global'));
  });
});

describe('Add list', () => {
  it('lists the installed skills sorted, with the ones already attached marked and disabled, in the scope they hold', async () => {
    await mount({ global: { delegate: ['mine'] }, project: { delegate: ['other'] } });
    expect(pickNames()).toEqual(INSTALLED);
    expect(pick('mine').getAttribute('aria-disabled')).toBe('true');
    expect(pick('mine').textContent).toContain(msg('skillsExtras.attach.attachedAs', { scope: 'Global' }));
    expect(pick('other').textContent).toContain(msg('skillsExtras.attach.attachedAs', { scope: 'This project' }));
    expect(pick('alpha').getAttribute('aria-disabled')).toBeNull();
    expect(pick('alpha').textContent).toContain(msg('skillsExtras.attach.action'));
  });

  it('marks attachment per role', async () => {
    await mount({ global: { delegate: ['mine'] } });
    role('reviewer').click();
    expect(pick('mine').getAttribute('aria-disabled')).toBeNull();
  });

  it('does nothing when an attached skill is pressed', async () => {
    await mount({ global: { delegate: ['mine'] } });
    pick('mine').click();
    await settled();
    expect(window.ccmws.extensionsSave).not.toHaveBeenCalled();
  });

  it('adds the repo skills when the linker is valid, once each and sorted with the installed ones', async () => {
    await mount({ linker: '/opt/repo/linker' }, ['alpha', 'zeta', 'mine']);
    expect(pickNames()).toEqual(['alpha', 'beta', 'mine', 'other', 'typescript', 'zeta']);
  });

  it('offers the installed skills only without a linker or with an invalid one', async () => {
    await mount({}, ['zeta']);
    expect(pickNames()).toEqual(INSTALLED);
    await mount({ linker: '/opt/repo', linkerState: 'invalid' }, ['zeta']);
    expect(pickNames()).toEqual(INSTALLED);
  });

  it('never lists a locked or lantern-plan skill, even though it is installed', async () => {
    await mount({ installed: ['lantern-commit', 'lantern-plan-review', 'typescript', 'zod-schemas'] });
    expect(pickNames()).toEqual(['typescript', 'zod-schemas']);
  });

  it('says so when nothing is installed', async () => {
    await mount({ installed: [] });
    expect(q('[data-col="candidates"] .sk-empty').textContent).toBe(msg('skillsExtras.attach.none'));
  });

  it('labels each row with what pressing it does', async () => {
    await mount({ global: { delegate: ['mine'] } });
    expect(pick('alpha').getAttribute('aria-label')).toBe(msg('skillsExtras.attach.label', { name: 'alpha', role: 'Delegate', scope: 'This project' }));
    expect(pick('mine').getAttribute('aria-label')).toBe(msg('skillsExtras.attach.attachedLabel', { name: 'mine', role: 'Delegate', scope: 'Global' }));
    expect(q('[data-col="candidates"] [role="group"]').getAttribute('aria-label')).toBe(msg('skillsExtras.attach.list', { role: 'Delegate' }));
  });

  it('shows no scope word on a row when no project is open', async () => {
    await mount({ global: { delegate: ['mine'] }, projectRoot: null }, [], null);
    expect(pick('mine').textContent).toContain(msg('skillsExtras.attach.attachedPlain'));
    expect(pick('mine').textContent).not.toContain('Global');
    expect(pick('alpha').getAttribute('aria-label')).toBe(msg('skillsExtras.attach.labelPlain', { name: 'alpha', role: 'Delegate' }));
  });
});

describe('Skills of the linker catalogue that are not installed in the project', () => {
  const REPO = ['alpha', 'web-research', 'web-search'];
  let linked: ReturnType<typeof vi.fn>;

  async function mountLinked(world: World = {}, linkResult: string = 'linked') {
    const state: World = { linker: '/opt/repo/linker', ...world };
    fakeIpc(state);
    linked = vi.fn();
    window.ccmws.skillsLink = vi.fn(async (_project: string, names: string[]) => {
      if (linkResult === 'linked') state.installed = [...(state.installed ?? INSTALLED), ...names];
      return { linkResults: Object.fromEntries(names.map((name) => [name, linkResult])) };
    }) as unknown as typeof window.ccmws.skillsLink;
    await mountExtras(host, state.projectRoot === null ? null : '/p', addSkill, REPO, { linked });
  }

  it('marks the repo skills that are not installed and says that attaching also links them', async () => {
    await mountLinked();
    expect(pickNames()).toEqual(['alpha', 'beta', 'mine', 'other', 'typescript', 'web-research', 'web-search']);
    expect(pick('web-research').textContent).toContain(msg('skillsExtras.attached.notInstalled'));
    expect(pick('web-research').textContent).toContain(msg('skillsExtras.attach.actionLink'));
    expect(pick('web-research').getAttribute('aria-label')).toBe(msg('skillsExtras.attach.labelLink', { name: 'web-research', role: 'Delegate', scope: 'This project' }));
    expect(pick('alpha').textContent).not.toContain(msg('skillsExtras.attached.notInstalled'));
    expect(pick('alpha').textContent).toContain(msg('skillsExtras.attach.action'));
  });

  it('links the skill into the project first and then attaches it', async () => {
    await mountLinked();
    pick('web-research').click();
    await settled();
    await settled();
    expect(window.ccmws.skillsLink).toHaveBeenCalledWith('/p', ['web-research']);
    expect(window.ccmws.extensionsSave).toHaveBeenCalledWith('/p', 'delegate', ['web-research'], undefined, 'project');
    expect(vi.mocked(window.ccmws.skillsLink).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(window.ccmws.extensionsSave).mock.invocationCallOrder[0]);
    expect(linked).toHaveBeenCalledTimes(1);
    expect(extra('web-research').textContent).not.toContain(msg('skillsExtras.attached.notInstalled'));
    expect(q('.sk-live').textContent).toBe(msg('skillsExtras.announce.attachedLinked', { name: 'web-research', role: 'Delegate', scope: 'This project' }));
  });

  it('attaches the first match of the search with Enter and links it too', async () => {
    await mountLinked();
    type('web');
    press(search(), 'Enter');
    await settled();
    await settled();
    expect(window.ccmws.skillsLink).toHaveBeenCalledWith('/p', ['web-research']);
    expect(attachedNames()).toEqual(['web-research']);
  });

  it('attaches nothing and says why when the skill cannot be linked', async () => {
    await mountLinked({}, 'missing-source');
    pick('web-research').click();
    await settled();
    await settled();
    expect(window.ccmws.extensionsSave).not.toHaveBeenCalled();
    expect(attachedNames()).toEqual([]);
    expect(q('[role="alert"]').textContent).toBe(msg('skillsExtras.linkFailed', { name: 'web-research', reason: 'web-research was not found in the skills repo.' }));
  });

  it('does not link an installed skill when it is attached', async () => {
    await mountLinked();
    pick('alpha').click();
    await settled();
    expect(window.ccmws.skillsLink).not.toHaveBeenCalled();
    expect(attachedNames()).toEqual(['alpha']);
  });

  it('offers Link to project on an attached skill that is not installed and links it without changing the attachment', async () => {
    await mountLinked({ global: { delegate: ['web-research', 'retired'] }, installed: INSTALLED });
    expect(extra('web-research').textContent).toContain(msg('skillsExtras.attached.notInstalled'));
    expect(extra('web-research').querySelector('[data-link]')!.textContent).toBe(msg('skillsExtras.attached.link'));
    expect(extra('retired').querySelector('[data-link]')).toBeNull();
    extra('web-research').querySelector<HTMLButtonElement>('[data-link]')!.click();
    await settled();
    await settled();
    expect(window.ccmws.skillsLink).toHaveBeenCalledWith('/p', ['web-research']);
    expect(window.ccmws.extensionsSave).not.toHaveBeenCalled();
    expect(extra('web-research').textContent).not.toContain(msg('skillsExtras.attached.notInstalled'));
    expect(extra('web-research').querySelector('[data-link]')).toBeNull();
    expect(extra('retired').textContent).toContain(msg('skillsExtras.attached.notInstalled'));
    expect(q('.sk-live').textContent).toBe(msg('skillsExtras.announce.linked', { name: 'web-research' }));
  });

  it('keeps the row and shows the reason when the link fails', async () => {
    await mountLinked({ global: { delegate: ['web-research'] } }, 'skipped-local');
    extra('web-research').querySelector<HTMLButtonElement>('[data-link]')!.click();
    await settled();
    await settled();
    expect(q('[role="alert"]').textContent).toContain('is a local folder');
    expect(extra('web-research').textContent).toContain(msg('skillsExtras.attached.notInstalled'));
  });

  it('only attaches, and offers no link, when no project is open', async () => {
    await mountLinked({ global: { delegate: ['web-research'] }, projectRoot: null });
    expect(extra('web-research').querySelector('[data-link]')).toBeNull();
    expect(pick('web-search').getAttribute('aria-label')).toBe(msg('skillsExtras.attach.labelPlain', { name: 'web-search', role: 'Delegate' }));
    pick('web-search').click();
    await settled();
    expect(window.ccmws.skillsLink).not.toHaveBeenCalled();
    expect(window.ccmws.extensionsSave).toHaveBeenCalled();
  });
});

describe('Search', () => {
  it('filters the add list while typing, ignoring case, and says when nothing matches', async () => {
    await mount();
    type('BET');
    expect(pickNames()).toEqual(['beta']);
    type('nope');
    expect(pickNames()).toEqual([]);
    expect(q('[data-col="candidates"] .sk-empty').textContent).toBe(msg('skillsExtras.attach.noMatch', { query: 'nope' }));
    type('');
    expect(pickNames()).toEqual(INSTALLED);
  });

  it('explains a built-in skill that the search names and never lets it be attached', async () => {
    await mount({ installed: ['lantern-extra', 'lantern-commit', 'typescript'] });
    type('lantern');
    expect(pickNames()).toEqual(['lantern-extra', 'lantern-commit', 'lantern-sync']);
    expect(pick('lantern-commit').getAttribute('aria-disabled')).toBe('true');
    expect(pick('lantern-commit').textContent).toContain(msg('skillsExtras.attach.builtIn'));
    expect(pick('lantern-commit').dataset.tip).toBe(msg('skillsExtras.attach.builtInTip'));
    pick('lantern-commit').click();
    await settled();
    expect(window.ccmws.extensionsSave).not.toHaveBeenCalled();
    expect(q('[data-col="candidates"] .sk-col-hint').textContent).toBe(msg('skillsExtras.attach.builtInNote'));
  });

  it('keeps the text and the filtering through an attach and through a role change', async () => {
    await mount();
    type('bet');
    pick('beta').click();
    await settled();
    expect(search().value).toBe('bet');
    expect(pickNames()).toEqual(['beta']);
    role('reviewer').click();
    expect(search().value).toBe('bet');
  });

  it('attaches the first match with Enter, in the chosen scope, and keeps the focus in the search', async () => {
    await mount();
    search().focus();
    type('t');
    press(search(), 'Enter');
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', ['beta'], undefined, 'project');
    expect(attachedNames()).toEqual(['beta']);
    expect(document.activeElement).toBe(search());
    expect(search().value).toBe('t');
    press(search(), 'Enter');
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', ['beta', 'other'], undefined, 'project');
  });

  it('skips attached and built-in rows when Enter picks the first match, and ignores Enter with no text or no match', async () => {
    await mount({ global: { delegate: ['alpha'] } });
    search().focus();
    press(search(), 'Enter');
    type('a');
    press(search(), 'Enter');
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', ['beta'], undefined, 'project');
    window.ccmws.extensionsSave = vi.fn() as unknown as typeof window.ccmws.extensionsSave;
    type('zzz');
    press(search(), 'Enter');
    expect(window.ccmws.extensionsSave).not.toHaveBeenCalled();
  });

  it('clears the text with Escape without closing anything, and lets Escape through when it is empty', async () => {
    await mount();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    type('bet');
    press(search(), 'Escape');
    expect(search().value).toBe('');
    expect(pickNames()).toEqual(INSTALLED);
    expect(seen).not.toHaveBeenCalled();
    press(search(), 'Escape');
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', seen);
  });

  it('focuses the search with / and with Ctrl+F or Cmd+F, from anywhere in the view', async () => {
    await mount();
    q('.sk-roles [aria-checked="true"]').focus();
    const slash = press(document.activeElement!, '/');
    expect(slash).toBe(false);
    expect(document.activeElement).toBe(search());
    q('.sk-roles [aria-checked="true"]').focus();
    press(document.activeElement!, 'f', { ctrlKey: true });
    expect(document.activeElement).toBe(search());
    q('.sk-roles [aria-checked="true"]').focus();
    press(document.activeElement!, 'F', { metaKey: true });
    expect(document.activeElement).toBe(search());
  });

  it('types a slash into the search instead of jumping, and ignores / while the view is hidden', async () => {
    await mount();
    search().focus();
    expect(press(search(), '/')).toBe(true);
    document.body.innerHTML = `<div class="hidden" id="wrap"></div>`;
    host = document.getElementById('wrap')!;
    await mount();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    press(outside, '/');
    expect(document.activeElement).toBe(outside);
  });

  it('walks from the search into the list with ArrowDown, down the rows, and back with ArrowUp from the first row', async () => {
    await mount();
    search().focus();
    press(search(), 'ArrowDown');
    expect(document.activeElement).toBe(pick('alpha'));
    press(pick('alpha'), 'ArrowDown');
    expect(document.activeElement).toBe(pick('beta'));
    press(pick('beta'), 'End');
    expect(document.activeElement).toBe(pick('typescript'));
    press(pick('typescript'), 'Home');
    expect(document.activeElement).toBe(pick('alpha'));
    press(pick('alpha'), 'ArrowUp');
    expect(document.activeElement).toBe(search());
  });

  it('attaches the focused row with Enter and keeps the focus on that row', async () => {
    await mount();
    pick('beta').focus();
    pick('beta').click();
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', ['beta'], undefined, 'project');
    expect(document.activeElement).toBe(pick('beta'));
  });

  it('has one tab stop in the list', async () => {
    await mount();
    expect(all('[data-pick]').map((row) => (row as HTMLButtonElement).tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });
});

describe('Built-in skills', () => {
  const switchRow = (name: string) => q(`[data-switch="${name}"]`);

  it('keeps them in a closed disclosure that opens with a button and says how many there are', async () => {
    await mount();
    const toggle = q('[data-builtin-toggle]');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain(msg('skillsExtras.builtIn.toggle', { count: 2 }));
    expect(q('.sk-builtin-body').hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(q('.sk-builtin-body').hidden).toBe(false);
    expect(q('.sk-builtin-body').getAttribute('aria-label')).toBe(msg('skillsExtras.builtIn.label', { role: 'Delegate' }));
  });

  it('turns the switchable ones into switches and leaves the locked ones with a tooltip and no switch', async () => {
    await mount();
    q('[data-builtin-toggle]').click();
    const commit = switchRow('lantern-commit');
    expect(commit.getAttribute('role')).toBe('switch');
    expect(commit.getAttribute('aria-checked')).toBe('true');
    expect(commit.dataset.tip).toBe(msg('skillsExtras.switchTip'));
    const locked = all('.sk-builtin-body .locked');
    expect(locked.map((row) => row.querySelector('.sk-name')!.textContent)).toEqual(['lantern-setup']);
    expect(locked[0].dataset.tip).toBe(msg('skillsExtras.lockedTip'));
    expect(locked[0].getAttribute('aria-disabled')).toBe('true');
    role('orchestrator').click();
    expect(all('[data-switch]')).toHaveLength(0);
    expect(all('.sk-builtin-body .locked .sk-name').map((node) => node.textContent)).toEqual(['lantern-sync']);
  });

  it('switches a skill off through the one save with the global extras, in the global scope, and shows it off', async () => {
    await mount({ global: { delegate: ['mine'] }, project: { delegate: ['other'] } });
    q('[data-builtin-toggle]').click();
    switchRow('lantern-commit').click();
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'delegate', ['mine'], ['lantern-commit'], 'global');
    const row = switchRow('lantern-commit');
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(row.textContent).toContain(msg('skillsExtras.off'));
    expect(q('[data-builtin-toggle]').getAttribute('aria-expanded')).toBe('true');
  });

  it('switches back on with the keyboard and keeps the other switch of a role', async () => {
    await mount();
    role('reviewer').click();
    q('[data-builtin-toggle]').click();
    switchRow('lantern-no-comments').click();
    await settled();
    q('[data-builtin-toggle]').click();
    press(switchRow('lantern-code-reviewer'), 'Enter');
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'reviewer', [], ['lantern-no-comments', 'lantern-code-reviewer'], 'global');
    press(switchRow('lantern-code-reviewer'), ' ');
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenLastCalledWith('/p', 'reviewer', [], ['lantern-no-comments'], 'global');
  });
});

describe('Errors and busy state', () => {
  it('shows the message of a refused write', async () => {
    await mount({ refuse: 'lantern-sync is always on, so it cannot be an extra.' });
    pick('alpha').click();
    await settled();
    expect(q('[role="alert"]').textContent).toBe('lantern-sync is always on, so it cannot be an extra.');
    expect(attachedNames()).toEqual([]);
  });

  it('names a damaged project file in an alert of its own and keeps the global list', async () => {
    await mount({ global: { delegate: ['mine'] }, projectError: '/p/.claude/lantern-extensions.json is not valid JSON: Unexpected token' });
    expect(q('[role="alert"]').textContent).toContain('/p/.claude/lantern-extensions.json');
    expect(attachedNames()).toEqual(['mine']);
  });

  it('shows the error of a rejected save and keeps the view usable', async () => {
    await mount({ global: { delegate: ['mine'] } });
    window.ccmws.extensionsSave = vi.fn(async () => {
      throw new Error('disk full');
    }) as unknown as typeof window.ccmws.extensionsSave;
    q<HTMLButtonElement>('[data-detach="mine"]').click();
    await settled();
    expect(q('[role="alert"]').textContent).toBe(msg('skillsExtras.saveFailed', { reason: 'disk full' }));
    expect(q('[data-add-skill]')).not.toBeNull();
  });

  it('ignores a second press while a save is in flight', async () => {
    await mount({ global: { delegate: ['mine'] } });
    let release: (panel: ExtensionsPanel) => void = () => {};
    window.ccmws.extensionsSave = vi.fn(
      () =>
        new Promise<ExtensionsPanel>((resolve) => {
          release = resolve;
        }),
    ) as unknown as typeof window.ccmws.extensionsSave;
    q<HTMLButtonElement>('[data-detach="mine"]').click();
    q<HTMLButtonElement>('[data-detach="mine"]').click();
    q<HTMLButtonElement>('[data-import="list"]').click();
    expect(window.ccmws.extensionsSave).toHaveBeenCalledTimes(1);
    expect(window.ccmws.extensionsImport).not.toHaveBeenCalled();
    release(await window.ccmws.extensionsLoad('/p'));
    await settled();
    q<HTMLButtonElement>('[data-import="list"]').click();
    await settled();
    expect(window.ccmws.extensionsImport).toHaveBeenCalledTimes(1);
  });

  it('announces what changed in a polite live region', async () => {
    await mount();
    pick('alpha').click();
    await settled();
    const live = q('.sk-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe(msg('skillsExtras.announce.attached', { name: 'alpha', role: 'Delegate', scope: 'This project' }));
    q<HTMLButtonElement>('[data-detach="alpha"]').click();
    await settled();
    expect(live.textContent).toBe(msg('skillsExtras.announce.detached', { name: 'alpha', role: 'Delegate' }));
  });

  it('says nothing after a refused change', async () => {
    await mount({ refuse: 'no' });
    pick('alpha').click();
    await settled();
    expect(q('.sk-live').textContent).toBe('');
  });

  it('shows a load failure instead of the view', async () => {
    window.ccmws = { extensionsLoad: vi.fn(async () => Promise.reject(new Error('no'))) } as unknown as typeof window.ccmws;
    await mountExtras(host, '/p', addSkill);
    expect(q('.sk-set-err').textContent).toBe(msg('skillsExtras.loadFailed'));
  });
});

describe('Add skill and Import list', () => {
  it('has one Add skill button for the chosen role and hands the request to the opener', async () => {
    await mount({ global: { delegate: ['mine'] }, project: { delegate: ['other'] } });
    expect(all('[data-add-skill]')).toHaveLength(1);
    expect(q('[data-add-skill]').textContent).toBe(msg('skillsExtras.addSkill'));
    expect(q('[data-add-skill]').getAttribute('aria-label')).toBe(msg('skillsExtras.addSkillLabel', { slot: 'Delegate' }));
    q('[data-add-skill]').click();
    expect(addSkill).toHaveBeenLastCalledWith({ slot: 'delegate', taken: ['mine', 'other'], locked: LOCKED, scope: 'project', scoped: true });
    role('reviewer').click();
    scopeOption('global').click();
    q('[data-add-skill]').click();
    expect(addSkill).toHaveBeenLastCalledWith({ slot: 'reviewer', taken: [], locked: LOCKED, scope: 'global', scoped: true });
    expect(window.ccmws.extensionsSave).not.toHaveBeenCalled();
  });

  it('asks for the global scope only when no project is open', async () => {
    await mount({ projectRoot: null }, [], null);
    q('[data-add-skill]').click();
    expect(addSkill).toHaveBeenLastCalledWith({ slot: 'delegate', taken: [], locked: LOCKED, scope: 'global', scoped: false });
  });

  it('imports a list only when the button is pressed and shows what it added', async () => {
    await mount();
    expect(window.ccmws.extensionsImport).not.toHaveBeenCalled();
    expect(q('[data-import="list"]').dataset.tip).toBe(msg('skillsExtras.import.hint'));
    q<HTMLButtonElement>('[data-import="list"]').click();
    await settled();
    expect(window.ccmws.extensionsImport).toHaveBeenCalledWith('/p');
    expect(extra('typescript').dataset.attachedScope).toBe('global');
    role('orchestrator').click();
    expect(extra('other')).not.toBeNull();
    expect(host.querySelector('[data-skill-linker]')).toBeNull();
  });

  it('shows the error of a refused list', async () => {
    await mount({ refuse: 'The list /x.json could not be read: nope' });
    q<HTMLButtonElement>('[data-import="list"]').click();
    await settled();
    expect(q('[role="alert"]').textContent).toBe('The list /x.json could not be read: nope');
    expect(attachedNames()).toEqual([]);
  });
});

describe('Skill linker view', () => {
  it('shows the path and saves a new one through the IPC', async () => {
    fakeIpc({ linker: '/opt/skills/skillLinker' });
    await mountLinker(host, '/p');
    const input = q<HTMLInputElement>('[data-skill-linker="path"]');
    expect(input.value).toBe('/opt/skills/skillLinker');
    input.value = '  /other/skillLinker ';
    host.querySelectorAll<HTMLButtonElement>('.sk-skill-linker button')[0].click();
    await settled();
    expect(window.ccmws.extensionsSkillLinker).toHaveBeenCalledWith('/p', '/other/skillLinker');
    expect(q<HTMLInputElement>('[data-skill-linker="path"]').value).toBe('/other/skillLinker');
  });

  it('clears the path', async () => {
    fakeIpc({ linker: '/opt/skills/skillLinker' });
    await mountLinker(host, '/p');
    host.querySelectorAll<HTMLButtonElement>('.sk-skill-linker button')[1].click();
    await settled();
    expect(window.ccmws.extensionsSkillLinker).toHaveBeenCalledWith('/p', null);
    expect(q<HTMLInputElement>('[data-skill-linker="path"]').value).toBe('');
  });

  it('shows the message of a refused path', async () => {
    fakeIpc({ refuse: 'The skillLinker setting must be an absolute path to the script, not x.' });
    await mountLinker(host, '/p');
    q<HTMLInputElement>('[data-skill-linker="path"]').value = 'x';
    host.querySelectorAll<HTMLButtonElement>('.sk-skill-linker button')[0].click();
    await settled();
    expect(q('[role="alert"]').textContent).toBe('The skillLinker setting must be an absolute path to the script, not x.');
  });

  it('shows the reason a path is invalid and the script taken from the Skills repo', async () => {
    fakeIpc({ linker: '/opt/my-repo', linkerState: 'invalid' });
    const original = window.ccmws.extensionsLoad;
    window.ccmws.extensionsLoad = vi.fn(async () => ({ ...(await original('/p')), skillLinkerProblem: 'The folder /opt/my-repo holds no executable file, so it has no skill linker.' })) as typeof original;
    await mountLinker(host, '/p');
    expect(q('[data-linker-state="invalid"]').textContent).toContain('holds no executable file');
    window.ccmws.extensionsLoad = vi.fn(async () => ({ ...(await original('/p')), skillLinker: null, skillLinkerState: 'initialized', skillLinkerPath: '/opt/skills/my-linker', skillLinkerFromRepo: true, skillLinkerSkills: 1, skillLinkerRoles: 1 })) as typeof original;
    await mountLinker(host, '/p');
    expect(q('[data-linker-state="initialized"]').textContent).toBe('Skill linker ready: /opt/skills/my-linker, taken from the Skills repo (1 skill in 1 role)');
    expect(q<HTMLInputElement>('[data-skill-linker="path"]').value).toBe('');
  });

  it('holds the path field and its state and nothing from the role view', async () => {
    fakeIpc({ linker: '/opt/skills/skillLinker' });
    await mountLinker(host, '/p');
    expect(host.querySelectorAll('button')).toHaveLength(2);
    expect(host.querySelector('[data-board]')).toBeNull();
    expect(host.querySelector('[data-import]')).toBeNull();
    expect(host.querySelector('[data-add-skill]')).toBeNull();
  });

  it.each([
    ['initialized', '/opt/skills/skillLinker', null, 'Skill linker ready: /opt/skills/skillLinker (12 skills in 3 roles)'],
    ['initialized', '/opt/skills/skillLinker', { skillLinkerSkills: 0, skillLinkerRoles: 0 }, 'Skill linker ready: /opt/skills/skillLinker, but its repo holds no skills yet.'],
    ['unset', null, null, 'No skill linker set. Enter its path above and save it to list, link and find skills.'],
    ['invalid', '/no/such/linker', null, 'Skill linker problem: the path was not found, is not executable, or has no skills repo beside it.'],
    ['invalid', '/no/such/linker', { skillLinkerProblem: '/no/such/linker does not exist, so it is not an executable file.' }, 'Skill linker problem: /no/such/linker does not exist, so it is not an executable file.'],
  ] as const)('says in plain words what the %s linker state means (%#)', async (state, path, extra, sentence) => {
    fakeIpc({ linker: path });
    const load = window.ccmws.extensionsLoad as ReturnType<typeof vi.fn>;
    load.mockResolvedValue({ ...(await load('/p')), skillLinker: path, skillLinkerState: state, skillLinkerProblem: null, skillLinkerSkills: 12, skillLinkerRoles: 3, ...extra });
    await mountLinker(host, '/p');
    const shown = q('[data-linker-state]');
    expect(shown.getAttribute('data-linker-state')).toBe(state);
    expect(shown.textContent).toBe(sentence);
    expect(shown.textContent).not.toMatch(/^(Initialized|Not set)$/);
  });
});

describe('Role view and linker view are separate', () => {
  it('the role view holds the board and no linker field', async () => {
    await mount({ linker: '/opt/skills/skillLinker' });
    expect(host.querySelector('[data-board]')).not.toBeNull();
    expect(host.querySelector('[data-skill-linker]')).toBeNull();
    expect(host.querySelector('[data-linker-state]')).toBeNull();
    expect(host.textContent).not.toContain(msg('skillsExtras.skillLinker.hint'));
  });
});

describe('Add skill step', () => {
  let body: HTMLElement;
  let foot: HTMLElement;
  let onBack: ReturnType<typeof vi.fn>;
  let onSaved: ReturnType<typeof vi.fn>;

  const open = (taken: string[] = [], extraStep: Partial<Parameters<typeof renderAddSkillStep>[2]> = {}) =>
    renderAddSkillStep(body, foot, { project: '/p', slot: 'delegate', taken, locked: LOCKED, scope: 'global', scoped: false, onBack, onSaved, ...extraStep });
  const nameField = () => body.querySelector<HTMLInputElement>('[data-skill-name]')!;
  const contentField = () => body.querySelector<HTMLTextAreaElement>('[data-skill-content]')!;
  const save = () => foot.querySelector<HTMLButtonElement>('[data-add-skill-save]')!;
  const alertText = () => body.querySelector('[role="alert"]')!.textContent;

  beforeEach(() => {
    document.body.innerHTML = '<div id="body"></div><div id="foot"></div>';
    body = document.getElementById('body')!;
    foot = document.getElementById('foot')!;
    onBack = vi.fn();
    onSaved = vi.fn();
    fakeIpc();
  });

  it('has a name input, a content text area, Save and Back, and no scope choice without a project scope', () => {
    open();
    expect(nameField().tagName).toBe('INPUT');
    expect(contentField().tagName).toBe('TEXTAREA');
    expect(save().textContent).toBe(msg('skillsExtras.step.save'));
    expect(foot.querySelector('[data-add-skill-back]')!.textContent).toBe(msg('skillsExtras.step.back'));
    expect(body.querySelector('.sk-scope-pick')).toBeNull();
  });

  it('sends the project, role, name, content and the scope, then reports the save', async () => {
    open();
    nameField().value = ' my-skill ';
    contentField().value = '---\nname: my-skill\n---\nBody';
    save().click();
    await settled();
    expect(window.ccmws.extensionsCreate).toHaveBeenCalledWith('/p', 'delegate', 'my-skill', '---\nname: my-skill\n---\nBody', 'global');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('offers the scope with the one the board chose preselected and sends the one picked', async () => {
    open([], { scope: 'project', scoped: true });
    const option = (scope: string) => body.querySelector<HTMLElement>(`[data-segment="${scope}"]`)!;
    expect(option('project').getAttribute('aria-checked')).toBe('true');
    option('global').click();
    expect(option('global').getAttribute('aria-checked')).toBe('true');
    nameField().value = 'mine';
    save().click();
    await settled();
    expect(window.ccmws.extensionsCreate).toHaveBeenCalledWith('/p', 'delegate', 'mine', '', 'global');
  });

  it('goes back without writing', () => {
    open();
    foot.querySelector<HTMLButtonElement>('[data-add-skill-back]')!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(window.ccmws.extensionsCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty name', '', msg('skillsExtras.step.nameRequired')],
    ['a bad name', '../x', msg('extensions.problem.badName', { name: '../x' })],
    ['a locked name', 'lantern-sync', msg('extensions.problem.locked', { name: 'lantern-sync' })],
    ['a name already attached to the role', 'taken', msg('extensions.problem.duplicate', { name: 'taken' })],
  ])('refuses %s in the step and writes nothing', async (_what, value, message) => {
    open(['taken']);
    nameField().value = value;
    save().click();
    await settled();
    expect(alertText()).toBe(message);
    expect(window.ccmws.extensionsCreate).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows the error main answers with and stays on the step', async () => {
    fakeIpc({ refuse: 'The skill mine already exists in this project, so nothing was written.' });
    open();
    nameField().value = 'mine';
    contentField().value = 'x';
    save().click();
    await settled();
    expect(alertText()).toBe('The skill mine already exists in this project, so nothing was written.');
    expect(onSaved).not.toHaveBeenCalled();
    expect(save().disabled).toBe(false);
  });

  it('shows a rejected call and stays on the step', async () => {
    window.ccmws.extensionsCreate = vi.fn(async () => {
      throw new Error('disk full');
    }) as unknown as typeof window.ccmws.extensionsCreate;
    open();
    nameField().value = 'mine';
    save().click();
    await settled();
    expect(alertText()).toBe(msg('skillsExtras.saveFailed', { reason: 'disk full' }));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
