import { EXTENSION_SCOPES, EXTENSION_SLOT, EXTENSION_SLOTS, type ExtensionScope, type ExtensionSlot, type SkillLinkerState } from '@shared/extension-slots';
import { msg } from '@shared/lang/messages';
import { el } from '../lib/util';
import { attachedItem, candidateItem, focusKey, lockedRow, scopeLabel, slotLabel, switchRow, withFocusKey } from './skills-rows';
import { segmentedControl } from './skills-segmented';
import { searchShortcuts } from './skills-shortcuts';
import { attachedRows, candidateRows, canLinkIntoProject, defaultScope, effectiveExtras, type ExtrasState, hasProjectScope, KEY, nextIndex, otherScope, slotRows } from './skills-state';

export interface AddSkillRequest {
  slot: ExtensionSlot;
  taken: string[];
  locked: string[];
  scope: ExtensionScope;
  scoped: boolean;
}

export type BoardState = ExtrasState & { skillLinkerState: SkillLinkerState };

export interface BoardActions {
  redraw: () => void;
  attach: (slot: ExtensionSlot, name: string, scope: ExtensionScope) => void;
  detach: (slot: ExtensionSlot, name: string, scope: ExtensionScope) => void;
  move: (slot: ExtensionSlot, name: string, from: ExtensionScope, to: ExtensionScope) => void;
  setOff: (slot: ExtensionSlot, off: string[]) => void;
  addSkill: (request: AddSkillRequest) => void;
  importList: () => void;
  link: (name: string) => void;
}

interface BoardUi {
  slot: ExtensionSlot;
  query: string;
  scope: ExtensionScope | undefined;
  builtInOpen: boolean;
  focus: string | null;
}

const freshUi = (): BoardUi => ({ slot: EXTENSION_SLOT.delegate, query: '', scope: undefined, builtInOpen: false, focus: null });

let ui = freshUi();
let serial = 0;

export const resetBoardUi = () => {
  ui = freshUi();
};

const SEARCH_KEY = focusKey('search', 'query');
const ROW = '[data-extra]';
const CANDIDATE = '[data-pick]';

const focusables = (host: ParentNode) => [...host.querySelectorAll<HTMLElement>('[data-fk]')];

export function rememberFocus(host: HTMLElement) {
  const active = document.activeElement as HTMLElement | null;
  if (!ui.focus && active && host.contains(active) && active.dataset.fk) ui.focus = active.dataset.fk;
}

export const forgetPendingFocus = () => {
  ui.focus = null;
};

export function restoreFocus(host: HTMLElement) {
  const key = ui.focus;
  ui.focus = null;
  if (key) focusables(host).find((node) => node.dataset.fk === key)?.focus();
}

function rove(list: HTMLElement, rows: HTMLElement[]) {
  const set = (active: HTMLElement | undefined) => {
    for (const row of rows) row.tabIndex = row === active ? 0 : -1;
  };
  set(rows.find((row) => row.dataset.fk === ui.focus) ?? rows[0]);
  list.addEventListener('focusin', (event) => set(rows.find((row) => row === event.target)));
}

function column(title: string, count: number | null) {
  const id = `sk-col-${++serial}`;
  const section = el('section', 'sk-col');
  section.setAttribute('aria-labelledby', id);
  const head = el('div', 'sk-col-head');
  const heading = el('h3', 'sk-col-title', title);
  heading.id = id;
  head.append(heading);
  if (count !== null) head.append(el('span', 'sk-count', String(count)));
  section.append(head);
  return { section, head };
}

function builtInBlock(slot: ExtensionSlot, state: BoardState, actions: BoardActions) {
  const { locked, switchable, off } = slotRows(slot, state);
  if (!locked.length) return null;
  const block = el('div', 'sk-builtin');
  const toggle = el('button', 'sk-builtin-toggle');
  toggle.type = 'button';
  toggle.dataset.builtinToggle = slot;
  toggle.setAttribute('aria-expanded', String(ui.builtInOpen));
  withFocusKey(toggle, 'builtin', slot);
  toggle.append(el('span', 'sk-chev'), el('span', '', msg('skillsExtras.builtIn.toggle', { count: locked.length })));
  const body = el('div', 'sk-builtin-body');
  body.hidden = !ui.builtInOpen;
  body.setAttribute('role', 'group');
  body.setAttribute('aria-label', msg('skillsExtras.builtIn.label', { role: slotLabel(slot) }));
  for (const name of locked) {
    if (!switchable.includes(name)) body.append(lockedRow(name));
    else body.append(switchRow(slot, name, !off.includes(name), () => actions.setOff(slot, off.includes(name) ? off.filter((taken) => taken !== name) : [...off, name])));
  }
  toggle.addEventListener('click', () => {
    ui.builtInOpen = !ui.builtInOpen;
    body.hidden = !ui.builtInOpen;
    toggle.setAttribute('aria-expanded', String(ui.builtInOpen));
  });
  block.append(toggle, body);
  return block;
}

function attachedColumn(slot: ExtensionSlot, state: BoardState, repoSkills: readonly string[], actions: BoardActions) {
  const rows = attachedRows(slot, state);
  const scoped = hasProjectScope(state);
  const { section } = column(msg('skillsExtras.attached.title', { role: slotLabel(slot) }), rows.length);
  section.dataset.col = 'attached';
  const built = builtInBlock(slot, state, actions);
  if (built) section.append(built);
  const list = el('div', 'sk-list');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', msg('skillsExtras.attached.list', { role: slotLabel(slot) }));
  const items: HTMLElement[] = rows.map((row) =>
    attachedItem(row, {
      slot,
      scoped,
      onMove: () => {
        ui.focus = focusKey('attached', row.name);
        actions.move(slot, row.name, row.scope, otherScope(row.scope));
      },
      onDetach: () => {
        ui.focus = SEARCH_KEY;
        actions.detach(slot, row.name, row.scope);
      },
      onLink: row.missing && canLinkIntoProject(row.name, state, repoSkills) ? () => actions.link(row.name) : null,
    }),
  );
  list.append(...items);
  if (items.length) rove(list, items);
  else list.append(el('p', 'sk-empty', msg('skillsExtras.attached.empty', { role: slotLabel(slot) })));
  list.addEventListener('keydown', (event) => {
    const row = event.target instanceof HTMLElement && event.target.matches(ROW) ? event.target : null;
    if (!row) return;
    const at = items.indexOf(row);
    const entry = rows[at];
    if (event.key === KEY.remove || event.key === KEY.back) {
      event.preventDefault();
      const neighbour = items[at + 1] ?? items[at - 1];
      ui.focus = neighbour ? (neighbour.dataset.fk ?? null) : SEARCH_KEY;
      actions.detach(slot, entry.name, entry.scope);
    } else if (event.key === KEY.enter && scoped) {
      event.preventDefault();
      ui.focus = focusKey('attached', entry.name);
      actions.move(slot, entry.name, entry.scope, otherScope(entry.scope));
    } else if ([KEY.up, KEY.down, KEY.home, KEY.end].some((key) => key === event.key)) {
      event.preventDefault();
      items[nextIndex(event.key, at, items.length)]?.focus();
    }
  });
  section.append(list);
  if (items.length) section.append(el('p', 'sk-col-hint', msg(scoped ? 'skillsExtras.attached.hint' : 'skillsExtras.attached.hintGlobal')));
  return section;
}

function candidateColumn(slot: ExtensionSlot, state: BoardState, repoSkills: readonly string[], actions: BoardActions, scope: ExtensionScope) {
  const { section, head } = column(msg('skillsExtras.attach.title', { role: slotLabel(slot) }), null);
  section.dataset.col = 'candidates';
  const scoped = hasProjectScope(state);
  if (scoped) {
    head.append(
      el('span', 'sk-col-sub', msg('skillsExtras.scope.attachAs')),
      segmentedControl({
        label: msg('skillsExtras.scope.attachAs'),
        className: 'sk-scope-pick',
        zone: 'scope',
        value: scope,
        options: EXTENSION_SCOPES.map((value) => ({ value, label: scopeLabel(value), tip: msg(`skillsExtras.scope.${value}Tip`) })),
        onSelect: (value, viaKeyboard) => {
          ui.scope = value;
          ui.focus = viaKeyboard ? focusKey('scope', value) : null;
          actions.redraw();
        },
      }),
    );
  }
  const search = Object.assign(el('input', 'sk-search'), { type: 'search', placeholder: msg('skillsExtras.attach.search'), spellcheck: false, value: ui.query });
  search.setAttribute('aria-label', msg('skillsExtras.attach.searchLabel', { role: slotLabel(slot) }));
  search.dataset.pickSearch = slot;
  withFocusKey(search, 'search', 'query');
  const list = el('div', 'sk-list sk-candidates');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', msg('skillsExtras.attach.list', { role: slotLabel(slot) }));

  const attach = (name: string) => {
    ui.focus = focusKey('candidate', name);
    actions.attach(slot, name, scope);
  };
  const refresh = () => {
    const rows = candidateRows(slot, state, repoSkills, ui.query);
    const items = rows.map((row) => candidateItem(row, { slot, scope, scoped, links: canLinkIntoProject(row.name, state, repoSkills), onAttach: () => attach(row.name) }));
    const none = ui.query.trim() ? msg('skillsExtras.attach.noMatch', { query: ui.query.trim() }) : msg('skillsExtras.attach.none');
    list.replaceChildren(...(items.length ? items : [el('p', 'sk-empty', none)]));
    if (items.length) rove(list, items);
    return rows;
  };
  refresh();

  search.addEventListener('input', () => {
    ui.query = search.value;
    refresh();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === KEY.enter) {
      if (!ui.query.trim()) return;
      const first = candidateRows(slot, state, repoSkills, ui.query).find((row) => !row.attached && !row.locked);
      if (!first) return;
      ui.focus = SEARCH_KEY;
      actions.attach(slot, first.name, scope);
    } else if (event.key === KEY.down) {
      event.preventDefault();
      list.querySelector<HTMLElement>(CANDIDATE)?.focus();
    } else if (event.key === KEY.escape && search.value) {
      event.stopPropagation();
      ui.query = '';
      search.value = '';
      refresh();
    }
  });
  list.addEventListener('keydown', (event) => {
    const items = [...list.querySelectorAll<HTMLElement>(CANDIDATE)];
    const at = items.findIndex((item) => item === event.target);
    if (at === -1) return;
    if (event.key === KEY.up && at === 0) {
      event.preventDefault();
      search.focus();
    } else if ([KEY.up, KEY.down, KEY.home, KEY.end].some((key) => key === event.key)) {
      event.preventDefault();
      items[nextIndex(event.key, at, items.length)]?.focus();
    }
  });
  const searchBox = el('div', 'sk-search-wrap');
  const slash = el('kbd', 'sk-search-key', '/');
  slash.setAttribute('aria-hidden', 'true');
  searchBox.append(search, slash);
  section.append(searchBox, list, el('p', 'sk-col-hint', msg('skillsExtras.attach.builtInNote')));
  const focusSearch = () => {
    search.focus();
    search.select();
  };
  return { section, focusSearch };
}

function footer(slot: ExtensionSlot, state: BoardState, scope: ExtensionScope, actions: BoardActions) {
  const bar = el('div', 'sk-board-foot');
  const add = el('button', 'sk-role-act', msg('skillsExtras.addSkill'));
  add.type = 'button';
  add.dataset.addSkill = slot;
  add.setAttribute('aria-label', msg('skillsExtras.addSkillLabel', { slot: slotLabel(slot) }));
  add.addEventListener('click', () => actions.addSkill({ slot, taken: effectiveExtras(slot, state), locked: state.locked, scope, scoped: hasProjectScope(state) }));
  const importList = el('button', 'sk-role-act', msg('skillsExtras.import.button'));
  importList.type = 'button';
  importList.dataset.import = 'list';
  importList.dataset.tip = msg('skillsExtras.import.hint');
  importList.addEventListener('click', actions.importList);
  bar.append(add, importList);
  return bar;
}

export function roleBoard(state: BoardState, repoSkills: readonly string[], actions: BoardActions): HTMLElement {
  const slot = ui.slot;
  const scope = defaultScope(state, ui.scope);
  const board = el('div', 'sk-board');
  board.dataset.board = slot;
  const roles = segmentedControl({
    label: msg('skillsExtras.roles.label'),
    className: 'sk-roles',
    zone: 'role',
    value: slot,
    options: EXTENSION_SLOTS.map((value) => ({ value, label: slotLabel(value), count: effectiveExtras(value, state).length })),
    onSelect: (value, viaKeyboard) => {
      ui.slot = value;
      ui.focus = viaKeyboard ? focusKey('role', value) : null;
      actions.redraw();
    },
  });
  const columns = el('div', 'sk-cols');
  columns.dataset.slot = slot;
  const candidates = candidateColumn(slot, state, repoSkills, actions, scope);
  columns.append(attachedColumn(slot, state, repoSkills, actions), candidates.section);
  board.append(roles, el('p', 'sk-board-note', msg(`skillsExtras.roles.hint.${slot}`)), columns, footer(slot, state, scope, actions));
  searchShortcuts(board, candidates.focusSearch);
  return board;
}
