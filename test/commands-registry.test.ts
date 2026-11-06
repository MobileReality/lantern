import { describe, expect, it } from 'vitest';
import { COMMANDS, commandTitle, isCommandId, registerCommandNodes } from '../src/shared/commands';
import type { CommandSchema, CommandsNode } from '../src/shared/commands';

function node(id: string, ids: string[], schema: Partial<CommandSchema> = {}): CommandsNode {
  return { id, title: id, commands: Object.fromEntries(ids.map((c) => [c, { title: c, ...schema }])) };
}

describe('commands registry', () => {
  it('throws on an id outside its node prefix', () => {
    expect(() => registerCommandNodes([node('review', ['explain.open'])])).toThrow(/must start with "review\."/);
    expect(() => registerCommandNodes([node('review', ['reviews.open'])])).toThrow(/must start with/);
    expect(() => registerCommandNodes([node('lantern', ['lantern.open'])])).not.toThrow();
  });

  it('throws on an empty id or surrounding whitespace', () => {
    expect(() => registerCommandNodes([node('a', ['  '])])).toThrow(/empty id/);
    expect(() => registerCommandNodes([node('a', [' a.one'])])).toThrow(/whitespace/);
  });

  it('throws on an id declared twice', () => {
    expect(() => registerCommandNodes([node('a', ['a.one']), node('a', ['a.one'])])).toThrow(/declared twice/);
  });

  it('rejects a default key without mod unless it is an F-key', () => {
    expect(() => registerCommandNodes([node('a', ['a.one'], { keys: 'p' })])).toThrow(/needs mod or an F-key/);
    expect(() => registerCommandNodes([node('a', ['a.one'], { keys: 'alt+shift+p' })])).toThrow(/needs mod/);
    expect(() => registerCommandNodes([node('a', ['a.one'], { keys: 'f13' })])).toThrow(/needs mod/);
    expect(() => registerCommandNodes([node('a', ['a.one'], { keys: 'mod+alt+p' })])).not.toThrow();
    expect(() => registerCommandNodes([node('a', ['a.one'], { keys: 'f1' })])).not.toThrow();
    expect(() => registerCommandNodes([node('a', ['a.one'], { keys: 'f12' })])).not.toThrow();
    expect(() => registerCommandNodes([node('a', ['a.one'], { keys: 'shift+f1' })])).not.toThrow();
  });

  it('recognises every declared id and nothing else', () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
    for (const { id } of COMMANDS) expect(isCommandId(id), id).toBe(true);
    expect(isCommandId('review.unknown')).toBe(false);
    expect(isCommandId(42)).toBe(false);
  });

  it('labels a command as Category: Title', () => {
    expect(commandTitle('lantern.open')).toBe('Lantern: Architecture map');
    expect(commandTitle('settings.openFile')).toBe('Settings: Open settings.json');
  });
});
