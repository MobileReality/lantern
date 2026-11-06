// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampWidths, defaultWidths, parseWidths } from '../src/renderer/lib/lanternpanes';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const MAP = mapOf({ nodes: [node('src/svc.ts', 'service')], prs: [pr('7', { files: [{ path: 'src/svc.ts', kind: 'modified', mapped: true }] })] });
const STORE_KEY = 'lantern.reviewPanes';
const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  localStorage.clear();
});

function open(width = 1200) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, MAP, {}));
  const grid = root.querySelector('.lt-grid') as HTMLElement;
  Object.defineProperty(grid, 'clientWidth', { configurable: true, value: width });
  (root.querySelector('.pr-chip[data-pr="7"]') as HTMLElement).click();
  const [first, second] = [...root.querySelectorAll<HTMLElement>('.lt-split')];
  const css = (name: string) => grid.style.getPropertyValue(name);
  return { root, grid, first, second, css };
}

const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
const pointer = (target: HTMLElement, type: string, clientX: number) => target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true }));

describe('the widths the dividers allow', () => {
  it('keeps every pane at its minimum and leaves the graph its minimum, whatever is asked', () => {
    expect(clampWidths({ left: 10, middle: 10 }, 1200)).toEqual({ left: 240, middle: 280 });
    const wide = clampWidths({ left: 5000, middle: 5000 }, 1200);
    expect(wide.left).toBe(1200 - 12 - 280 - 300);
    expect(wide.middle).toBe(280);
    const mid = clampWidths({ left: 300, middle: 5000 }, 1200);
    expect(mid.middle).toBe(1200 - 12 - 300 - 300);
  });

  it('gives up the minimums rather than overflow when the window is too narrow', () => {
    expect(clampWidths({ left: 400, middle: 400 }, 700)).toEqual({ left: 240, middle: 280 });
  });

  it('passes widths through while the container has no width yet', () => {
    expect(clampWidths({ left: 123, middle: 456 }, 0)).toEqual({ left: 123, middle: 456 });
  });

  it('starts with a list of a sensible share and a file pane that leaves room for the graph', () => {
    const start = defaultWidths(1280);
    expect(start.left).toBeGreaterThanOrEqual(300);
    expect(start.left).toBeLessThanOrEqual(360);
    expect(1280 - start.left - start.middle - 12).toBeGreaterThanOrEqual(300);
  });

  it('reads back only well-formed saved widths', () => {
    expect(parseWidths('{"left":300,"middle":400}')).toEqual({ left: 300, middle: 400 });
    expect(parseWidths('{"left":"a","middle":400}')).toBeNull();
    expect(parseWidths('nope')).toBeNull();
    expect(parseWidths(null)).toBeNull();
  });
});

describe('the dividers between the panes', () => {
  it('are two focusable vertical separators with a name and a value', () => {
    const { first, second } = open();
    for (const handle of [first, second]) {
      expect(handle.getAttribute('role')).toBe('separator');
      expect(handle.getAttribute('aria-orientation')).toBe('vertical');
      expect(handle.getAttribute('aria-label')).toBeTruthy();
      expect(handle.tabIndex).toBe(0);
    }
    expect(first.getAttribute('aria-valuemin')).toBe('240');
    expect(Number(first.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(240);
    expect(second.getAttribute('aria-valuemin')).toBe('280');
  });

  it('move with the arrow keys, further with Shift, and jump with Home and End', () => {
    const { first, css } = open();
    const start = Number(first.getAttribute('aria-valuenow'));

    press(first, 'ArrowRight');
    expect(css('--lt-pane-left')).toBe(`${start + 16}px`);
    expect(first.getAttribute('aria-valuenow')).toBe(String(start + 16));
    press(first, 'ArrowRight', { shiftKey: true });
    expect(css('--lt-pane-left')).toBe(`${start + 16 + 64}px`);
    press(first, 'ArrowLeft');
    expect(css('--lt-pane-left')).toBe(`${start + 64}px`);
    press(first, 'Home');
    expect(css('--lt-pane-left')).toBe('240px');
    press(first, 'ArrowLeft');
    expect(css('--lt-pane-left')).toBe('240px');
    press(first, 'End');
    expect(css('--lt-pane-left')).toBe(`${1200 - 12 - 280 - 300}px`);
  });

  it('size the middle pane without moving the list', () => {
    const { first, second, css } = open();
    const left = Number(first.getAttribute('aria-valuenow'));
    const middle = Number(second.getAttribute('aria-valuenow'));

    press(second, 'ArrowRight');

    expect(css('--lt-pane-mid')).toBe(`${middle + 16}px`);
    expect(css('--lt-pane-left')).toBe(`${left}px`);
    press(second, 'End');
    expect(css('--lt-pane-mid')).toBe(`${1200 - 12 - left - 300}px`);
  });

  it('ignore other keys', () => {
    const { first, css } = open();
    press(first, 'a');
    expect(css('--lt-pane-left')).toBe('');
  });

  it('follow a pointer drag and stop following it on release', () => {
    const { first, css } = open();
    const start = Number(first.getAttribute('aria-valuenow'));

    pointer(first, 'pointerdown', 400);
    pointer(first, 'pointermove', 450);
    expect(css('--lt-pane-left')).toBe(`${start + 50}px`);
    pointer(first, 'pointermove', 380);
    expect(css('--lt-pane-left')).toBe(`${start - 20}px`);
    pointer(first, 'pointerup', 380);
    pointer(first, 'pointermove', 700);
    expect(css('--lt-pane-left')).toBe(`${start - 20}px`);
    expect(JSON.parse(localStorage.getItem(STORE_KEY) as string).left).toBe(start - 20);
  });

  it('are remembered for the next time a pull request is opened, even in a new window', () => {
    const one = open();
    press(one.first, 'Home');
    press(one.second, 'End');
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) as string);
    expect(saved.left).toBe(240);
    mounted.splice(0).forEach((view) => { view.dispose(); });
    document.body.replaceChildren();

    const again = open();

    expect(again.css('--lt-pane-left')).toBe('240px');
    expect(again.css('--lt-pane-mid')).toBe(`${saved.middle}px`);
  });

  it('shrink with the window and come back to the chosen width when it grows again', () => {
    let notify: () => void = () => undefined;
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { notify = cb; } observe() {} disconnect() {} });
    try {
      const { grid, first, css } = open(1200);
      press(first, 'End');
      const chosen = css('--lt-pane-left');
      expect(chosen).toBe(`${1200 - 12 - 280 - 300}px`);

      Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 1000 });
      notify();
      expect(css('--lt-pane-left')).toBe(`${1000 - 12 - 280 - 300}px`);

      Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 1200 });
      notify();
      expect(css('--lt-pane-left')).toBe(chosen);
      expect(JSON.parse(localStorage.getItem(STORE_KEY) as string).left).toBe(1200 - 12 - 280 - 300);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('survive a store that cannot be read', () => {
    localStorage.setItem(STORE_KEY, '{broken');
    const { first, css } = open();
    expect(css('--lt-pane-left')).toBe('');
    press(first, 'ArrowRight');
    expect(css('--lt-pane-left')).not.toBe('');
  });
});
