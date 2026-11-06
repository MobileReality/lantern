import { availableCommands, registerCommand, runCommand } from '../commands';
import { bumpUsage, readUsage } from './usage';
import { labelSegments, paletteItems } from './items';
import { onSettingsChanged, settingValue, settingsSnapshot } from '../lib/settings-state';
import { byId, el, currentPlatform } from '../lib/util';
import { ariaShortcut, keyChips, keyLabel, resolveUserKeymap } from '../../shared/commands/keymap';
import { affectsSetting } from '../../shared/settings-registry';
import type { CommandId } from '../../shared/commands';
import { trapTab } from '../lib/modal-focus';
import CLOSE_ICON from '@renderer/assets/icons/close.svg';

const TITLE_ID = 'pl-dialog-title';
const SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="6.8" cy="6.8" r="4.3" /><path d="m10 10 3.3 3.3" /></svg>';
const LIST_ID = 'pl-list';

let activeInput: HTMLInputElement | null = null;
let dismissActive = () => {};

function buildDialog() {
  const modal = el('div', 'modal pl-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-labelledby', TITLE_ID);
  const card = el('div', 'modal-card pl-card');
  const head = el('div', 'modal-head pl-head');
  const title = el('span', 'modal-title', 'Command palette');
  title.id = TITLE_ID;
  const close = el('button', 'modal-close pl-close');
  close.type = 'button';
  close.dataset.tip = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close command palette');
  close.innerHTML = CLOSE_ICON;
  head.append(title, close);
  const field = el('div', 'pl-field');
  field.innerHTML = SEARCH_ICON;
  const input = el('input', 'pl-search');
  input.type = 'text';
  input.placeholder = 'Search commands';
  input.setAttribute('aria-label', 'Search commands');
  input.setAttribute('aria-controls', LIST_ID);
  const list = el('ul', 'pl-list');
  list.id = LIST_ID;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-labelledby', TITLE_ID);
  field.append(input);
  card.append(head, field, list);
  modal.append(card);
  return { modal, card, close, input, list };
}

function openPalette(opener: Element | null): void {
  const { modal, card, close, input, list } = buildDialog();
  document.body.append(modal);
  place();
  requestAnimationFrame(() => card.classList.add('pl-open'));

  const { byCommand } = resolveUserKeymap(settingsSnapshot().values['keymap.bindings']);
  const usage = readUsage();
  const platform = currentPlatform();
  let ids: CommandId[] = [];
  let selected = 0;

  function select(index: number): void {
    selected = ids.length ? (index + ids.length) % ids.length : 0;
    const rows = [...list.children] as HTMLElement[];
    rows.forEach((row, i) => { row.setAttribute('aria-selected', String(i === selected)); });
    const row = rows[selected];
    if (!row) return input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView?.({ block: 'nearest' });
  }
  function render(): void {
    const items = paletteItems({ available: availableCommands(), byCommand, usage, query: input.value });
    ids = items.map((item) => item.id);
    const recent = items.filter((item) => (usage[item.id] ?? 0) > 0).length;
    const groupAt: Record<number, string> = recent > 0 && recent < items.length ? { 0: 'recently used', [recent]: 'other commands' } : {};
    list.replaceChildren(
      ...items.map((item, i) => {
        const row = el('li', i === recent && i > 0 ? 'pl-row pl-row-sep' : 'pl-row');
        row.id = `pl-row-${i}`;
        row.setAttribute('role', 'option');
        const label = el('span', 'pl-label');
        for (const segment of labelSegments(item.label, input.value)) label.append(segment.hit ? el('span', 'pl-hl', segment.text) : segment.text);
        row.append(label);
        const group = groupAt[i];
        if (group) row.append(el('span', 'pl-group', group));
        if (item.keys) {
          const kbd = el('kbd', 'pl-keys');
          kbd.setAttribute('aria-hidden', 'true');
          keyChips(item.keys, platform).forEach((chip, n) => {
            if (n > 0 && platform !== 'mac') kbd.append(el('span', 'pl-key-sep', '+'));
            kbd.append(el('span', 'pl-key', chip));
          });
          row.setAttribute('aria-keyshortcuts', ariaShortcut(item.keys, platform));
          row.append(kbd);
        }
        row.addEventListener('click', () => choose(i));
        return row;
      }),
    );
    select(0);
  }
  function place(): void {
    const anchor = document.getElementById('command-palette-btn');
    const rect = anchor && getComputedStyle(anchor).display !== 'none' && !document.body.classList.contains('popout') ? anchor.getBoundingClientRect() : null;
    card.classList.toggle('pl-anchored', !!rect);
    card.style.left = rect ? `${rect.left}px` : '';
    card.style.top = rect ? `${rect.top}px` : '';
    card.style.width = rect ? `${rect.width}px` : '';
  }
  function dismiss(restoreFocus = true): void {
    if (!activeInput) return;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    document.removeEventListener('mousedown', onPress, true);
    activeInput = null;
    dismissActive = () => {};
    modal.remove();
    if (restoreFocus && opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }
  function choose(index: number): void {
    const id = ids[index];
    if (!id) return;
    bumpUsage(id);
    dismiss();
    runCommand(id);
  }
  function onPress(e: MouseEvent): void {
    if (e.target instanceof Node && card.contains(e.target)) return;
    dismiss(false);
    if (!(e.target instanceof Element && e.target.classList.contains('modal'))) return;
    const backdrop = e.target;
    const swallow = (click: MouseEvent) => {
      if (click.target === backdrop) click.stopPropagation();
    };
    document.addEventListener('click', swallow, { capture: true, once: true });
    document.addEventListener('mousedown', () => document.removeEventListener('click', swallow, true), { capture: true, once: true });
  }
  function onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Tab') return trapTab(e, modal);
    if (e.key === 'Escape') dismiss();
    else if (e.target !== input) return;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') select(selected + (e.key === 'ArrowDown' ? 1 : -1));
    else if (e.key === 'Enter') choose(selected);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  activeInput = input;
  dismissActive = () => dismiss();
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  input.addEventListener('input', render);
  close.addEventListener('click', () => dismiss());
  modal.addEventListener('focusout', (e) => {
    if (!(e.relatedTarget instanceof Node && modal.contains(e.relatedTarget))) dismiss(false);
  });
  card.addEventListener('mousedown', (e) => {
    if (e.target !== input && !(e.target instanceof Node && close.contains(e.target))) e.preventDefault();
  });
  document.addEventListener('mousedown', onPress, true);
  render();
  if (opener instanceof HTMLElement && opener.tagName === 'WEBVIEW') opener.blur();
  input.focus();
}

export function dismissPalette(): void {
  dismissActive();
}

function renderFieldKeys(): void {
  const keys = resolveUserKeymap(settingValue('keymap.bindings')).byCommand.get('palette.open');
  const platform = currentPlatform();
  byId('command-palette-keys').textContent = keys ? keyLabel(keys, platform) : '';
  if (keys) byId('command-palette-btn').setAttribute('aria-keyshortcuts', ariaShortcut(keys, platform));
  else byId('command-palette-btn').removeAttribute('aria-keyshortcuts');
}

export function mountPalette(): { renderFieldKeys: () => void } {
  registerCommand('palette.open', () => {
    if (activeInput) return activeInput.focus();
    openPalette(document.activeElement);
  });
  onSettingsChanged((changed) => {
    if (affectsSetting('keymap', changed)) renderFieldKeys();
  });
  return { renderFieldKeys };
}
