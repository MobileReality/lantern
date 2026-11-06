// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import lab from './fixtures/lantern-macro-lab.json';
import type { AreasPayload, MacroViewContext, MountedMacroView } from '../src/renderer/lib/macroview/types';
import { mountMacroView } from '../src/renderer/lib/macroview/mount';
import { foundationFocus } from '../src/renderer/lib/lanternmacrofoundation';
import { foundationAreasPayload } from './helpers/macro-foundation-world';

const payload = lab.payload as unknown as AreasPayload;
const CHANGED = ['api/checkout/checkout.service.ts', 'web/checkout/CheckoutPage.tsx'];
const AREA_KEYS = ['block:catalog', 'block:ordering', 'block:payments', 'block:fulfilment', 'block:accounts', 'block:insights', 'block:to-assign'];

interface Spies {
  select: ReturnType<typeof vi.fn>;
  enter: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  openFile: ReturnType<typeof vi.fn>;
}

function changedBlocks() {
  return new Map([['checkout', CHANGED.map((path) => ({ path, kind: 'modified' as const, mapped: true, reason: '' }))]]);
}

function context(spies: Spies, extra: Partial<MacroViewContext> = {}): MacroViewContext {
  return {
    payload,
    scene: { level: 'areas', files: 0, tests: 0, relations: 0, blocks: [], edges: [], systems: [] },
    prMarks: null,
    reading: { file: null, blocks: new Set() },
    flowStep: null,
    selection: null,
    foundation: null,
    openFile: spies.openFile as never,
    select: spies.select as never,
    enter: spies.enter as never,
    leave: spies.leave as never,
    ...extra,
  };
}

function withPr(spies: Spies): MacroViewContext {
  const impact = { blocks: changedBlocks(), edges: new Set<string>(), systems: new Set<string>(), links: new Set<string>(), other: { unmapped: [], tests: [], unplaced: [], foundation: [] }, changed: 2 };
  return context(spies, { prMarks: { pr: {}, impact, marks: {}, members: new Map() } as never });
}

let spies: Spies;
let host: HTMLElement;
let mounted: MountedMacroView | null = null;

const root = () => host.querySelector('.lt-macroview') as HTMLElement;
const item = (key: string) => host.querySelector(`[data-key="${key}"]`) as SVGGElement;
const zoom = () => Number(root().dataset.zoom);
const keydown = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  root().dispatchEvent(event);
  return event;
};

function mount(ctx = context(spies)) {
  mounted = mountMacroView(host, ctx);
  return mounted;
}

const PANE = { w: 700, h: 880 };

function sizeThePane() {
  const sized = (property: 'clientWidth' | 'clientHeight', value: number) =>
    vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('lt-macroview') ? value : 0;
    });
  sized('clientWidth', PANE.w);
  sized('clientHeight', PANE.h);
}

function click(target: Element) {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
}

function dive(key: string) {
  item(key).querySelector('.mv-shape')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  spies = { select: vi.fn(), enter: vi.fn(() => true), leave: vi.fn(() => true), openFile: vi.fn() };
  host = document.createElement('div');
  document.body.appendChild(host);
  sizeThePane();
  Object.assign(HTMLElement.prototype, { setPointerCapture: () => undefined, releasePointerCapture: () => undefined, hasPointerCapture: () => true });
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
});

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host.remove();
  vi.restoreAllMocks();
});

describe('mounting, updating and destroying', () => {
  it('draws every area, labelled, into its own host and nothing outside it', () => {
    mount();
    expect(host.children).toHaveLength(1);
    expect(root().getAttribute('role')).toBe('application');
    expect(root().tabIndex).toBe(0);
    for (const key of AREA_KEYS) {
      expect(item(key)).not.toBeNull();
      expect(item(key).getAttribute('aria-label')).toMatch(/area|features not in an area yet/);
    }
    expect(host.querySelectorAll('.mv-feature')).toHaveLength(18);
    expect(root().dataset.level).toBe('areas');
    expect(root().dataset.zoom).toBe('1.00');
    expect(document.body.querySelectorAll('.lt-macroview')).toHaveLength(1);
  });

  it('removes everything it added and stops listening when destroyed', () => {
    const handle = mount();
    const before = zoom();
    const rootNode = root();
    handle.destroy();
    mounted = null;
    expect(host.children).toHaveLength(0);
    const event = new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true });
    rootNode.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(before).toBe(1);
  });

  it('repaints on update without rebuilding the drawing, and shows the selection, its partners and a dimmed rest', () => {
    const handle = mount();
    const shapes = host.querySelectorAll('.mv-area');
    handle.update(context(spies, { selection: 'block:ordering' }));
    expect(host.querySelectorAll('.mv-area')[0]).toBe(shapes[0]);
    expect(item('block:ordering').classList.contains('is-selected')).toBe(true);
    expect(item('block:ordering').getAttribute('aria-pressed')).toBe('true');
    expect(item('block:payments').classList.contains('is-related')).toBe(true);
    expect(item('block:insights').classList.contains('is-dim')).toBe(false);
    expect(item('block:accounts').classList.contains('is-related')).toBe(true);
    handle.update(context(spies, { selection: null }));
    expect(host.querySelectorAll('.is-selected, .is-dim')).toHaveLength(0);
  });

  it('keeps every outside system listed at rest and narrows the list to the ones the selection touches', () => {
    const handle = mount();
    const chips = () => [...host.querySelectorAll('.mv-system-name')].map((chip) => chip.textContent);
    expect((host.querySelector('.mv-dock') as HTMLElement).hidden).toBe(false);
    expect(chips()).toHaveLength(7);
    handle.update(context(spies, { selection: 'block:payments' }));
    expect(chips()).toEqual(expect.arrayContaining(['Card Gateway']));
    expect(chips().length).toBeLessThan(7);
    host.querySelector<HTMLButtonElement>('.mv-system')?.click();
    expect(spies.select).toHaveBeenCalledWith(expect.stringMatching(/^ext:/));
    handle.update(context(spies, { selection: null }));
    expect(chips()).toHaveLength(7);
  });
});

describe('zooming and panning without the page moving', () => {
  it('zooms with the wheel around the pointer and keeps the browser from zooming or scrolling the page', () => {
    mount();
    const wheel = new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true });
    root().dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(zoom()).toBeGreaterThan(1);
    const pinch = new WheelEvent('wheel', { deltaY: 8, ctrlKey: true, bubbles: true, cancelable: true });
    root().dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
  });

  it('does not let the wheel reach the host, whose own handler would scale the hidden canvas', () => {
    mount();
    const outer = vi.fn();
    host.addEventListener('wheel', outer);
    root().dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(outer).not.toHaveBeenCalled();
  });

  it('zooms with + and - and fits with 0, and the arrows with shift pan', () => {
    mount();
    expect(keydown('+').defaultPrevented).toBe(true);
    const zoomedIn = zoom();
    expect(zoomedIn).toBeGreaterThan(1);
    keydown('-');
    expect(zoom()).toBeLessThan(zoomedIn);
    keydown('+');
    keydown('+');
    keydown('0');
    expect(zoom()).toBe(1);
    const before = root().querySelector('.mv-world')?.getAttribute('transform');
    keydown('ArrowRight', { shiftKey: true });
    expect(root().querySelector('.mv-world')?.getAttribute('transform')).not.toBe(before);
  });

  it('never zooms past the limits', () => {
    mount();
    for (let step = 0; step < 40; step += 1) keydown('+');
    const deepest = zoom();
    keydown('+');
    expect(zoom()).toBe(deepest);
    for (let step = 0; step < 80; step += 1) keydown('-');
    expect(zoom()).toBeGreaterThanOrEqual(0.69);
    expect(zoom()).toBeLessThan(1);
  });

  it('zooms with a two-finger pinch and pans with one finger dragged, and a tap still selects', () => {
    mount();
    const touch = (type: string, id: number, x: number, y: number) => {
      const event = Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }), { pointerId: id, pointerType: 'touch' });
      root().dispatchEvent(event);
    };
    touch('pointerdown', 1, 300, 300);
    touch('pointerdown', 2, 400, 300);
    touch('pointermove', 2, 520, 300);
    touch('pointermove', 1, 240, 300);
    expect(zoom()).toBeGreaterThan(1.5);
    touch('pointerup', 1, 240, 300);
    touch('pointerup', 2, 520, 300);

    const before = root().querySelector('.mv-world')?.getAttribute('transform');
    touch('pointerdown', 3, 200, 200);
    touch('pointermove', 3, 260, 240);
    touch('pointerup', 3, 260, 240);
    expect(root().querySelector('.mv-world')?.getAttribute('transform')).not.toBe(before);
    expect(spies.select).not.toHaveBeenCalled();
  });

  it('has + - and Fit buttons that do the same', () => {
    mount();
    const press = (name: string) => host.querySelector<HTMLButtonElement>(`[data-zoom="${name}"]`)?.click();
    press('in');
    expect(zoom()).toBeGreaterThan(1);
    press('fit');
    expect(zoom()).toBe(1);
    press('out');
    expect(zoom()).toBeLessThan(1);
  });

  it('declares itself unpannable by the browser, so touch and trackpad gestures cannot move the page', async () => {
    const css = await import('node:fs').then((fs) => fs.readFileSync('src/renderer/lantern-macroview.css', 'utf8'));
    expect(css).toMatch(/touch-action:\s*none/);
    expect(css).toMatch(/overscroll-behavior:\s*contain/);
  });
});

describe('diving in and out with the host following', () => {
  it('Enter on a focused area zooms to it and enters it in the host, Escape leaves it again', () => {
    mount();
    keydown('ArrowRight');
    const focused = host.querySelector('.mv-item.is-focus')?.getAttribute('data-key');
    expect(focused).not.toBeNull();
    keydown('Enter');
    expect(spies.enter).toHaveBeenCalledWith(focused);
    expect(zoom()).toBeGreaterThan(1.5);
    expect(root().dataset.level).not.toBe('areas');
    const escape = keydown('Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(spies.leave).toHaveBeenCalled();
    expect(zoom()).toBe(1);
  });

  it('lets Escape through to the host when there is nothing left to step out of', () => {
    mount();
    expect(keydown('Escape').defaultPrevented).toBe(false);
    expect(spies.select).not.toHaveBeenCalled();
  });

  it('first clears a selection with Escape when fully zoomed out', () => {
    const handle = mount();
    handle.update(context(spies, { selection: 'block:ordering' }));
    expect(keydown('Escape').defaultPrevented).toBe(true);
    expect(spies.select).toHaveBeenCalledWith(null);
  });

  it('follows the host when it goes down into an area or back up, without calling it back', () => {
    const handle = mount();
    const ordering = { id: 'ordering', name: 'Ordering', purpose: '', files: 51, features: [] };
    handle.update(context(spies, { scene: { level: 'area', area: ordering, files: 0, tests: 0, relations: 0, blocks: [], edges: [], systems: [] } }));
    expect(root().dataset.entered).toBe('ordering');
    expect(zoom()).toBeGreaterThan(1.5);
    handle.update(context(spies));
    expect(root().dataset.entered).toBe('');
    expect(zoom()).toBe(1);
    expect(spies.enter).not.toHaveBeenCalled();
    expect(spies.leave).not.toHaveBeenCalled();
  });

  it('enters the area on screen when the wheel zooms into it, and leaves when zoomed back out', () => {
    mount();
    for (let step = 0; step < 6; step += 1) root().dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
    expect(spies.enter).toHaveBeenCalled();
    keydown('0');
    expect(spies.leave).toHaveBeenCalled();
  });

  it('opens a file and selects its feature, entering the area first, on a click on a file row at deep zoom', () => {
    mount(withPr(spies));
    dive('block:checkout');
    spies.enter.mockClear();
    click(item('block:checkout').querySelector(`.mv-file[data-path="${CHANGED[0]}"]`) as Element);
    expect(spies.openFile).toHaveBeenCalledWith(CHANGED[0]);
    expect(spies.select).toHaveBeenCalledWith('block:checkout');
    expect(item('block:checkout').querySelector(`.mv-file[data-path="${CHANGED[0]}"]`)?.classList.contains('is-picked')).toBe(true);
  });

  it('moves between neighbours with the arrows, steps through the files at deep zoom and opens one with Enter', () => {
    mount(withPr(spies));
    dive('block:checkout');
    keydown('ArrowDown');
    const first = host.querySelector('.mv-file.is-focus')?.getAttribute('data-path');
    expect(first).not.toBeNull();
    keydown('ArrowDown');
    expect(host.querySelector('.mv-file.is-focus')?.getAttribute('data-path')).not.toBe(first);
    keydown('Enter');
    expect(spies.openFile).toHaveBeenCalled();
  });
});

describe('selecting with the pointer', () => {
  it('selects an area with a click and clears with a click on the empty map', () => {
    mount();
    click(item('block:payments').querySelector('.mv-shape') as Element);
    expect(spies.select).toHaveBeenCalledWith('block:payments');
    click(root());
    expect(spies.select).toHaveBeenLastCalledWith(null);
  });

  it('selects a foundation entry by its key and the whole band by the band key', () => {
    mount();
    click(item('block:core:service').querySelector('.mv-shape') as Element);
    expect(spies.select).toHaveBeenCalledWith('block:core:service');
    click(item('band:foundation').querySelector('.mv-lane-shape') as Element);
    expect(spies.select).toHaveBeenLastCalledWith('band:foundation');
  });

  it('toggles: a second click on the selected area clears it', () => {
    const handle = mount();
    handle.update(context(spies, { selection: 'block:payments' }));
    click(item('block:payments').querySelector('.mv-shape') as Element);
    expect(spies.select).toHaveBeenLastCalledWith(null);
  });
});

describe('marks at the right zoom', () => {
  it('lights the area with how much of it changed and, once features show, the feature too', () => {
    mount(withPr(spies));
    expect(item('block:ordering').classList.contains('is-lit')).toBe(true);
    expect(item('block:catalog').classList.contains('is-lit')).toBe(false);
    const badge = item('block:ordering').querySelector(':scope > .mv-tally .mv-badge-text');
    expect(badge?.textContent).toBe('2 of 51 files');
    expect(item('block:checkout').classList.contains('is-lit')).toBe(true);
    dive('block:ordering');
    expect(root().dataset.level).toBe('features');
    const tile = item('block:checkout').querySelector(':scope > .mv-tally .mv-badge-text');
    expect(tile?.textContent).toBe('2 of 20 files');
  });

  it('marks the changed files as changed once a feature is deep enough to list them', () => {
    mount(withPr(spies));
    dive('block:checkout');
    expect(root().dataset.level).toBe('files');
    const rows = [...item('block:checkout').querySelectorAll<SVGGElement>('.mv-file')].filter((row) => row.style.display !== 'none');
    const changed = rows.filter((row) => row.classList.contains('is-changed')).map((row) => row.getAttribute('data-path'));
    expect(changed.sort()).toEqual([...CHANGED].sort());
    expect(rows.find((row) => row.classList.contains('is-changed'))?.querySelector('.mv-rowtag')?.textContent).toBe('changed');
    expect(rows.slice(0, 2).every((row) => row.classList.contains('is-changed'))).toBe(true);
  });

  it('marks the file being read in its row and its feature with a READING pill, and a Flow step with STEP', () => {
    const handle = mount(withPr(spies));
    dive('block:ordering');
    const reading = { file: { path: CHANGED[0], blockKey: 'block:checkout', elsewhere: false, area: null }, blocks: new Set(['block:ordering', 'block:checkout']) };
    const orderingScene = { level: 'area' as const, area: { id: 'ordering', name: 'Ordering', purpose: '', files: 51, features: [] }, files: 0, tests: 0, relations: 0, blocks: [], edges: [], systems: [] };
    handle.update({ ...withPr(spies), reading, scene: orderingScene });
    expect(item('block:checkout').classList.contains('is-reading')).toBe(true);
    expect(item('block:ordering').classList.contains('is-reading')).toBe(true);
    expect(item('block:checkout').querySelector(':scope > .mv-mark .mv-badge-text')?.textContent).toBe('READING');
    handle.update({ ...withPr(spies), scene: orderingScene, reading: { file: null, blocks: new Set(['block:cart']) }, flowStep: { label: 'A shopper', files: new Set(['web/cart/CartSummary.tsx']) } });
    expect(item('block:cart').classList.contains('is-flow')).toBe(true);
    expect(item('block:cart').querySelector(':scope > .mv-mark .mv-badge-text')?.textContent).toBe('STEP');
  });
});

describe('a selected foundation entry', () => {
  const synthetic = foundationAreasPayload();
  const related = () => [...host.querySelectorAll('.is-related')].map((node) => node.getAttribute('data-key')).sort();

  function select(key: string) {
    const handle = mount(context(spies, { payload: synthetic }));
    const scene = { level: 'areas' as const, files: 0, tests: 0, relations: 0, blocks: [], edges: [], systems: [] };
    handle.update(context(spies, { payload: synthetic, selection: key, foundation: foundationFocus(scene, synthetic.areas, key) }));
  }

  it('lights the features where the platform has files, their areas and the entries it links to', () => {
    select('block:core:pane');

    expect(item('block:core:pane').classList.contains('is-selected')).toBe(true);
    expect(related()).toEqual(['block:core:ops', 'block:core:relay-a', 'block:orders', 'block:selling', 'block:support', 'block:tickets']);
  });

  it('leaves the features without files on the platform dimmed', () => {
    select('block:core:pane');

    expect(item('block:billing').classList.contains('is-dim')).toBe(true);
    expect(item('block:core:gate').classList.contains('is-dim')).toBe(true);
  });

  it('lights the entries a platform with no files in features is linked to', () => {
    select('block:core:ops');

    expect(related()).toEqual(['block:core:gate', 'block:core:pane', 'block:core:relay-a']);
  });
});
