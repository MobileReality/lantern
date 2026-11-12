import { EXTENSION_SCOPE, type ExtensionScope, type ExtensionSlot, SKILL_LINKER_STATE, type SkillLinkerState } from '@shared/extension-slots';
import { msg, msgCount } from '@shared/lang/messages';
import { el } from '../lib/util';
import { type BoardActions, forgetPendingFocus, rememberFocus, restoreFocus, roleBoard } from './skills-roles';
import { slotLabel, scopeLabel } from './skills-rows';
import { canLinkIntoProject, type ExtrasState, linkProblems } from './skills-state';

type Panel = ExtrasState & { skillLinker: string | null; skillLinkerState: SkillLinkerState; skillLinkerProblem?: string | null; skillLinkerPath?: string | null; skillLinkerFromRepo?: boolean; skillLinkerSkills?: number; skillLinkerRoles?: number; projectError?: string | null; error: string | null };
type View = 'lantern' | 'linker';
type LinkerActions = { setSkillLinker: (value: string | null) => void };

export interface ExtrasHooks {
  linked?: (listing: unknown) => void;
  linkerSaved?: () => void;
}

export type AddSkillOpener = BoardActions['addSkill'];

function skillLinkerRow(state: Panel, actions: LinkerActions) {
  const row = el('div', 'sk-row sk-add sk-skill-linker');
  const input = Object.assign(el('input', 'sk-set-field'), { type: 'text', value: state.skillLinker ?? '', placeholder: msg('skillsExtras.skillLinker.placeholder') });
  input.setAttribute('aria-label', msg('skillsExtras.skillLinker.label'));
  input.dataset.skillLinker = 'path';
  const save = el('button', 'sk-role-act', msg('skillsExtras.skillLinker.save'));
  save.addEventListener('click', () => actions.setSkillLinker(input.value.trim() || null));
  const clear = el('button', 'sk-role-act', msg('skillsExtras.skillLinker.clear'));
  clear.addEventListener('click', () => actions.setSkillLinker(null));
  row.append(input, save, clear);
  return row;
}

function readyText(state: Panel) {
  const skills = state.skillLinkerSkills ?? 0;
  const path = state.skillLinkerPath ?? state.skillLinker ?? '';
  if (skills === 0) return msg('skillsExtras.skillLinker.state.initializedEmpty', { path });
  const counts = { path, skills: msgCount('skillsExtras.skillLinker.count.skills', skills), roles: msgCount('skillsExtras.skillLinker.count.roles', state.skillLinkerRoles ?? 0) };
  return state.skillLinkerFromRepo ? msg('skillsExtras.skillLinker.fromRepo', counts) : msg('skillsExtras.skillLinker.state.initialized', counts);
}

const LINKER_STATE_TEXT: Record<SkillLinkerState, (state: Panel) => string> = {
  [SKILL_LINKER_STATE.initialized]: readyText,
  [SKILL_LINKER_STATE.unset]: () => msg('skillsExtras.skillLinker.state.unset'),
  [SKILL_LINKER_STATE.invalid]: (state) => (state.skillLinkerProblem ? msg('skillsExtras.skillLinker.state.invalidWhy', { problem: state.skillLinkerProblem }) : msg('skillsExtras.skillLinker.state.invalid')),
};

const linkerStatusText = (state: Panel) => LINKER_STATE_TEXT[state.skillLinkerState](state);

function linkerSection(state: Panel, actions: LinkerActions) {
  const section = el('div', 'sk-extras-slot');
  section.dataset.linker = 'true';
  const status = el('div', `sk-linker-state is-${state.skillLinkerState}`, linkerStatusText(state));
  status.dataset.linkerState = state.skillLinkerState;
  status.setAttribute('role', 'status');
  section.append(el('div', 'sk-role-name sk-extras-title', msg('skillsExtras.skillLinker.title')), el('div', 'sk-set-note', msg('skillsExtras.skillLinker.hint')), skillLinkerRow(state, actions), status);
  return section;
}

function alertLine(text: string) {
  const line = el('div', 'sk-set-err', text);
  line.setAttribute('role', 'alert');
  return line;
}

const BOARD_COLUMNS = ['attached', 'candidates'] as const;

const boardOf = (host: ParentNode) => host.querySelector<HTMLElement>('[data-board]');
const columnList = (host: ParentNode, column: string) => host.querySelector<HTMLElement>(`[data-col="${column}"] .sk-list`);

function renderPanel(host: HTMLElement, view: View, state: Panel, repoSkills: readonly string[], actions: BoardActions & LinkerActions) {
  const body = host.closest<HTMLElement>('.modal-body');
  const bodyTop = body?.scrollTop ?? 0;
  const role = boardOf(host)?.dataset.board;
  const listTops = BOARD_COLUMNS.map((column) => columnList(host, column)?.scrollTop ?? 0);
  host.replaceChildren();
  for (const text of [state.error, state.projectError]) if (text) host.append(alertLine(text));
  host.append(view === 'linker' ? linkerSection(state, actions) : roleBoard(state, repoSkills, actions));
  if (role && role === boardOf(host)?.dataset.board) {
    BOARD_COLUMNS.forEach((column, at) => {
      const list = columnList(host, column);
      if (list) list.scrollTop = listTops[at];
    });
  }
  if (body) body.scrollTop = bodyTop;
}

async function mountView(view: View, host: HTMLElement, project: string | null, addSkill: AddSkillOpener, repoSkills: string[], hooks: ExtrasHooks) {
  let current: Panel | null = null;
  let busy = false;
  const live = el('div', 'sk-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const show = (state: Panel, said?: string) => {
    rememberFocus(host);
    current = state;
    renderPanel(host, view, state, repoSkills, actions);
    host.append(live);
    restoreFocus(host);
    live.textContent = said ?? '';
  };
  const run = async (change: () => Promise<Panel>, said?: string, after?: (next: Panel) => void) => {
    if (busy) return forgetPendingFocus();
    busy = true;
    try {
      const next = await change();
      show(next, next.error ? undefined : said);
      after?.(next);
    } catch (err) {
      if (current) show({ ...current, error: msg('skillsExtras.saveFailed', { reason: (err as Error).message }) });
    } finally {
      busy = false;
    }
  };
  const listOf = (slot: ExtensionSlot, scope: ExtensionScope) => (scope === EXTENSION_SCOPE.global ? current?.slots[slot] : current?.projectSlots[slot]) ?? [];
  const save = (slot: ExtensionSlot, names: string[], scope: ExtensionScope) => window.ccmws.extensionsSave(project, slot, names, undefined, scope);
  const linkInto = async (name: string): Promise<string | null> => {
    const listing = (await window.ccmws.skillsLink(project as string, [name])) as { linkResults?: Record<string, string> };
    hooks.linked?.(listing);
    if (listing.linkResults?.[name] === 'linked') return null;
    return linkProblems(listing.linkResults).join(' ') || msg('skillsExtras.linkFailedUnknown');
  };
  const failedToLink = (name: string, reason: string): Panel => ({ ...(current as Panel), error: msg('skillsExtras.linkFailed', { name, reason }) });
  const attachWithLink = (slot: ExtensionSlot, name: string, scope: ExtensionScope) =>
    run(async () => {
      const problem = await linkInto(name);
      return problem ? failedToLink(name, problem) : save(slot, [...listOf(slot, scope), name], scope);
    }, msg('skillsExtras.announce.attachedLinked', { name, role: slotLabel(slot), scope: scopeLabel(scope) }));
  const actions: BoardActions & LinkerActions = {
    redraw: () => current && show(current),
    attach: (slot, name, scope) => {
      if (current && canLinkIntoProject(name, current, repoSkills)) return void attachWithLink(slot, name, scope);
      void run(() => save(slot, [...listOf(slot, scope), name], scope), msg('skillsExtras.announce.attached', { name, role: slotLabel(slot), scope: scopeLabel(scope) }));
    },
    link: (name) =>
      void run(async () => {
        const problem = await linkInto(name);
        return problem ? failedToLink(name, problem) : window.ccmws.extensionsLoad(project);
      }, msg('skillsExtras.announce.linked', { name })),
    detach: (slot, name, scope) => void run(() => save(slot, listOf(slot, scope).filter((taken) => taken !== name), scope), msg('skillsExtras.announce.detached', { name, role: slotLabel(slot) })),
    move: (slot, name, from, to) => void run(() => window.ccmws.extensionsMove(project, slot, name, from, to), msg('skillsExtras.announce.moved', { name, role: slotLabel(slot), scope: scopeLabel(to) })),
    setOff: (slot, off) => void run(() => window.ccmws.extensionsSave(project, slot, listOf(slot, EXTENSION_SCOPE.global), off, EXTENSION_SCOPE.global)),
    setSkillLinker: (value) =>
      void run(
        () => window.ccmws.extensionsSkillLinker(project, value),
        undefined,
        (next) => {
          if (!next.error) hooks.linkerSaved?.();
        },
      ),
    importList: () => void run(() => window.ccmws.extensionsImport(project)),
    addSkill,
  };
  try {
    show(await window.ccmws.extensionsLoad(project));
  } catch {
    host.replaceChildren(el('div', 'sk-set-err', msg('skillsExtras.loadFailed')));
  }
}

export const mountExtras = (host: HTMLElement, project: string | null, addSkill: AddSkillOpener, repoSkills: string[] = [], hooks: ExtrasHooks = {}) => mountView('lantern', host, project, addSkill, repoSkills, hooks);

export const mountLinker = (host: HTMLElement, project: string | null, hooks: ExtrasHooks = {}) => mountView('linker', host, project, () => {}, [], hooks);
