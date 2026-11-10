import type { PlatformName } from '../platform';
import type { KeyBinding } from '../settings-schema';
import { normalizeKey } from './key-syntax';
import { COMMANDS, isCommandId } from '.';
import type { CommandId } from '.';

export type { KeyBinding };

export interface Keymap {
  byKey: Map<string, CommandId>;
  byCommand: Map<CommandId, string>;
}

export interface KeyInput {
  type: string;
  key: string;
  code?: string;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  control: boolean;
  isAutoRepeat: boolean;
}

interface ModifierLabels {
  readonly mod: string;
  readonly alt: string;
  readonly shift: string;
  readonly enter: string;
  readonly separator: string;
}

const UI_WINDOWS: ModifierLabels = { mod: 'Ctrl', alt: 'Alt', shift: 'Shift', enter: 'Enter', separator: '+' };
const UI_LABELS: Record<PlatformName, ModifierLabels> = {
  mac: { mod: '⌘', alt: '⌥', shift: '⇧', enter: '↩', separator: '' },
  windows: UI_WINDOWS,
  linux: UI_WINDOWS,
};

const ARIA_WINDOWS: ModifierLabels = { mod: 'Control', alt: 'Alt', shift: 'Shift', enter: 'Enter', separator: '+' };
const ARIA_LABELS: Record<PlatformName, ModifierLabels> = {
  mac: { mod: 'Meta', alt: 'Alt', shift: 'Shift', enter: 'Enter', separator: '+' },
  windows: ARIA_WINDOWS,
  linux: ARIA_WINDOWS,
};

const ACCELERATOR_LABELS: ModifierLabels = { mod: 'CmdOrCtrl', alt: 'Alt', shift: 'Shift', enter: 'Enter', separator: '+' };

export function defaultBindings(): KeyBinding[] {
  return COMMANDS.flatMap((c) => (c.schema.keys ? [{ key: c.schema.keys, command: c.id }] : []));
}

export function resolveKeymap(entries: readonly KeyBinding[]): Keymap {
  let live: { key: string; command: CommandId }[] = [];
  for (const entry of entries) {
    const removal = entry.command.startsWith('-');
    const command = removal ? entry.command.slice(1) : entry.command;
    const key = normalizeKey(entry.key);
    if (!key || !isCommandId(command)) continue;
    if (removal) live = live.filter((b) => b.key !== key || b.command !== command);
    else live.push({ key, command });
  }
  const byKey = new Map(live.map((b) => [b.key, b.command]));
  const byCommand = new Map<CommandId, string>();
  for (const b of live) if (byKey.get(b.key) === b.command) byCommand.set(b.command, b.key);
  return { byKey, byCommand };
}

export function resolveUserKeymap(bindings: readonly KeyBinding[]): Keymap {
  return resolveKeymap([...defaultBindings(), ...bindings]);
}

function inputKey(input: KeyInput): string {
  const key = input.key.toLowerCase();
  if (/^[a-z0-9,]$/.test(key)) return key;
  const code = input.code ?? '';
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  if (code === 'Comma') return ',';
  if (/^F([1-9]|1[0-2])$/.test(code)) return code.toLowerCase();
  return key;
}

export function commandForInput(input: KeyInput, byKey: Keymap['byKey'], platform: PlatformName): CommandId | undefined {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return undefined;
  const mac = platform === 'mac';
  if (mac ? input.control : input.meta) return undefined;
  const parts: string[] = [];
  if (mac ? input.meta : input.control) parts.push('mod');
  if (input.alt) parts.push('alt');
  if (input.shift) parts.push('shift');
  parts.push(inputKey(input));
  return byKey.get(parts.join('+'));
}

function named(keys: string, labels: ModifierLabels): string[] {
  return keys.split('+').map((part) => (part === 'mod' || part === 'alt' || part === 'shift' || part === 'enter' ? labels[part] : part.toUpperCase()));
}

export function keyLabel(keys: string, platform: PlatformName): string {
  const labels = UI_LABELS[platform];
  return named(keys, labels).join(labels.separator);
}

export function accelerator(keys: string): string {
  return named(keys, ACCELERATOR_LABELS).join(ACCELERATOR_LABELS.separator);
}

export function keyChips(keys: string, platform: PlatformName): string[] {
  return named(keys, UI_LABELS[platform]);
}

export function ariaShortcut(keys: string, platform: PlatformName): string {
  const labels = ARIA_LABELS[platform];
  return named(keys, labels).join(labels.separator);
}
