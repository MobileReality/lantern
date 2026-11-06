import { mountSettingsEditor } from '../lib/settings-editor';
import { cliPanel } from './cli-panel';
import { rtkPanel } from './rtk-panel';
import { onSettingsChanged, settingsSnapshot } from '../lib/settings-state';
import { el } from '../lib/util';
import { trapTab } from '@renderer/lib/modal-focus';
import CLOSE_ICON from '@renderer/assets/icons/close.svg';
import { registerCommand } from '../commands';
import type { SettingKey, SettingsUpdateResult } from '../../shared/settings-registry';
import { type NotificationTimbre, SOUND_SETTING_FOR_KIND } from '../../shared/settings-notifications';
import { playSound, type SoundKind } from '../lib/notification-sound';

const TITLE_ID = 'st-dialog-title';
const OPEN_MODAL = '.modal:not(.hidden)';

const SOUND_FOR_SETTING = new Map<string, SoundKind>(Object.entries(SOUND_SETTING_FOR_KIND).map(([kind, key]) => [key, kind as SoundKind]));

let focusActiveSearch: (() => void) | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function saveSetting(key: SettingKey, value: unknown, status: HTMLElement): Promise<void> {
  const result = await window.ccmws
    .settingsUpdate(key, value)
    .catch((error: unknown): SettingsUpdateResult => ({ ok: false, error: errorMessage(error) }));
  status.textContent = result.ok ? '' : `Couldn't save: ${result.error}`;
  if (!result.ok) throw new Error(result.error);
}

async function openSettingsFile(status: HTMLElement): Promise<void> {
  const error = await window.ccmws.settingsOpenFile().catch(errorMessage);
  status.textContent = error ? `Couldn't open settings.json: ${error}` : '';
}

function isClearingSearch(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.classList.contains('st-search') && target.value !== '';
}

function isRevertingEdit(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.classList.contains('st-input') && target.value !== (target.dataset.current ?? '');
}

export function closeModals(): boolean {
  const open = [...document.querySelectorAll<HTMLElement>(OPEN_MODAL)].reverse();
  for (const modal of open) modal.querySelector<HTMLElement>('.modal-head .modal-close')?.click();
  return !document.querySelector(OPEN_MODAL);
}

function openSettings(opener: Element | null): void {
  const modal = el('div', 'modal st-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', TITLE_ID);
  const card = el('div', 'modal-card st-card');
  const head = el('div', 'modal-head');
  const title = el('span', 'modal-title', 'Settings');
  title.id = TITLE_ID;
  const status = el('p', 'st-status');
  status.setAttribute('role', 'status');
  const close = el('button', 'modal-close');
  close.type = 'button';
  close.dataset.tip = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close settings');
  close.innerHTML = CLOSE_ICON;
  head.append(title, status, close);
  const host = el('div', 'st-host');
  card.append(head, host);
  modal.append(card);
  document.body.append(modal);

  const editor = mountSettingsEditor(host, settingsSnapshot(), {
    update: (key, value) => saveSetting(key, value, status),
    openFile: () => void openSettingsFile(status),
    preview: (key, value) => {
      const kind = SOUND_FOR_SETTING.get(key);
      if (kind) playSound(kind, value as NotificationTimbre, settingsSnapshot().values['notifications.volume'] / 100);
    },
    panels: [cliPanel, rtkPanel],
  });
  const unsubscribe = onSettingsChanged(() => editor.refresh(settingsSnapshot()));

  function dismiss(): void {
    window.removeEventListener('keydown', onKey, true);
    unsubscribe();
    focusActiveSearch = null;
    modal.remove();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }
  function onKey(e: KeyboardEvent): void {
    const owner = e.target instanceof Element ? e.target.closest('.modal') : null;
    if (owner && owner !== modal) return;
    if (e.key === 'Tab') return trapTab(e, modal);
    if (e.key !== 'Escape' || isClearingSearch(e.target) || isRevertingEdit(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    dismiss();
  }

  focusActiveSearch = () => editor.focusSearch();
  window.addEventListener('keydown', onKey, true);
  close.addEventListener('click', dismiss);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) dismiss();
  });
  editor.focusSearch();
}

function showSettings(opener: Element | null): void {
  if (focusActiveSearch) return focusActiveSearch();
  if (!closeModals()) return;
  openSettings(opener);
}

if (!new URLSearchParams(location.search).has('popout')) {
  registerCommand('settings.open', () => showSettings(document.activeElement));
  registerCommand('settings.openFile', () => void window.ccmws.settingsOpenFile());
}

export { showSettings };
