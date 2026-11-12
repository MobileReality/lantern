// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SETTING_DEFAULTS } from '../src/shared/settings-registry';
import type { SettingsSnapshot, SettingsUpdateResult } from '../src/shared/settings-registry';

const KEY = 'graph.foldFilesWhenZoomedOut';
const DEFAULTS: SettingsSnapshot = { values: SETTING_DEFAULTS, modified: [], problems: [], writable: true };
const UNFOLDED: SettingsSnapshot = { ...DEFAULTS, values: { ...SETTING_DEFAULTS, [KEY]: false }, modified: [KEY] };

const settingsUpdate = vi.fn<(key: string, value: unknown) => Promise<SettingsUpdateResult>>();
const settingsOpenFile = vi.fn().mockResolvedValue('');
let runCommand: (id: string) => boolean;

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"].st-modal');
const other = () => document.getElementById('other') as HTMLInputElement;
const search = () => dialog()!.querySelector<HTMLInputElement>('.st-search')!;
const checkbox = () => dialog()!.querySelector<HTMLInputElement>(`.st-row[data-key="${KEY}"] input[type="checkbox"]`)!;
const status = () => dialog()!.querySelector('.st-status')!;
let replaceSettings: (next: SettingsSnapshot, changed: readonly (typeof KEY)[]) => void;

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement ?? document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function openFromMenu() {
  other().focus();
  runCommand('settings.open');
  return dialog()!;
}

beforeAll(async () => {
  document.body.innerHTML = '<input id="other">';
  const cliStatus = vi.fn().mockResolvedValue(null);
  const rtkStatus = vi.fn().mockResolvedValue({ found: false, path: null, version: null, edition: null, hookFound: false, hookFiles: [], reason: 'not-installed' });
  window.ccmws = { settingsUpdate, settingsOpenFile, cliStatus, rtkStatus } as unknown as Window['ccmws'];
  ({ replaceSettings } = await import('../src/renderer/lib/settings-state'));
  await import('../src/renderer/features/settings');
  (await import('../src/renderer/command-palette')).mountPalette();
  ({ runCommand } = await import('../src/renderer/commands'));
});

afterEach(() => {
  dialog()?.querySelector<HTMLButtonElement>('.modal-close')!.click();
  replaceSettings(DEFAULTS, []);
  settingsUpdate.mockReset();
  settingsOpenFile.mockClear();
});

describe('Settings dialog', () => {
  it('shows the Command line panel from its table of contents entry', async () => {
    const modal = openFromMenu();
    const panel = modal.querySelector<HTMLElement>('.st-panel[data-panel="cli"]')!;
    expect(panel.hidden).toBe(true);
    modal.querySelector<HTMLButtonElement>('.st-toc-group .st-toc-item[data-category="cli"]')!.click();
    expect(panel.hidden).toBe(false);
    expect(checkbox().closest<HTMLElement>('.st-row')!.hidden).toBe(true);
    await vi.waitFor(() => expect(modal.querySelector('.cli-state')!.textContent).toMatch(/development run/));
  });

  it('the settings.open command opens a labelled modal with the editor, search focused', () => {
    const modal = openFromMenu();
    expect(modal.classList.contains('modal')).toBe(true);
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(modal.getAttribute('aria-labelledby')!)!.textContent).toBe('Settings');
    expect(modal.querySelector('.modal-card.st-card')).not.toBeNull();
    expect(modal.querySelector('.modal-close')!.getAttribute('aria-label')).toBe('Close settings');
    expect(checkbox().checked).toBe(true);
    expect(document.activeElement).toBe(search());
  });

  it('closes on Escape and restores focus to the previously focused element', () => {
    openFromMenu();
    press('Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(other());
  });

  it('a second settings.open while open keeps it open and refocuses search', () => {
    openFromMenu();
    checkbox().focus();
    runCommand('settings.open');
    expect(document.querySelectorAll('.st-modal')).toHaveLength(1);
    expect(document.activeElement).toBe(search());
  });

  function otherModal(withClose: boolean) {
    const blocker = document.createElement('div');
    blocker.className = 'modal';
    blocker.innerHTML = withClose ? '<div class="modal-card"><div class="modal-head"><button class="modal-close">x</button></div></div>' : '<div class="modal-card"></div>';
    blocker.querySelector('.modal-close')?.addEventListener('click', () => blocker.classList.add('hidden'));
    document.body.append(blocker);
    return blocker;
  }

  it('closes another open modal through its own close button and opens settings', () => {
    const blocker = otherModal(true);
    runCommand('settings.open');
    expect(blocker.classList.contains('hidden')).toBe(true);
    expect(dialog()).not.toBeNull();
    blocker.remove();
  });

  it('does not open over a modal it cannot close', () => {
    const blocker = otherModal(false);
    runCommand('settings.open');
    blocker.remove();
    expect(dialog()).toBeNull();
  });

  it('keeps Tab inside the dialog, wrapping at both ends', () => {
    const modal = openFromMenu();
    const nodes = [...modal.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter((n) => !n.closest('[hidden]'));
    const last = nodes[nodes.length - 1];
    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(nodes[0]);
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    nodes[0].dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('lets Tab move normally between controls inside the dialog', () => {
    openFromMenu();
    search().focus();
    const middle = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    search().dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
  });

  it('leaves Escape to a palette opened above it', () => {
    openFromMenu();
    runCommand('palette.open');
    const palette = document.querySelector<HTMLElement>('[role="dialog"].pl-modal')!;
    expect(palette.contains(document.activeElement)).toBe(true);
    press('Escape');
    expect(document.querySelector('.pl-modal')).toBeNull();
    expect(dialog()).not.toBeNull();
  });

  it('pulls focus back into the dialog when it is outside', () => {
    const modal = openFromMenu();
    other().focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    other().dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(modal.contains(document.activeElement)).toBe(true);
  });

  it('reverts an unsaved edit in a number box on Escape, and closes only on the next Escape', () => {
    const modal = openFromMenu();
    const box = modal.querySelector<HTMLInputElement>('.st-row[data-key="reasons.maxReplyCharacters"] input')!;
    expect(box.value).toBe('16000');
    box.focus();
    box.value = '100';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    press('Escape', {}, box);
    expect(dialog()).not.toBeNull();
    expect(box.value).toBe('16000');
    press('Escape', {}, box);
    expect(dialog()).toBeNull();
  });

  it('clears a non-empty search on Escape instead of closing', () => {
    openFromMenu();
    search().value = 'fold';
    press('Escape', {}, search());
    expect(dialog()).not.toBeNull();
    expect(search().value).toBe('');
    press('Escape', {}, search());
    expect(dialog()).toBeNull();
  });

  it('closes on a backdrop click, not on a click inside the card', () => {
    const modal = openFromMenu();
    modal.querySelector<HTMLElement>('.modal-card')!.click();
    expect(dialog()).not.toBeNull();
    modal.click();
    expect(dialog()).toBeNull();
  });

  it('refreshes the editor when settings change while open, and stops listening once closed', () => {
    openFromMenu();
    replaceSettings(UNFOLDED, [KEY]);
    expect(checkbox().checked).toBe(false);
    const box = checkbox();
    press('Escape');
    replaceSettings(DEFAULTS, [KEY]);
    expect(box.checked).toBe(false);
  });

  it('shows a failed save and rolls the checkbox back', async () => {
    settingsUpdate.mockResolvedValue({ ok: false, error: 'settings.json is read-only' });
    openFromMenu();
    checkbox().click();
    expect(settingsUpdate).toHaveBeenCalledWith(KEY, false);
    await vi.waitFor(() => expect(status().textContent).toBe("Couldn't save: settings.json is read-only"));
    expect(status().getAttribute('role')).toBe('status');
    await vi.waitFor(() => expect(checkbox().checked).toBe(true));
  });

  it('clears the error on the next successful save', async () => {
    settingsUpdate.mockRejectedValueOnce(new Error('IPC down')).mockResolvedValue({ ok: true, snapshot: UNFOLDED });
    openFromMenu();
    checkbox().click();
    await vi.waitFor(() => expect(status().textContent).toBe("Couldn't save: IPC down"));
    await vi.waitFor(() => expect(checkbox().checked).toBe(true));
    checkbox().click();
    await vi.waitFor(() => expect(status().textContent).toBe(''));
  });

  it('opens settings.json through the bridge and clears an earlier error', async () => {
    settingsUpdate.mockResolvedValue({ ok: false, error: 'read-only' });
    openFromMenu();
    checkbox().click();
    await vi.waitFor(() => expect(status().textContent).toBe("Couldn't save: read-only"));
    dialog()!.querySelector<HTMLButtonElement>('.st-open')!.click();
    expect(settingsOpenFile).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(status().textContent).toBe(''));
  });

  it.each([
    ['returns an error', () => settingsOpenFile.mockResolvedValueOnce('No application knows how to open it')],
    ['rejects', () => settingsOpenFile.mockRejectedValueOnce(new Error('No application knows how to open it'))],
  ])('shows the problem when opening settings.json %s', async (_, fail) => {
    fail();
    openFromMenu();
    dialog()!.querySelector<HTMLButtonElement>('.st-open')!.click();
    await vi.waitFor(() => expect(status().textContent).toBe("Couldn't open settings.json: No application knows how to open it"));
  });

  it('stops handling Escape once closed', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    openFromMenu();
    press('Escape');
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    remove.mockRestore();
    other().focus();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    other().dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(other());
  });

  it('closes without throwing when the opener left the page', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    runCommand('settings.open');
    opener.remove();
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onError);
    press('Escape');
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
    expect(dialog()).toBeNull();
  });
});
