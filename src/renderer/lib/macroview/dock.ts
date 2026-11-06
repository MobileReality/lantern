import { FOUNDATION_HEADING, FOUNDATION_KEY, SYSTEM_KEY, plural } from '../lanternmacro';
import { MACRO_STYLE_CLASSES } from '../lanternmacrostyles';
import type { Related } from './focus';
import { nameOf } from './files';
import type { MacroViewMarks } from './marks';
import type { MacroViewModel } from './model';

const DOCK_TITLE = 'Outside systems';
const SHOW_ALL = 'Show all';
const KEY_ATTRIBUTE = 'data-key';
const SYSTEM_CHIP = MACRO_STYLE_CLASSES.system;

interface DockItem {
  key: string;
  name: string;
  count: number;
  selected: boolean;
  linked: boolean;
  lit: boolean;
  label: string;
}

interface DockToggle {
  label: string;
  pressed: boolean;
  title: string;
}

interface DockView {
  note: string;
  empty: string;
  toggle: DockToggle | null;
  items: DockItem[];
}

interface DockInput {
  model: MacroViewModel;
  marks: MacroViewMarks;
  related: Related;
  selection: string | null;
  showAll: boolean;
  file: string | null;
}

function subjectOf(model: MacroViewModel, selection: string | null, file: string | null): string | null {
  if (!selection || selection.startsWith(SYSTEM_KEY)) return null;
  if (file) return nameOf(file);
  if (selection === FOUNDATION_KEY) return FOUNDATION_HEADING;
  const found = [...model.features.values(), ...model.areas, ...model.foundation].find((block) => block.key === selection);
  return found?.name ?? null;
}

function itemOf(system: MacroViewModel['systems'][number], count: number, input: DockInput, linked: boolean): DockItem {
  const lit = input.marks.systems.has(system.key);
  const selected = system.key === input.selection;
  const used = plural(system.features.size + system.foundation.size, 'block');
  const notes = [linked ? 'talked to by the selection' : '', lit ? 'touched by the pull request' : ''].filter(Boolean).join(', ');
  return {
    key: system.key,
    name: system.name,
    count,
    selected,
    linked,
    lit,
    label: [`${system.name}, outside system, ${plural(count, 'relation')}, used by ${used}`, notes].filter(Boolean).join(', '),
  };
}

function byCount(a: DockItem, b: DockItem) {
  return b.count - a.count || a.name.localeCompare(b.name);
}

function dockView(input: DockInput): DockView {
  const { model, related, selection, showAll, file } = input;
  const subject = subjectOf(model, selection, file);
  const everything = model.systems.map((system) => itemOf(system, system.total, input, related.systems.has(system.key) && !!subject));
  const total = plural(model.systems.length, 'system');
  if (!subject) return { note: model.systems.length ? total : 'none', empty: 'This project talks to no outside system.', toggle: null, items: everything };
  const talking = model.systems.filter((system) => related.systems.has(system.key));
  const noun = talking.length === 1 ? 'talks' : 'talk';
  if (showAll) {
    return {
      note: `all ${total}, ${talking.length} ${noun} to ${subject}`,
      empty: '',
      toggle: { label: `Only those of ${subject}`, pressed: true, title: `List only the outside systems ${subject} talks to` },
      items: everything,
    };
  }
  const filtered = talking.map((system) => itemOf(system, related.systemCounts.get(system.key) ?? system.total, input, true)).sort(byCount);
  return {
    note: `${talking.length} of ${total} ${noun} to ${subject}`,
    empty: `${subject} talks to no outside system.`,
    toggle: { label: SHOW_ALL, pressed: false, title: `List all ${total}` },
    items: filtered,
  };
}

function chip(item: DockItem) {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = SYSTEM_CHIP;
  button.setAttribute(KEY_ATTRIBUTE, item.key);
  button.setAttribute('aria-pressed', String(item.selected));
  button.setAttribute('aria-label', item.label);
  button.dataset.tip = item.label;
  button.classList.toggle(MACRO_STYLE_CLASSES.selected, item.selected);
  button.classList.toggle(MACRO_STYLE_CLASSES.linked, item.linked);
  button.classList.toggle(MACRO_STYLE_CLASSES.lit, item.lit);
  const name = document.createElement('span');
  name.className = 'mv-system-name';
  name.textContent = item.name;
  const count = document.createElement('b');
  count.className = 'mv-system-count';
  count.textContent = String(item.count);
  button.append(name, count);
  li.appendChild(button);
  return li;
}

interface Dock {
  root: HTMLElement;
  note: HTMLElement;
  toggle: HTMLButtonElement;
  list: HTMLUListElement;
  empty: HTMLElement;
}

function createDock(): Dock {
  const root = document.createElement('section');
  root.className = 'mv-dock';
  root.setAttribute('aria-label', DOCK_TITLE);
  const title = document.createElement('h2');
  title.className = 'mv-dock-title';
  title.textContent = DOCK_TITLE;
  const note = document.createElement('span');
  note.className = 'mv-dock-note';
  note.setAttribute('role', 'status');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'mv-dock-toggle';
  toggle.setAttribute('data-dock-toggle', '');
  const head = document.createElement('div');
  head.className = 'mv-dock-head';
  head.append(title, note, toggle);
  const list = document.createElement('ul');
  list.className = 'mv-dock-list';
  const empty = document.createElement('p');
  empty.className = 'mv-dock-empty';
  const body = document.createElement('div');
  body.className = 'mv-dock-body';
  body.append(list, empty);
  root.append(head, body);
  return { root, note, toggle, list, empty };
}

function paintDock(dock: Dock, view: DockView) {
  if (dock.note.textContent !== view.note) dock.note.textContent = view.note;
  dock.note.dataset.tip = view.note;
  dock.toggle.hidden = !view.toggle;
  if (view.toggle) {
    dock.toggle.textContent = view.toggle.label;
    dock.toggle.dataset.tip = view.toggle.title;
    dock.toggle.setAttribute('aria-pressed', String(view.toggle.pressed));
  }
  dock.empty.hidden = view.items.length > 0;
  dock.empty.textContent = view.items.length ? '' : view.empty;
  const focused = dock.list.contains(document.activeElement) ? document.activeElement?.getAttribute(KEY_ATTRIBUTE) : null;
  dock.list.replaceChildren(...view.items.map(chip));
  if (focused) [...dock.list.querySelectorAll<HTMLElement>(`.${SYSTEM_CHIP}`)].find((button) => button.getAttribute(KEY_ATTRIBUTE) === focused)?.focus({ preventScroll: true });
}

function neighbourOf(buttons: readonly HTMLElement[], from: Element | null, key: string): HTMLElement | null {
  const at = buttons.findIndex((button) => button === from);
  if (at < 0) return null;
  if (key === 'Home') return buttons[0];
  if (key === 'End') return buttons[buttons.length - 1];
  return buttons[at + (key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1)] ?? null;
}

const MOVES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

export { MOVES, SYSTEM_CHIP, createDock, dockView, neighbourOf, paintDock };
export type { Dock, DockInput, DockItem, DockView };
