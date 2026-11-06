import { SETTINGS } from '../../shared/settings-registry';
import type { RegisteredSetting, SettingKey, SettingsSnapshot } from '../../shared/settings-registry';
import type { NumberSetting } from '../../shared/settings-schema';
import { MODIFIED_TOKEN, countText, filterSettings, groupByCategory, matchesWords, parseQuery, settingTitle } from './settings-search';

export interface SettingsPanel {
  id: string;
  title: string;
  keywords: readonly string[];
  mount(section: HTMLElement): void;
}

export interface SettingsEditorDeps {
  update(key: SettingKey, value: unknown): Promise<void>;
  openFile(): void;
  preview?(key: SettingKey, value: unknown): void;
  panels?: readonly SettingsPanel[];
}

export interface SettingsEditor {
  refresh(snapshot: SettingsSnapshot): void;
  focusSearch(): void;
}

interface RowActions {
  write(value: unknown): void;
  openFile(): void;
  preview?(value: unknown): void;
}

interface ControlActions extends RowActions {
  report(message: string): void;
}

interface RowView {
  setting: RegisteredSetting;
  row: HTMLElement;
  control: HTMLElement;
  output: HTMLOutputElement | null;
  error: HTMLElement;
  reset: HTMLButtonElement;
}

const SLIDER_MAX_SPAN = 100;

const SEARCH_LABEL = 'Search settings';
const SEARCH_PLACEHOLDER = `Search settings (${MODIFIED_TOKEN})`;
const EMPTY_COPY = `No settings match. Try fewer words, remove ${MODIFIED_TOKEN} or pick another category.`;
const NOT_WRITABLE_COPY = "settings.json has a problem, so changes can't be saved until it's fixed:";
const NOT_WRITABLE_HINT = 'Open settings.json, fix it and save. This page updates as soon as the file is valid.';
const IGNORED_COPY = 'Some values in settings.json were ignored:';
const PANELS_LABEL = 'Integrations';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

const PLACEMENT_X: Record<string, number> = { left: 7, center: 21, right: 35 };

function placementIcon(value: string): string {
  const x = PLACEMENT_X[value] ?? PLACEMENT_X.center;
  return `<svg viewBox="0 0 64 42" aria-hidden="true"><rect class="screen" x="1" y="1" width="62" height="40" rx="4" /><path class="menubar" d="M1 7h62" /><rect class="toast" x="${x}" y="10" width="22" height="11" rx="2.5" /><path class="skeleton" d="M${x + 4} 14h10M${x + 4} 17.5h14" /></svg>`;
}

function placementPicker(setting: RegisteredSetting, options: readonly string[], actions: RowActions): HTMLElement {
  const group = el('div', 'st-placement');
  group.setAttribute('role', 'radiogroup');
  for (const option of options) {
    const choice = el('label', 'st-placement-choice');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = setting.key;
    radio.value = option;
    radio.addEventListener('change', () => radio.checked && actions.write(option));
    const caption = el('span', 'st-placement-caption', option.charAt(0).toUpperCase() + option.slice(1));
    choice.append(radio);
    choice.insertAdjacentHTML('beforeend', placementIcon(option));
    choice.append(caption);
    group.append(choice);
  }
  return group;
}

function radios(control: HTMLElement): HTMLInputElement[] {
  return [...control.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
}

function numberError(schema: NumberSetting, raw: string): string {
  const value = raw.trim() === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) return 'Value must be a number.';
  if (schema.minimum !== undefined && value < schema.minimum) return `Value must be greater than or equal to ${schema.minimum}.`;
  if (schema.maximum !== undefined && value > schema.maximum) return `Value must be less than or equal to ${schema.maximum}.`;
  return '';
}

function textControl(setting: RegisteredSetting, actions: ControlActions): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'st-input';
  const schema = setting.schema;
  if (schema.type === 'number') {
    input.type = 'number';
    if (schema.minimum !== undefined) input.min = String(schema.minimum);
    if (schema.maximum !== undefined) input.max = String(schema.maximum);
    input.step = '1';
  } else input.type = 'text';
  const problem = () => (schema.type === 'number' ? numberError(schema, input.value) : '');
  const revert = () => {
    input.value = input.dataset.current ?? '';
    actions.report('');
  };
  input.addEventListener('input', () => actions.report(problem()));
  input.addEventListener('change', () => {
    if (problem()) return;
    if (input.value === input.dataset.current) return;
    actions.write(schema.type === 'number' ? Number(input.value) : input.value);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      revert();
      input.blur();
    } else if (ev.key === 'Enter') input.blur();
  });
  return input;
}

function controlFor(setting: RegisteredSetting, actions: ControlActions): HTMLElement {
  switch (setting.schema.type) {
    case 'boolean': {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => actions.write(box.checked));
      return box;
    }
    case 'string': {
      if (!setting.schema.enum) return textControl(setting, actions);
      if (setting.schema.presentation === 'placement') return placementPicker(setting, setting.schema.enum, actions);
      const select = document.createElement('select');
      for (const option of setting.schema.enum) select.append(new Option(option, option));
      select.addEventListener('change', () => actions.write(select.value));
      return select;
    }
    case 'number': {
      const { minimum, maximum } = setting.schema;
      if (minimum === undefined || maximum === undefined || maximum - minimum > SLIDER_MAX_SPAN) return textControl(setting, actions);
      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(minimum);
      range.max = String(maximum);
      range.addEventListener('change', () => actions.write(Number(range.value)));
      return range;
    }
  }
  const edit = button('st-edit', 'Edit in settings.json', () => actions.openFile());
  edit.setAttribute('aria-label', `Edit ${settingTitle(setting.key)} in settings.json`);
  return edit;
}

function isRange(control: HTMLElement): control is HTMLInputElement {
  return control instanceof HTMLInputElement && control.type === 'range';
}

function buildRow(setting: RegisteredSetting, actions: RowActions): RowView {
  const row = el('div', 'st-row');
  row.dataset.key = setting.key;
  row.dataset.type = setting.schema.type;
  const id = `st-${setting.key}`;
  const title = settingTitle(setting.key);

  const mod = el('span', 'st-mod');
  mod.setAttribute('aria-hidden', 'true');
  const label = el('label', 'st-title', title);
  label.id = `${id}-title`;
  const desc = el('p', 'st-desc', setting.schema.description);
  desc.id = `${id}-desc`;
  const slot = el('div', 'st-ctl');
  const error = el('p', 'st-error');
  error.id = `${id}-error`;
  error.hidden = true;
  error.setAttribute('aria-live', 'polite');
  const control = controlFor(setting, {
    ...actions,
    report: (message) => {
      error.textContent = message;
      error.hidden = !message;
      control.setAttribute('aria-invalid', String(!!message));
    },
  });
  control.id = `${id}-ctl`;
  control.setAttribute('aria-describedby', desc.id);
  control.setAttribute('aria-errormessage', error.id);
  slot.append(control);
  let output: HTMLOutputElement | null = null;
  if (isRange(control)) {
    output = el('output', 'st-value');
    output.htmlFor.add(control.id);
    control.addEventListener('input', () => {
      if (output) output.textContent = control.value;
    });
    slot.append(output);
  }
  if (setting.schema.type === 'string' && setting.schema.previewable && actions.preview && control instanceof HTMLSelectElement) {
    const play = button('st-preview', 'Play', () => actions.preview?.(control.value));
    play.setAttribute('aria-label', `Play ${title}`);
    slot.append(play);
  }
  if (control.getAttribute('role') === 'radiogroup') control.setAttribute('aria-labelledby', label.id);
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) label.htmlFor = control.id;
  if (setting.schema.type === 'boolean') desc.addEventListener('click', () => control.click());

  const reset = button('st-reset', 'Reset', () => actions.write(setting.schema.default));
  reset.setAttribute('aria-label', `Reset ${title}`);
  reset.hidden = true;

  slot.append(error);
  row.append(mod, label, desc, slot, reset);
  return { setting, row, control, output, error, reset };
}

function showRow(view: RowView, snapshot: SettingsSnapshot): void {
  const isModified = snapshot.modified.includes(view.setting.key);
  view.row.classList.toggle('modified', isModified);
  view.reset.hidden = !isModified;
  view.reset.disabled = !snapshot.writable;
  if (view.setting.schema.type === 'boolean') {
    const box = view.control as HTMLInputElement;
    box.checked = snapshot.values[view.setting.key] === true;
    box.disabled = !snapshot.writable;
  } else if (view.control.getAttribute('role') === 'radiogroup') {
    for (const radio of radios(view.control)) {
      radio.checked = radio.value === snapshot.values[view.setting.key];
      radio.disabled = !snapshot.writable;
    }
  } else if (view.control instanceof HTMLSelectElement || view.control instanceof HTMLInputElement) {
    const current = String(snapshot.values[view.setting.key] ?? view.setting.schema.default);
    const editing = document.activeElement === view.control && view.control.value !== view.control.dataset.current;
    if (!editing) view.control.value = current;
    view.control.dataset.current = current;
    view.control.disabled = !snapshot.writable;
    view.error.hidden = true;
    view.error.textContent = '';
    view.control.setAttribute('aria-invalid', 'false');
    if (view.output) view.output.textContent = view.control.value;
  }
}

function isDisabled(node: Element): boolean {
  return (node instanceof HTMLButtonElement || node instanceof HTMLInputElement || node instanceof HTMLSelectElement) && node.disabled;
}

function isFocusable(node: Element): boolean {
  return !node.closest('[hidden]') && !isDisabled(node);
}

function showProblems(box: HTMLElement, snapshot: SettingsSnapshot): void {
  box.replaceChildren();
  box.hidden = snapshot.writable && snapshot.problems.length === 0;
  if (box.hidden) return;
  box.append(el('p', 'st-problems-lead', snapshot.writable ? IGNORED_COPY : NOT_WRITABLE_COPY));
  if (snapshot.problems.length) {
    const list = el('ul', 'st-problems-list');
    list.append(...snapshot.problems.map((problem) => el('li', '', problem)));
    box.append(list);
  }
  if (!snapshot.writable) box.append(el('p', 'st-problems-hint', NOT_WRITABLE_HINT));
}

export function mountSettingsEditor(
  host: HTMLElement,
  initial: SettingsSnapshot,
  deps: SettingsEditorDeps,
): SettingsEditor {
  let snapshot = initial;
  let category: string | null = null;

  const search = el('input', 'st-search');
  search.type = 'search';
  search.setAttribute('aria-label', SEARCH_LABEL);
  search.placeholder = SEARCH_PLACEHOLDER;
  search.spellcheck = false;
  const count = el('span', 'st-count');
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  const head = el('div', 'st-head');
  head.append(search, count);

  const toc = el('nav', 'st-toc');
  toc.setAttribute('aria-label', 'Settings categories');
  const list = el('div', 'st-list');
  const empty = el('p', 'st-empty', EMPTY_COPY);
  const views: RowView[] = [];
  const sections: { section: HTMLElement; rows: RowView[] }[] = [];
  const tocButtons: HTMLButtonElement[] = [];
  const panelSections: { panel: SettingsPanel; section: HTMLElement }[] = [];

  function tocButtonFor(id: string, title: string): HTMLButtonElement {
    const tocButton = button('st-toc-item', title, () => {
      category = category === id ? null : id;
      applyFilter();
    });
    tocButton.dataset.category = id;
    tocButtons.push(tocButton);
    return tocButton;
  }

  for (const group of groupByCategory(SETTINGS)) {
    const section = el('section', 'st-section');
    section.append(el('h3', 'st-group', group.category.title));
    const rows = group.settings.map((setting) => {
      const view: RowView = buildRow(setting, {
        write: (value) => void deps.update(setting.key, value).catch(() => showRow(view, snapshot)),
        openFile: () => deps.openFile(),
        preview: deps.preview ? (value) => deps.preview?.(setting.key, value) : undefined,
      });
      return view;
    });
    section.append(...rows.map((view) => view.row));
    views.push(...rows);
    sections.push({ section, rows });
    list.append(section);
    toc.append(tocButtonFor(group.category.id, group.category.title));
  }
  if (deps.panels?.length) {
    const panelToc = el('div', 'st-toc-group');
    panelToc.setAttribute('role', 'group');
    panelToc.setAttribute('aria-label', PANELS_LABEL);
    const label = el('span', 'st-toc-label', PANELS_LABEL);
    label.setAttribute('aria-hidden', 'true');
    panelToc.append(label);
    for (const panel of deps.panels) {
      const section = el('section', 'st-section st-panel');
      section.dataset.panel = panel.id;
      section.append(el('h3', 'st-group', panel.title));
      panel.mount(section);
      panelSections.push({ panel, section });
      list.append(section);
      panelToc.append(tocButtonFor(panel.id, panel.title));
    }
    toc.append(panelToc);
  }
  list.append(empty);
  const body = el('div', 'st-body');
  body.append(toc, list);

  const problems = el('div', 'st-problems');
  problems.setAttribute('role', 'alert');
  const foot = el('div', 'st-foot');
  const open = button('st-open', 'Open settings.json', () => deps.openFile());
  foot.append(problems, open);
  let problemsKey: string | null = null;

  const root = el('div', 'st-editor');
  root.append(head, body, foot);
  host.replaceChildren(root);

  function applyFilter(): void {
    const query = parseQuery(search.value);
    const matches = filterSettings(SETTINGS, query, new Set(snapshot.modified), category);
    const visible = new Set<string>(matches.map((setting) => setting.key));
    for (const view of views) view.row.hidden = !visible.has(view.setting.key);
    for (const { section, rows } of sections) section.hidden = rows.every((view) => view.row.hidden);
    for (const { panel, section } of panelSections) {
      const isListed = category ? category === panel.id : query.text !== '';
      section.hidden = !isListed || query.modifiedOnly || !matchesWords(`${panel.title} ${panel.keywords.join(' ')}`, query.text);
    }
    const panelShown = panelSections.some(({ section }) => !section.hidden);
    for (const tocButton of tocButtons) tocButton.setAttribute('aria-pressed', String(tocButton.dataset.category === category));
    const text = visible.size === 0 && panelShown ? '' : countText(visible.size);
    if (count.textContent !== text) count.textContent = text;
    empty.hidden = visible.size > 0 || panelShown;
  }

  function rescueFocus(previous: Element | null): void {
    if (!previous || !root.contains(previous) || isFocusable(previous)) return;
    if (isDisabled(previous)) return open.focus();
    const view = views.find((candidate) => candidate.row.contains(previous));
    if (view && isFocusable(view.control)) view.control.focus();
    else search.focus();
  }

  function refresh(next: SettingsSnapshot): void {
    // Chromium blurs an element the moment it is hidden or disabled, so capture focus before mutating.
    const previous = document.activeElement;
    snapshot = next;
    for (const view of views) showRow(view, snapshot);
    const key = `${snapshot.writable}\n${snapshot.problems.join('\n')}`;
    if (key !== problemsKey) showProblems(problems, snapshot);
    problemsKey = key;
    applyFilter();
    rescueFocus(previous);
  }

  search.addEventListener('input', applyFilter);
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !search.value) return;
    e.preventDefault();
    e.stopPropagation();
    search.value = '';
    applyFilter();
  });

  refresh(snapshot);
  return { refresh, focusSearch: () => search.focus() };
}
