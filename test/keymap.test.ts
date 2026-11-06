import { describe, expect, it } from 'vitest';
import {
  accelerator,
  ariaShortcut,
  keyChips,
  commandForInput,
  defaultBindings,
  keyLabel,
  resolveKeymap,
} from '../src/shared/commands/keymap';
import { normalizeKey } from '../src/shared/commands/key-syntax';
import type { KeyInput } from '../src/shared/commands/keymap';

function input(key: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { type: 'keyDown', key, alt: false, shift: false, meta: false, control: false, isAutoRepeat: false, ...mods };
}

describe('normalizeKey', () => {
  it('orders modifiers mod, alt, shift and lowercases the key', () => {
    expect(normalizeKey('Shift+Alt+Mod+P')).toBe('mod+alt+shift+p');
    expect(normalizeKey(' mod + , ')).toBe('mod+,');
    expect(normalizeKey('F1')).toBe('f1');
  });

  it('rejects a string with no key or more than one', () => {
    expect(normalizeKey('')).toBeUndefined();
    expect(normalizeKey('mod')).toBeUndefined();
    expect(normalizeKey('mod+')).toBeUndefined();
    expect(normalizeKey('mod+p+q')).toBeUndefined();
  });

  it('accepts only a printable character or an F-key, which are all a key event can match', () => {
    expect(normalizeKey('mod+/')).toBe('mod+/');
    expect(normalizeKey('shift+f1')).toBe('shift+f1');
    expect(normalizeKey('mod+space')).toBeUndefined();
    expect(normalizeKey('mod+up')).toBeUndefined();
    expect(normalizeKey('mod+pageup')).toBeUndefined();
    expect(normalizeKey('f13')).toBeUndefined();
  });
});

describe('resolveKeymap', () => {
  it('resolves the defaults', () => {
    const { byKey, byCommand } = resolveKeymap(defaultBindings());
    expect(byKey.get('mod+,')).toBe('settings.open');
    expect(byCommand.get('lantern.open')).toBe('mod+shift+l');
    expect(byCommand.has('project.new')).toBe(false);
  });

  it('lets a later user entry win a key and label the command', () => {
    const { byKey, byCommand } = resolveKeymap([
      ...defaultBindings(),
      { key: 'mod+,', command: 'lantern.open' },
    ]);
    expect(byKey.get('mod+,')).toBe('lantern.open');
    expect(byCommand.get('lantern.open')).toBe('mod+,');
    expect(byCommand.has('settings.open')).toBe(false);
    expect(byKey.get('mod+shift+l')).toBe('lantern.open');
  });

  it('normalises user keys before matching', () => {
    const { byKey } = resolveKeymap([{ key: 'Shift+Mod+M', command: 'memory.open' }]);
    expect(byKey.get('mod+shift+m')).toBe('memory.open');
  });

  it('removes earlier entries for the command and key with -id', () => {
    const { byKey, byCommand } = resolveKeymap([
      ...defaultBindings(),
      { key: 'mod+alt+i', command: '-editor.devtools' },
      { key: 'mod+o', command: '-lantern.open' },
    ]);
    expect(byKey.has('mod+alt+i')).toBe(false);
    expect(byCommand.has('editor.devtools')).toBe(false);
    expect(byKey.get('mod+o')).toBe('project.addFolder');
  });

  it('skips unknown commands and invalid keys', () => {
    const { byKey } = resolveKeymap([
      { key: 'mod+k', command: 'nope.open' },
      { key: 'mod+o', command: '-nope.open' },
      { key: 'mod', command: 'memory.open' },
      { key: 'mod+o', command: 'project.addFolder' },
    ]);
    expect([...byKey]).toEqual([['mod+o', 'project.addFolder']]);
  });
});

describe('commandForInput', () => {
  const { byKey } = resolveKeymap([
    { key: 'mod+alt+p', command: 'lantern.open' },
    { key: 'f1', command: 'memory.open' },
  ]);

  it('maps meta to mod on darwin and control elsewhere', () => {
    expect(commandForInput(input('p', { meta: true, alt: true }), byKey, 'mac')).toBe('lantern.open');
    expect(commandForInput(input('P', { control: true, alt: true }), byKey, 'windows')).toBe('lantern.open');
    expect(commandForInput(input('p', { control: true, alt: true }), byKey, 'linux')).toBe('lantern.open');
  });

  it('never matches with the other platform modifier held', () => {
    expect(commandForInput(input('p', { control: true, alt: true }), byKey, 'mac')).toBeUndefined();
    expect(commandForInput(input('p', { meta: true, control: true, alt: true }), byKey, 'mac')).toBeUndefined();
    expect(commandForInput(input('p', { meta: true, alt: true }), byKey, 'linux')).toBeUndefined();
    expect(commandForInput(input('p', { meta: true, control: true, alt: true }), byKey, 'windows')).toBeUndefined();
  });

  it('ignores keyUp and auto-repeat', () => {
    expect(commandForInput(input('p', { type: 'keyUp', meta: true, alt: true }), byKey, 'mac')).toBeUndefined();
    expect(commandForInput(input('p', { isAutoRepeat: true, meta: true, alt: true }), byKey, 'mac')).toBeUndefined();
  });

  it('reads the physical code when Option rewrites the key on a mac', () => {
    expect(commandForInput(input('π', { code: 'KeyP', meta: true, alt: true }), byKey, 'mac')).toBe('lantern.open');
    expect(commandForInput(input('F1', { code: 'F1' }), byKey, 'mac')).toBe('memory.open');
    expect(commandForInput(input('π', { code: 'KeyQ', meta: true, alt: true }), byKey, 'mac')).toBeUndefined();
  });

  it('reads the typed key on non-QWERTY Latin layouts', () => {
    const map = resolveKeymap([
      { key: 'mod+p', command: 'project.filter' },
      { key: 'mod+r', command: 'lantern.open' },
      { key: 'mod+,', command: 'settings.open' },
      { key: 'mod+m', command: 'memory.open' },
    ]).byKey;
    expect(commandForInput(input('p', { code: 'KeyR', meta: true }), map, 'mac')).toBe('project.filter');
    expect(commandForInput(input('π', { code: 'KeyP', meta: true }), map, 'mac')).toBe('project.filter');
    expect(commandForInput(input(',', { code: 'KeyM', meta: true }), map, 'mac')).toBe('settings.open');
  });

  it('matches an F-key and misses a key with extra modifiers', () => {
    expect(commandForInput(input('F1'), byKey, 'mac')).toBe('memory.open');
    expect(commandForInput(input('p', { meta: true, alt: true, shift: true }), byKey, 'mac')).toBeUndefined();
  });
});

describe('labels', () => {
  it('shows symbols on darwin and words elsewhere', () => {
    expect(keyLabel('mod+alt+p', 'mac')).toBe('⌘⌥P');
    expect(keyLabel('mod+shift+l', 'mac')).toBe('⌘⇧L');
    expect(keyLabel('mod+alt+p', 'windows')).toBe('Ctrl+Alt+P');
    expect(keyLabel('mod+,', 'linux')).toBe('Ctrl+,');
    expect(keyLabel('f1', 'mac')).toBe('F1');
  });

  it('splits a binding into one chip per key', () => {
    expect(keyChips('mod+shift+p', 'mac')).toEqual(['⌘', '⇧', 'P']);
    expect(keyChips('mod+,', 'mac')).toEqual(['⌘', ',']);
    expect(keyChips('f1', 'mac')).toEqual(['F1']);
    expect(keyChips('mod+shift+p', 'linux')).toEqual(['Ctrl', 'Shift', 'P']);
  });

  it('spells ARIA keyshortcuts per platform', () => {
    expect(ariaShortcut('mod+shift+p', 'mac')).toBe('Meta+Shift+P');
    expect(ariaShortcut('mod+shift+p', 'linux')).toBe('Control+Shift+P');
    expect(ariaShortcut('f1', 'windows')).toBe('F1');
  });

  it('builds Electron accelerators', () => {
    expect(accelerator('mod+alt+p')).toBe('CmdOrCtrl+Alt+P');
    expect(accelerator('mod+,')).toBe('CmdOrCtrl+,');
    expect(accelerator('mod+shift+l')).toBe('CmdOrCtrl+Shift+L');
    expect(accelerator('f1')).toBe('F1');
  });
});
