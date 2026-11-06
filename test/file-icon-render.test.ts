// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pos } from '../src/renderer/lib/lanternlayout';
import type { Profile } from '../src/renderer/lib/lanternprofile';

const pixi = vi.hoisted(() => {
  class Display {
    children: Display[] = [];
    cursor = '';
    destroyed = false;
    eventMode = '';
    height = 0;
    position = { set: vi.fn() };
    width = 0;

    addChild(...children: Display[]) {
      this.children.push(...children);
      return children[0];
    }

    on() {
      return this;
    }
  }

  class Graphics extends Display {
    fill() { return this; }
    lineTo() { return this; }
    moveTo() { return this; }
    roundRect() { return this; }
    stroke() { return this; }
  }

  return {
    Assets: { load: vi.fn(() => Promise.resolve({ id: 'texture' })) },
    BitmapText: class extends Display {},
    Container: Display,
    Graphics,
    Sprite: class extends Display {},
  };
});

vi.mock('pixi.js', () => pixi);

import { nodeDisplay } from '../src/renderer/lib/lantern-pixi/node-graphics';

const profile = { layerOf: () => ({ id: 'support' }) } as Profile;
const palette = { background: 0, glow: 1, ink: 2, ink3: 3, layers: { support: 4 }, rule: 5, surface: 6 };
const fonts = { mono: 'mono', monoBold: 'bold', monoGroup: 'group', monoTile: 'tile' };

function position(item: Pos['item']): Pos {
  return { x: 0, y: 0, w: 180, h: 23, col: { layer: { id: 'support' } }, item } as Pos;
}

describe('Pixi file icons', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads and repaints a boundary file icon', async () => {
    const requestRender = vi.fn();
    const loads: Promise<void>[] = [];
    const display = nodeDisplay(position({ key: 'boundary', label: 'generated.ts', dir: 'src', boundary: { path: 'src/generated.ts', platform: 'api' } }), profile, palette, fonts, 1, vi.fn(), undefined, requestRender, (load) => loads.push(load));

    await Promise.all(loads);

    expect(pixi.Assets.load).toHaveBeenCalledWith(expect.stringContaining('/assets/file-icons/typescript.svg'));
    expect(requestRender).toHaveBeenCalledOnce();
    expect(display.children).toHaveLength(3);
  });

  it('keeps external systems icon-free', () => {
    nodeDisplay(position({ key: 'external', label: 'Stripe', dir: 'external' }), profile, palette, fonts, 1, vi.fn(), undefined, vi.fn(), vi.fn());

    expect(pixi.Assets.load).not.toHaveBeenCalled();
  });
});
