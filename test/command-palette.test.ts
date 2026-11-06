// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandTitle } from '../src/shared/commands';
import { keyLabel } from '../src/shared/commands/keymap';

let commands: typeof import('../src/renderer/commands');
const review = vi.fn();
const memory = vi.fn();

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"].pl-modal');
const other = () => document.getElementById('other') as HTMLInputElement;
const input = () => dialog()!.querySelector<HTMLInputElement>('input')!;
const rows = () => [...dialog()!.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
const labels = () => rows().map((row) => row.querySelector('.pl-label')!.textContent);
const selectedLabel = () => dialog()!.querySelector('[aria-selected="true"] .pl-label')!.textContent;

function press(key: string, target: EventTarget = document.activeElement ?? document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function openPalette() {
  other().focus();
  commands.runCommand('palette.open');
  return dialog()!;
}

beforeAll(async () => {
  document.body.innerHTML = '<input id="other">';
  await import('../src/renderer/features/settings');
  (await import('../src/renderer/command-palette')).mountPalette();
  commands = await import('../src/renderer/commands');
  commands.registerCommand('lantern.open', review);
  commands.registerCommand('memory.open', memory);
});

beforeEach(() => localStorage.clear());

afterEach(() => {
  if (dialog()) press('Escape');
  review.mockReset();
  memory.mockReset();
});

describe('Command palette', () => {
  it('opens a labelled dialog listing only registered commands, search focused', () => {
    const modal = openPalette();
    expect(modal.hasAttribute('aria-modal')).toBe(false);
    expect(document.getElementById(modal.getAttribute('aria-labelledby')!)!.textContent).toBe('Command palette');
    expect(labels()).toEqual(commands.availableCommands().filter((id) => id !== 'palette.open').map(commandTitle));
    expect(labels()).toContain(commandTitle('lantern.open'));
    expect(labels()).not.toContain(commandTitle('project.new'));
    expect(labels()).not.toContain(commandTitle('palette.open'));
    expect(document.activeElement).toBe(input());
  });

  it('keeps every keydown from the document listeners of the modals underneath', () => {
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    openPalette();
    press(' ');
    press('ArrowLeft');
    press('x');
    expect(seen).not.toHaveBeenCalled();
    press('Escape');
    expect(dialog()).toBeNull();
    press(' ');
    expect(seen).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', seen);
  });

  it('shows the key label of a bound command', () => {
    openPalette();
    const row = rows().find((r) => r.querySelector('.pl-label')!.textContent === commandTitle('lantern.open'))!;
    expect(row.querySelector('.pl-keys')!.textContent).toBe(keyLabel('mod+shift+l', 'linux'));
    expect(row.querySelector('.pl-keys')!.getAttribute('aria-hidden')).toBe('true');
    expect(row.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+L');
  });

  it('filters as the user types', () => {
    openPalette();
    input().value = 'memory';
    input().dispatchEvent(new Event('input'));
    expect(labels()).toEqual([commandTitle('memory.open')]);
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('wraps the selection with the arrow keys', () => {
    openPalette();
    expect(selectedLabel()).toBe(labels()[0]);
    press('ArrowUp');
    expect(selectedLabel()).toBe(labels().at(-1));
    press('ArrowDown');
    expect(selectedLabel()).toBe(labels()[0]);
  });

  it('ArrowDown and Enter close the dialog, run the command, restore focus and bump its usage', () => {
    review.mockImplementation(() => expect(dialog()).toBeNull());
    openPalette();
    const target = labels().indexOf(commandTitle('lantern.open'));
    for (let i = 0; i < target; i++) press('ArrowDown');
    press('Enter');
    expect(review).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(other());
    expect(JSON.parse(localStorage.getItem('lantern.commandUsage')!)).toEqual({ 'lantern.open': 1 });
    openPalette();
    expect(labels()[0]).toBe(commandTitle('lantern.open'));
  });

  it('Enter on the Close button closes the dialog without running a command', () => {
    const modal = openPalette();
    const close = modal.querySelector<HTMLButtonElement>('.modal-close')!;
    close.focus();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    close.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    close.click();
    expect(dialog()).toBeNull();
    expect(review).not.toHaveBeenCalled();
    expect(memory).not.toHaveBeenCalled();
  });

  it('runs a command clicked in the list', () => {
    openPalette();
    rows().find((r) => r.textContent === commandTitle('memory.open'))!.click();
    expect(dialog()).toBeNull();
    expect(memory).toHaveBeenCalledOnce();
  });

  it('closes on Escape, restoring focus to the opener', () => {
    openPalette();
    press('Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(other());
  });

  it('has no backdrop and closes when focus leaves it, keeping the focus where it went', () => {
    const modal = openPalette();
    expect(modal.hasAttribute('aria-modal')).toBe(false);
    modal.querySelector<HTMLButtonElement>('.modal-close')!.focus();
    expect(dialog()).not.toBeNull();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('a press outside closes only the palette, not the dialog whose backdrop it lands on', () => {
    const under = document.createElement('div');
    under.className = 'modal';
    const closeUnder = vi.fn();
    under.addEventListener('click', closeUnder);
    document.body.append(under);
    openPalette();
    under.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    under.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog()).toBeNull();
    expect(closeUnder).not.toHaveBeenCalled();
    under.remove();
  });

  it('a press outside on a plain element swallows no later click', () => {
    const under = document.createElement('div');
    under.className = 'modal';
    const closeUnder = vi.fn();
    under.addEventListener('click', closeUnder);
    document.body.append(under);
    openPalette();
    other().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    under.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closeUnder).toHaveBeenCalledOnce();
    under.remove();
  });

  it('dismissPalette closes an open palette and gives focus back to the opener', async () => {
    openPalette();
    (await import('../src/renderer/command-palette')).dismissPalette();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(other());
  });

  it('a second palette.open focuses the input instead of opening another dialog', () => {
    openPalette();
    other().focus();
    commands.runCommand('palette.open');
    expect(document.querySelectorAll('.pl-modal')).toHaveLength(1);
    expect(document.activeElement).toBe(input());
  });

  it('blurs a focused webview on open and refocuses it on close', () => {
    const webview = document.createElement('webview');
    webview.tabIndex = -1;
    document.body.append(webview);
    webview.focus();
    const blur = vi.spyOn(webview, 'blur');
    commands.runCommand('palette.open');
    expect(blur).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input());
    press('Escape');
    expect(document.activeElement).toBe(webview);
    webview.remove();
  });
});

describe('command palette rows', () => {
  it('groups recently used commands first, splits keys into chips and highlights matches', () => {
    localStorage.setItem('lantern.commandUsage', JSON.stringify({ 'memory.open': 2 }));
    openPalette();
    expect(rows()[0].querySelector('.pl-group')!.textContent).toBe('recently used');
    expect(rows()[1].querySelector('.pl-group')!.textContent).toBe('other commands');
    expect(rows()[1].classList.contains('pl-row-sep')).toBe(true);
    const review = rows().find((r) => r.querySelector('.pl-label')!.textContent === commandTitle('lantern.open'))!;
    expect([...review.querySelectorAll('.pl-key')].map((k) => k.textContent)).toEqual(['Ctrl', 'Shift', 'L']);
    input().value = 'arch';
    input().dispatchEvent(new Event('input'));
    expect(labels()).toEqual([commandTitle('lantern.open')]);
    expect(rows()[0].querySelector('.pl-hl')!.textContent).toBe('Arch');
    expect(rows()[0].querySelector('.pl-group')).toBeNull();
  });
});
