// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSettingsEditor } from '../src/renderer/lib/settings-editor';
import { SETTING_DEFAULTS } from '../src/shared/settings-registry';
import type { SettingsSnapshot } from '../src/shared/settings-registry';
import type { SettingsPanel } from '../src/renderer/lib/settings-editor';

const CSS = fs.readFileSync(path.join(__dirname, '../src/renderer/settings.css'), 'utf8');
const KEY = 'graph.foldFilesWhenZoomedOut';
const EMOJI = /\p{Extended_Pictographic}/u;

function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return { values: SETTING_DEFAULTS, modified: [], problems: [], writable: true, ...overrides };
}

const unfolded = () => snapshot({ values: { ...SETTING_DEFAULTS, [KEY]: false }, modified: [KEY] });

function mount(initial = snapshot(), panels: SettingsPanel[] = []) {
  const deps = { update: vi.fn().mockResolvedValue(undefined), openFile: vi.fn(), panels };
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const editor = mountSettingsEditor(host, initial, deps);
  return { deps, editor, host };
}

async function mountWith(extra: unknown) {
  vi.resetModules();
  vi.doMock('../src/shared/settings-registry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/shared/settings-registry')>();
    return { ...actual, SETTINGS: [...actual.SETTINGS, extra] };
  });
  const { mountSettingsEditor: mountWithExtra } = await import('../src/renderer/lib/settings-editor');
  const deps = { update: vi.fn().mockResolvedValue(undefined), openFile: vi.fn() };
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const editor = mountWithExtra(host, snapshot(), deps);
  vi.doUnmock('../src/shared/settings-registry');
  return { editor, ...deps };
}

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const row = () => $<HTMLElement>(`.st-row[data-key="${KEY}"]`);
const checkbox = () => row().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const reset = () => row().querySelector<HTMLButtonElement>('.st-reset')!;
const search = () => $<HTMLInputElement>('.st-search');
const count = () => $('.st-count').textContent;
const isShown = (el: HTMLElement) => getComputedStyle(el).display !== 'none';

function type(text: string) {
  search().value = text;
  search().dispatchEvent(new Event('input'));
}

beforeEach(() => {
  document.head.innerHTML = `<style>${CSS}</style>`;
});

describe('settings editor', () => {
  it('renders the graph setting with its title, description and value', () => {
    mount();
    const label = row().querySelector<HTMLLabelElement>('.st-title')!;
    const desc = row().querySelector('.st-desc')!;
    expect(label.textContent).toBe('Fold files when zoomed out');
    expect(label.htmlFor).toBe(checkbox().id);
    expect(desc.textContent).toContain('show each folder as one tile');
    expect(checkbox().getAttribute('aria-describedby')).toBe(desc.id);
    expect(checkbox().checked).toBe(true);
    expect(search().getAttribute('aria-label')).toBe('Search settings');
    expect(search().placeholder).toBe('Search settings (@modified)');
    expect($('.st-count').getAttribute('aria-live')).toBe('polite');
    expect($('nav.st-toc').getAttribute('aria-label')).toBe('Settings categories');
    expect(count()).toBe('18 settings');
    expect(EMOJI.test(document.body.textContent!)).toBe(false);
  });

  it('writes the new value when the checkbox changes', () => {
    const { deps } = mount();
    checkbox().click();
    expect(deps.update).toHaveBeenCalledWith(KEY, false);
  });

  it('toggles the checkbox from the title and the description', () => {
    const { deps } = mount();
    row().querySelector<HTMLElement>('.st-title')!.click();
    row().querySelector<HTMLElement>('.st-desc')!.click();
    expect(deps.update.mock.calls).toEqual([
      [KEY, false],
      [KEY, true],
    ]);
  });

  it('shows the modified bar and Reset only when the setting is modified', () => {
    const { deps, editor } = mount();
    expect(row().classList.contains('modified')).toBe(false);
    expect(isShown(reset())).toBe(false);

    editor.refresh(unfolded());
    expect(row().classList.contains('modified')).toBe(true);
    expect(isShown(reset())).toBe(true);
    expect(checkbox().checked).toBe(false);

    reset().click();
    expect(deps.update).toHaveBeenCalledWith(KEY, true);
  });

  it('shows only modified settings for @modified and updates the count', () => {
    const { editor } = mount();
    type('@modified');
    expect(isShown(row())).toBe(false);
    expect(count()).toBe('No settings found');
    expect(isShown($('.st-empty'))).toBe(true);

    editor.refresh(unfolded());
    expect(isShown(row())).toBe(true);
    expect(count()).toBe('1 setting');
    expect(isShown($('.st-empty'))).toBe(false);
  });

  it('filters by category from the table of contents', () => {
    mount();
    const graph = $<HTMLButtonElement>('.st-toc-item[data-category="graph"]');
    expect(graph.getAttribute('aria-pressed')).toBe('false');
    graph.click();
    expect(graph.getAttribute('aria-pressed')).toBe('true');
    expect(isShown(row())).toBe(true);
    type('nothing matches this');
    expect(count()).toBe('No settings found');
    graph.click();
    expect(graph.getAttribute('aria-pressed')).toBe('false');
  });

  it('clears a non-empty search on Escape without letting it reach the dialog', () => {
    mount();
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    type('zzz');
    expect(count()).toBe('No settings found');

    search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(search().value).toBe('');
    expect(count()).toBe('18 settings');
    expect(outer).not.toHaveBeenCalled();

    search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('disables controls and explains how to fix an unreadable settings.json', () => {
    const { editor } = mount();
    const problems = $<HTMLElement>('.st-problems');
    expect(problems.getAttribute('role')).toBe('alert');
    expect(isShown(problems)).toBe(false);

    editor.refresh({ ...unfolded(), writable: false, problems: ['Line 3: expected a comma'] });
    expect(checkbox().disabled).toBe(true);
    expect(reset().disabled).toBe(true);
    expect(isShown(problems)).toBe(true);
    expect(problems.textContent).toContain("settings.json has a problem, so changes can't be saved until it's fixed:");
    expect(problems.textContent).toContain('Line 3: expected a comma');
    expect($<HTMLButtonElement>('.st-open').disabled).toBe(false);
  });

  it('lists ignored values while settings.json stays writable', () => {
    const { editor } = mount();
    editor.refresh(snapshot({ problems: [`"${KEY}": expected a boolean`] }));
    expect(checkbox().disabled).toBe(false);
    expect($('.st-problems').textContent).toContain('Some values in settings.json were ignored:');
  });

  it('opens settings.json', () => {
    const { deps } = mount();
    $<HTMLButtonElement>('.st-open').click();
    expect(deps.openFile).toHaveBeenCalledTimes(1);
  });

  it('keeps focus on the focused checkbox across a refresh', () => {
    const { editor } = mount();
    const box = checkbox();
    box.focus();
    editor.refresh(unfolded());
    expect(checkbox()).toBe(box);
    expect(document.activeElement).toBe(box);
    expect(box.checked).toBe(false);
  });

  it('leaves the alert and the count untouched when a refresh changes neither', async () => {
    const { editor } = mount();
    const ignored = snapshot({ problems: [`"${KEY}": expected a boolean`] });
    editor.refresh(ignored);
    const lead = $('.st-problems p');
    const observer = new MutationObserver(() => {});
    observer.observe($('.st-editor .st-head'), { childList: true, subtree: true, characterData: true });
    observer.observe($('.st-problems'), { childList: true, subtree: true, characterData: true, attributes: true });

    editor.refresh({ ...ignored, values: { ...SETTING_DEFAULTS, [KEY]: false }, modified: [KEY] });
    await Promise.resolve();
    expect($('.st-problems p')).toBe(lead);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it('moves focus to the checkbox when its focused Reset disappears', () => {
    const { editor } = mount(unfolded());
    reset().focus();
    editor.refresh(snapshot());
    expect(document.activeElement).toBe(checkbox());
  });

  it('moves focus to the search when the focused row is filtered out', () => {
    const { editor } = mount(unfolded());
    type('@modified');
    checkbox().focus();
    editor.refresh(snapshot());
    expect(isShown(row())).toBe(false);
    expect(document.activeElement).toBe(search());
  });

  it('moves focus to Open settings.json when the focused control becomes disabled', () => {
    const { editor } = mount();
    checkbox().focus();
    editor.refresh(snapshot({ writable: false, problems: ['Line 1: unexpected end'] }));
    expect(document.activeElement).toBe($('.st-open'));
  });

  it('restores the checkbox when the write fails', async () => {
    const { deps } = mount();
    deps.update.mockRejectedValueOnce(new Error('disk full'));
    checkbox().click();
    expect(checkbox().checked).toBe(false);
    await vi.waitFor(() => expect(checkbox().checked).toBe(true));
  });



  it('renders a choice setting as a select that writes the picked option', () => {
    const { deps } = mount(snapshot({ values: { ...SETTING_DEFAULTS, 'notifications.doneSound': 'glass' } }));
    const select = $<HTMLSelectElement>('.st-row[data-key="notifications.doneSound"] select');
    expect([...select.options].map((option) => option.value)).toEqual(['bell', 'marimba', 'glass', 'synth', 'retro', 'none']);
    expect(select.value).toBe('glass');
    select.value = 'retro';
    select.dispatchEvent(new Event('change'));
    expect(deps.update).toHaveBeenCalledWith('notifications.doneSound', 'retro');
  });

  it('renders a bounded number as a slider that shows and writes its value', () => {
    const { deps } = mount();
    const volumeRow = $<HTMLElement>('.st-row[data-key="notifications.volume"]');
    const range = volumeRow.querySelector<HTMLInputElement>('input[type="range"]')!;
    const output = volumeRow.querySelector('output')!;
    expect([range.min, range.max, range.value, output.textContent]).toEqual(['0', '100', '70', '70']);
    range.value = '40';
    range.dispatchEvent(new Event('input'));
    expect(output.textContent).toBe('40');
    range.dispatchEvent(new Event('change'));
    expect(deps.update).toHaveBeenCalledWith('notifications.volume', 40);
  });

  it('previews the selected sound only when a preview handler is given', () => {
    mount();
    expect(document.querySelector('.st-preview')).toBeNull();

    const preview = vi.fn();
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    mountSettingsEditor(host, snapshot(), { update: vi.fn().mockResolvedValue(undefined), openFile: vi.fn(), preview });
    const soundRow = $<HTMLElement>('.st-row[data-key="notifications.permissionSound"]');
    soundRow.querySelector<HTMLSelectElement>('select')!.value = 'bell';
    soundRow.querySelector<HTMLButtonElement>('.st-preview')!.click();
    expect(preview).toHaveBeenCalledWith('notifications.permissionSound', 'bell');
    expect(document.querySelectorAll('.st-preview')).toHaveLength(4);
  });

  it('names the select and slider controls with their setting title', () => {
    mount();
    for (const key of ['notifications.doneSound', 'notifications.volume']) {
      const settingRow = $<HTMLElement>(`.st-row[data-key="${key}"]`);
      const control = settingRow.querySelector<HTMLSelectElement | HTMLInputElement>('select, input[type="range"]')!;
      expect(settingRow.querySelector<HTMLLabelElement>('.st-title')!.htmlFor).toBe(control.id);
      expect(control.labels?.[0]?.textContent).toBe(key === 'notifications.volume' ? 'Volume' : 'Done sound');
    }
  });

  it('renders the placement setting as three labelled screen thumbnails', () => {
    const { deps } = mount(snapshot({ values: { ...SETTING_DEFAULTS, 'notifications.position': 'right' } }));
    const placementRow = $<HTMLElement>('.st-row[data-key="notifications.position"]');
    const group = placementRow.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-labelledby')).toBe(placementRow.querySelector('.st-title')!.id);
    const choices = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(choices.map((radio) => radio.value)).toEqual(['left', 'center', 'right']);
    expect(choices.map((radio) => radio.checked)).toEqual([false, false, true]);
    expect([...group.querySelectorAll('.st-placement-caption')].map((caption) => caption.textContent)).toEqual(['Left', 'Center', 'Right']);
    expect(group.querySelectorAll('svg .toast')).toHaveLength(3);

    choices[0].checked = true;
    choices[0].dispatchEvent(new Event('change'));
    expect(deps.update).toHaveBeenCalledWith('notifications.position', 'left');
  });

  it('disables the placement choices while settings.json is unreadable', () => {
    mount(snapshot({ writable: false, problems: ['Line 1: unexpected end'] }));
    const radios = [...document.querySelectorAll<HTMLInputElement>('.st-row[data-key="notifications.position"] input')];
    expect(radios.every((radio) => radio.disabled)).toBe(true);
  });

  it('edits a string setting in a text box and writes it on commit', async () => {
    const { openFile, update } = await mountWith({
      key: 'files.exclude',
      category: { id: 'files', title: 'Files', order: 9 },
      schema: { type: 'string', default: '', description: 'Paths to hide.' },
    });
    const excludeRow = $<HTMLElement>('.st-row[data-key="files.exclude"]');
    const input = excludeRow.querySelector<HTMLInputElement>('input.st-input')!;
    expect(input.type).toBe('text');
    expect(excludeRow.querySelector<HTMLLabelElement>('.st-title')!.htmlFor).toBe(input.id);
    input.value = 'dist/**';
    input.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenCalledWith('files.exclude', 'dist/**');
    expect(openFile).not.toHaveBeenCalled();
  });

  it('renders the key bindings row with the edit-in-settings.json control', () => {
    const { deps } = mount();
    const bindingsRow = $<HTMLElement>('.st-row[data-key="keymap.bindings"]');
    expect(bindingsRow.dataset.type).toBe('bindings');
    expect(bindingsRow.querySelector('.st-desc')!.textContent).toContain('"mod+shift+l"');
    expect($('.st-toc-item[data-category="keymap"]').textContent).toBe('Keyboard shortcuts');
    const edit = bindingsRow.querySelector<HTMLButtonElement>('.st-edit')!;
    expect(edit.getAttribute('aria-label')).toBe('Edit Bindings in settings.json');
    edit.click();
    expect(deps.openFile).toHaveBeenCalledTimes(1);
    expect(deps.update).not.toHaveBeenCalled();
  });

  it('edits a wide-range number in a number box, validating like VS Code, and keeps the slider for narrow ranges', async () => {
    const { editor, update } = await mountWith({
      key: 'editor.wrapColumn',
      category: { id: 'editor', title: 'Editor', order: 9 },
      schema: { type: 'number', default: 80, minimum: 20, maximum: 400, description: 'Wrap long lines.' },
    });
    const wrapRow = $<HTMLElement>('.st-row[data-key="editor.wrapColumn"]');
    const input = wrapRow.querySelector<HTMLInputElement>('input.st-input')!;
    const error = wrapRow.querySelector<HTMLElement>('.st-error')!;
    expect(input.type).toBe('number');
    expect([input.min, input.max, input.value]).toEqual(['20', '400', '80']);
    expect($('.st-row[data-key="notifications.volume"] input[type="range"]')).not.toBeNull();

    input.value = '1000';
    input.dispatchEvent(new Event('input'));
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Value must be less than or equal to 400.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.dispatchEvent(new Event('change'));
    expect(update).not.toHaveBeenCalled();

    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(error.textContent).toBe('Value must be a number.');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(input.value).toBe('80');
    expect(error.hidden).toBe(true);

    input.value = '100';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenCalledWith('editor.wrapColumn', 100);

    editor.refresh(snapshot({ writable: false, problems: ['Line 1: unexpected end'] }));
    expect(input.disabled).toBe(true);
  });

  it('focuses the search on request', () => {
    const { editor } = mount();
    editor.focusSearch();
    expect(document.activeElement).toBe(search());
  });

  describe('custom panels', () => {
    const panel: SettingsPanel = {
      id: 'cli',
      title: 'Command line',
      keywords: ['terminal', 'shell'],
      mount: (section) => section.append(Object.assign(document.createElement('p'), { className: 'panel-body', textContent: 'hello' })),
    };
    const section = () => $<HTMLElement>('.st-panel[data-panel="cli"]');

    it('mounts the panel under its own heading, listed in a separate Integrations group', () => {
      mount(snapshot(), [panel]);
      expect(section().querySelector('.st-group')!.textContent).toBe('Command line');
      expect(section().querySelector('.panel-body')!.textContent).toBe('hello');
      const group = $('nav.st-toc > .st-toc-group[role="group"]');
      expect(group.getAttribute('aria-label')).toBe('Integrations');
      expect(group.querySelector('.st-toc-label')!.textContent).toBe('Integrations');
      expect(group.querySelector('.st-toc-item[data-category="cli"]')!.textContent).toBe('Command line');
      expect(group.querySelector('.st-toc-item[data-category="graph"]')).toBeNull();
      expect($('nav.st-toc').lastElementChild).toBe(group);
    });

    it('keeps the panel out of the default list', () => {
      mount(snapshot(), [panel]);
      expect(isShown(section())).toBe(false);
      expect(isShown(row())).toBe(true);
      expect(count()).toBe('18 settings');
    });

    it('matches the search against the title and keywords', () => {
      mount(snapshot(), [panel]);
      type('terminal');
      expect(isShown(section())).toBe(true);
      expect(isShown(row())).toBe(false);
      expect(isShown($('.st-empty'))).toBe(false);
      expect(count()).toBe('');
      type('fold');
      expect(isShown(section())).toBe(false);
      expect(count()).toBe('1 setting');
    });

    it('hides the panel for @modified', () => {
      mount(unfolded(), [panel]);
      type('@modified');
      expect(isShown(section())).toBe(false);
      expect(isShown(row())).toBe(true);
    });

    it('shows only the panel when its category is picked', () => {
      mount(snapshot(), [panel]);
      $<HTMLButtonElement>('.st-toc-item[data-category="cli"]').click();
      expect(isShown(section())).toBe(true);
      expect(isShown(row())).toBe(false);
      $<HTMLButtonElement>('.st-toc-item[data-category="graph"]').click();
      expect(isShown(section())).toBe(false);
      expect(isShown(row())).toBe(true);
    });
  });
});
