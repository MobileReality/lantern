import { describe, expect, it } from 'vitest';
import { labelSegments, paletteItems } from '../src/renderer/command-palette/items';
import type { CommandId } from '../src/shared/commands';
import { defaultBindings, resolveKeymap } from '../src/shared/commands/keymap';

const { byCommand } = resolveKeymap(defaultBindings());
const AVAILABLE: CommandId[] = ['lantern.open', 'settings.open', 'memory.open', 'palette.open'];

const items = (query = '', usage: Record<string, number> = {}) =>
  paletteItems({ available: AVAILABLE, byCommand, usage, query });

describe('paletteItems', () => {
  it('lists only available ids, in table order without usage, never the palette itself', () => {
    expect(items().map((item) => item.id)).toEqual(['settings.open', 'lantern.open', 'memory.open']);
  });

  it('labels as Category: Title with the raw key or undefined', () => {
    expect(items().find((item) => item.id === 'lantern.open')).toEqual({
      id: 'lantern.open',
      label: 'Lantern: Architecture map',
      keys: 'mod+shift+l',
    });
    expect(items().find((item) => item.id === 'memory.open')?.keys).toBeUndefined();
  });

  it('orders by usage, then table order', () => {
    const usage = { 'memory.open': 5, 'lantern.open': 2, 'palette.open': 9 };
    expect(items('', usage).map((item) => item.id)).toEqual(['memory.open', 'lantern.open', 'settings.open']);
  });

  it('filters by a word prefix and by a second word', () => {
    expect(items('arch').map((item) => item.id)).toEqual(['lantern.open']);
    expect(items('settings sett').map((item) => item.id)).toEqual(['settings.open']);
    expect(items('lantern mem')).toEqual([]);
  });

  it('keeps everything for an empty or blank query', () => {
    expect(items('')).toHaveLength(AVAILABLE.length - 1);
    expect(items('   ')).toHaveLength(AVAILABLE.length - 1);
  });
});

describe('labelSegments', () => {
  it('marks every occurrence of each query word, case-insensitively', () => {
    expect(labelSegments('Review: Review changes', 'rev')).toEqual([
      { text: 'Rev', hit: true },
      { text: 'iew: ', hit: false },
      { text: 'Rev', hit: true },
      { text: 'iew changes', hit: false },
    ]);
    expect(labelSegments('Settings: Settings', 'set tin')).toEqual([
      { text: 'Settin', hit: true },
      { text: 'gs: ', hit: false },
      { text: 'Settin', hit: true },
      { text: 'gs', hit: false },
    ]);
  });

  it('returns one unmarked segment for an empty query', () => {
    expect(labelSegments('Memory: Memory', '  ')).toEqual([{ text: 'Memory: Memory', hit: false }]);
  });
});
