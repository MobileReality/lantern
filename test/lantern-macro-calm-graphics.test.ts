// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pos } from '../src/renderer/lib/lanternlayout';
import type { Profile } from '../src/renderer/lib/lanternprofile';

const drawn = vi.hoisted(() => ({ colours: [] as number[], texts: [] as string[] }));

const pixi = vi.hoisted(() => {
  class Display {
    children: Display[] = [];
    cursor = '';
    eventMode = '';
    position = { set: vi.fn() };
    anchor = { set: vi.fn() };
    width = 10;
    height = 10;
    alpha = 1;

    addChild(...children: Display[]) {
      this.children.push(...children);
      return children[0];
    }

    on() {
      return this;
    }
  }

  const paint = (style: unknown) => {
    const colour = typeof style === 'number' ? style : (style as { color?: number })?.color;
    if (typeof colour === 'number') drawn.colours.push(colour);
  };

  class Graphics extends Display {
    constructor() {
      super();
      return new Proxy(this, {
        get: (target, key: string, self) => {
          if (key in target) return (target as unknown as Record<string, unknown>)[key];
          if (key === 'stroke' || key === 'fill') return (style: unknown) => (paint(style), self);
          return () => self;
        },
      });
    }
  }

  class Text extends Display {
    constructor(options: { text: string }) {
      super();
      drawn.texts.push(options.text);
    }
  }

  return { Assets: { load: vi.fn() }, BitmapText: Text, Text, Container: Display, Graphics, Sprite: Display };
});

vi.mock('pixi.js', () => pixi);

import { macroGraphics } from '../src/renderer/lib/lantern-pixi/macro-graphics';
import { nodeDisplay } from '../src/renderer/lib/lantern-pixi/node-graphics';

const GLOW = 0xaa0001;
const REF = 0xaa0002;
const palette = { background: 0, glow: GLOW, ref: REF, ink: 2, ink2: 7, ink3: 3, layers: { support: 4, domain: 8 }, rule: 5, surface: 6, mono: 'mono' };
const fonts = { mono: 'mono', monoBold: 'bold', monoGroup: 'group', monoTile: 'tile' };
const profile = { layerOf: () => ({ id: 'support' }) } as Profile;

function blockAt(): Pos {
  const block = { id: 'b', key: 'b', kind: 'feature', files: 10, lines: ['does a thing'] };
  return { x: 0, y: 0, w: 180, h: 60, col: { layer: { id: 'support' } }, item: { key: 'b', label: 'Block', dir: '', block } } as unknown as Pos;
}

function drawBlock(mark: { changed: number; total: number } | undefined, current: boolean, calm: boolean) {
  drawn.colours.length = 0;
  drawn.texts.length = 0;
  nodeDisplay(blockAt(), profile, palette as never, fonts, 1, vi.fn(), undefined, vi.fn(), vi.fn(), null, mark, current, calm);
  return { colours: [...drawn.colours], texts: [...drawn.texts] };
}

const curve = { from: { x: 0, y: 0 }, control1: { x: 1, y: 1 }, control2: { x: 2, y: 2 }, to: { x: 3, y: 3 } };
const label = { x: 0, y: 0, w: 20, h: 10, text: '3' };

function shape() {
  const arc = (key: string, fromKey: string, toKey: string) => ({ edge: { key, fromKey, toKey, strong: true, quiet: false, main: true, count: 3 }, path: [curve], label });
  const link = (blockKey: string, system: string) => ({ link: { blockKey }, system: { key: system }, path: [curve], label });
  return { arcs: [arc('a-b', 'a', 'b'), arc('c-d', 'c', 'd')], links: [link('b', 's1'), link('c', 's2')] };
}

function drawEdges(options: { marks?: unknown; current?: { keys: ReadonlySet<string> } }) {
  drawn.colours.length = 0;
  macroGraphics({ shape: shape() as never, palette: palette as never, selected: null, resolution: 1, ...options } as never);
  return [...drawn.colours];
}

const MARK = { changed: 3, total: 10 };
const MARKS = { blocks: new Map(), systems: new Set(), edges: new Set(['a-b', 'c-d']), links: new Set(['b>s1', 'c>s2']) };

beforeEach(() => vi.clearAllMocks());

describe('a block the pull request touches on the Macro view', () => {
  it('glows amber when no file is open', () => {
    const { colours, texts } = drawBlock(MARK, false, false);
    expect(colours).toContain(GLOW);
    expect(texts).toContain('3 of 10 files');
  });

  it('keeps only a quiet outline and the caption once a file is open elsewhere', () => {
    const { colours, texts } = drawBlock(MARK, false, true);
    expect(colours).not.toContain(GLOW);
    expect(colours).not.toContain(REF);
    expect(texts).toContain('3 of 10 files');
  });

  it('is the only block drawn with the strong marker and its badge when it holds the open file', () => {
    const open = drawBlock(MARK, true, true);
    expect(open.colours).toContain(REF);
    expect(open.colours).not.toContain(GLOW);
    expect(open.texts).toContain('READING');
    expect(drawBlock(undefined, false, true).colours).not.toContain(REF);
  });
});

describe('the links of the Macro view while a file is open', () => {
  it('shows the pull request glow on its links when no file is open', () => {
    expect(drawEdges({ marks: MARKS })).toContain(GLOW);
  });

  it('keeps only the links of the open block prominent, and never in the glow colour', () => {
    const colours = drawEdges({ marks: MARKS, current: { keys: new Set(['b']) } });
    expect(colours).not.toContain(GLOW);
    expect(colours).toContain(REF);
  });

  it('draws no prominent link when the open file sits in no block', () => {
    const colours = drawEdges({ marks: MARKS, current: { keys: new Set() } });
    expect(colours).not.toContain(GLOW);
    expect(colours).not.toContain(REF);
  });
});

describe('the lines of the Macro view at rest', () => {
  const restShape = () => {
    const arc = (key: string, fromKey: string, toKey: string, main: boolean) => ({ edge: { key, fromKey, toKey, strong: false, quiet: false, main, count: 3 }, path: [curve], label });
    return { arcs: [arc('a-b', 'a', 'b', true), arc('b-a', 'b', 'a', true), arc('a-c', 'a', 'c', false), arc('c-d', 'c', 'd', false), arc('d-e', 'd', 'e', false)], links: [] };
  };
  const lines = (options: { selected?: string | null; marks?: unknown; current?: { keys: ReadonlySet<string> } }) => {
    const container = macroGraphics({ shape: restShape() as never, palette: palette as never, resolution: 1, selected: null, ...options } as never) as unknown as { children: { children: unknown[] }[] };
    return container.children[0].children.length;
  };

  it('draws the main links and no other line', () => {
    expect(lines({})).toBe(2);
  });

  it('draws every line of the selected block, and keeps the main links faint', () => {
    expect(lines({ selected: 'a' })).toBe(3);
    expect(lines({ selected: 'd' })).toBe(4);
  });

  it('lights a link the pull request touches even when it is not a main link', () => {
    expect(lines({ marks: { ...MARKS, edges: new Set(['d-e']) } })).toBe(3);
  });

  it('lights the links of the open block even when they are not main links', () => {
    expect(lines({ current: { keys: new Set(['c']) } })).toBe(4);
  });
});
