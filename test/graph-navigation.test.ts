// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { anchoredScroll, clampScale, exceedsDragThreshold, fitScale, mountGraphNavigation, resistOverscroll } from '../src/renderer/lib/graph-navigation';

describe('graph navigation math', () => {
  it('treats movement past 3px as a drag and anything less as a click', () => {
    expect(exceedsDragThreshold(100, 100, 100, 100)).toBe(false);
    expect(exceedsDragThreshold(100, 100, 102, 101)).toBe(false);
    expect(exceedsDragThreshold(100, 100, 102, 102)).toBe(true);
    expect(exceedsDragThreshold(100, 100, 100, 95)).toBe(true);
  });

  it('keeps manual zoom within 10–400%', () => {
    expect(clampScale(0)).toBe(0.1);
    expect(clampScale(0.75)).toBe(0.75);
    expect(clampScale(9)).toBe(4);
  });

  it('preserves the existing fit width and allows extreme auto-fit below 10%', () => {
    expect(fitScale(800, 600)).toBe(1);
    expect(fitScale(800, 2000)).toBe(0.5);
    expect(fitScale(100, 20_000)).toBe(0.05);
  });

  it('fits the whole content width into the viewport on request, however narrow', () => {
    expect(fitScale(800, 600, true)).toBe(1);
    expect(fitScale(300, 750, true)).toBe(0.4);
    expect(fitScale(100, 20_000, true)).toBe(0.005);
    expect(fitScale(0, 750, true)).toBe(1);
  });

  it('keeps the layout point under the pointer while scaling', () => {
    expect(anchoredScroll(300, 200, 1, 2)).toBe(800);
    expect((anchoredScroll(300, 200, 1, 2) + 200) / 2).toBe((300 + 200) / 1);
  });

  it('adds resistance toward a hard 20px overscroll limit', () => {
    const first = resistOverscroll(0, 10);
    const second = resistOverscroll(first, 10);
    expect(first).toBeGreaterThan(0);
    expect(second - first).toBeLessThan(first);
    expect(second).toBeCloseTo(resistOverscroll(0, 20));
    expect(resistOverscroll(second, 100)).toBeLessThanOrEqual(20);
  });
});

describe('graph navigation controls', () => {
  function mount() {
    const main = document.createElement('main');
    document.body.appendChild(main);
    Object.defineProperties(main, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const applyScale = vi.fn();
    const navigation = mountGraphNavigation({ main, overlayHost: main, applyScale });
    navigation.setContent(2000);
    return { main, applyScale, navigation, input: main.querySelector('input') as HTMLInputElement };
  }

  function pointer(type: string, button: number, x: number, pointerId = 1) {
    const buttons = type === 'pointerup' ? 0 : button === 2 ? 2 : 1;
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, buttons, clientX: x });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    return event;
  }

  it('commits, clamps and restores editable percentages', () => {
    const { main, navigation, input } = mount();
    expect(input.value).toBe('50%');
    input.value = '900%';
    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('400%');
    input.value = 'not a number';
    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('400%');
    (main.querySelector('[data-zoom-natural]') as HTMLButtonElement).click();
    expect(input.value).toBe('100%');
    navigation.dispose();
  });

  it('anchors modifier-wheel zoom at the pointer and leaves ordinary wheel native', () => {
    const { main, applyScale, navigation } = mount();
    main.scrollLeft = 100;
    main.scrollTop = 50;
    const ordinary = new WheelEvent('wheel', { deltaY: 20, cancelable: true });
    main.dispatchEvent(ordinary);
    expect(ordinary.defaultPrevented).toBe(false);
    const zoom = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 100, cancelable: true });
    main.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(applyScale.mock.calls.at(-1)?.[0]).toBeGreaterThan(0.5);
    expect(main.scrollLeft).toBeGreaterThan(100);
    navigation.dispose();
  });

  it('does not reverse zoom-out below the manual minimum', () => {
    const { main, navigation, input } = mount();
    navigation.setContent(20_000);
    expect(input.value).toBe('5%');
    (main.querySelector('[data-zoom-out]') as HTMLButtonElement).click();
    expect(input.value).toBe('5%');
    const zoomOut = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true });
    main.dispatchEvent(zoomOut);
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(input.value).toBe('5%');
    navigation.dispose();
  });

  it('scopes keyboard zoom to the focused graph', () => {
    const { main, applyScale, navigation } = mount();
    const before = applyScale.mock.calls.length;
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    expect(applyScale).toHaveBeenCalledTimes(before);
    main.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    expect(applyScale).toHaveBeenCalledTimes(before + 1);
    navigation.dispose();
  });

  it('clears drag click suppression when the window loses focus', () => {
    const { main, navigation } = mount();
    const node = document.createElement('button');
    main.appendChild(node);
    const onClick = vi.fn();
    node.addEventListener('click', onClick);
    Object.assign(main, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
    });
    const pointer = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };
    const drag = () => {
      main.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      node.dispatchEvent(pointer('pointerdown', 0));
      node.dispatchEvent(pointer('pointermove', 10));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    };

    drag();
    node.click();
    expect(onClick).not.toHaveBeenCalled();

    drag();
    window.dispatchEvent(new Event('blur'));
    node.click();
    expect(onClick).toHaveBeenCalledOnce();
    navigation.dispose();
  });

  it('right-drag pans without zooming and a left drag on a node does not pan', () => {
    const { main, applyScale, navigation } = mount();
    const node = document.createElement('button');
    main.appendChild(node);
    Object.assign(main, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false) });
    const scaleCalls = applyScale.mock.calls.length;

    node.dispatchEvent(pointer('pointerdown', 0, 100));
    node.dispatchEvent(pointer('pointermove', 0, 60));
    node.dispatchEvent(pointer('pointerup', 0, 60));
    expect(main.scrollLeft).toBe(0);
    expect(main.classList.contains('lt-panning')).toBe(false);

    node.dispatchEvent(pointer('pointerdown', 2, 100));
    node.dispatchEvent(pointer('pointermove', 2, 60));
    expect(main.scrollLeft).toBe(40);
    node.dispatchEvent(pointer('pointerup', 2, 60));
    expect(main.classList.contains('lt-panning')).toBe(false);
    expect(applyScale).toHaveBeenCalledTimes(scaleCalls);
    navigation.dispose();
  });

  it('stops a right-drag pan when the button is released outside the graph', () => {
    const { main, navigation } = mount();
    Object.assign(main, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false) });
    main.dispatchEvent(pointer('pointerdown', 2, 100));
    main.dispatchEvent(pointer('pointermove', 2, 80));
    expect(main.classList.contains('lt-panning')).toBe(true);
    document.body.dispatchEvent(pointer('pointerup', 2, 20));
    expect(main.classList.contains('lt-panning')).toBe(false);
    const scrolled = main.scrollLeft;
    document.body.dispatchEvent(pointer('pointermove', 2, 0));
    expect(main.scrollLeft).toBe(scrolled);
    navigation.dispose();
  });

  it('delivers one targeted context menu for a right click and none for a right drag', () => {
    const { main, navigation } = mount();
    const node = document.createElement('button');
    main.appendChild(node);
    const menus = vi.fn();
    node.addEventListener('contextmenu', menus);
    Object.assign(main, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
    });

    node.dispatchEvent(pointer('pointerdown', 2, 100));
    const plainMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    node.dispatchEvent(plainMenu);
    node.dispatchEvent(pointer('pointerup', 2, 100));
    expect(plainMenu.defaultPrevented).toBe(true);
    expect(menus).toHaveBeenCalledOnce();
    expect(menus.mock.calls[0][0].target).toBe(node);
    expect(main.classList.contains('lt-panning')).toBe(false);
    const duplicateReleaseMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    node.dispatchEvent(duplicateReleaseMenu);
    expect(duplicateReleaseMenu.defaultPrevented).toBe(true);
    expect(menus).toHaveBeenCalledOnce();

    node.dispatchEvent(pointer('pointerdown', 2, 100));
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    node.dispatchEvent(pointer('pointermove', 2, 90));
    expect(main.classList.contains('lt-panning')).toBe(true);
    expect(main.scrollLeft).toBe(10);
    node.dispatchEvent(pointer('pointerup', 2, 90));
    const draggedMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    node.dispatchEvent(draggedMenu);
    expect(draggedMenu.defaultPrevented).toBe(true);
    expect(menus).toHaveBeenCalledOnce();
    expect(main.classList.contains('lt-panning')).toBe(false);

    const keyboardMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 });
    node.dispatchEvent(keyboardMenu);
    expect(keyboardMenu.defaultPrevented).toBe(false);
    expect(menus).toHaveBeenCalledTimes(2);

    node.dispatchEvent(pointer('pointerdown', 2, 100));
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    node.dispatchEvent(pointer('pointermove', 2, 98));
    document.dispatchEvent(pointer('pointerup', 2, 98));
    expect(menus).toHaveBeenCalledTimes(3);
    expect(main.classList.contains('lt-panning')).toBe(false);

    node.dispatchEvent(pointer('pointerdown', 2, 100));
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    node.dispatchEvent(pointer('pointermove', 2, 90));
    node.dispatchEvent(pointer('pointercancel', 2, 90));
    const canceledMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 });
    node.dispatchEvent(canceledMenu);
    expect(canceledMenu.defaultPrevented).toBe(false);
    expect(menus).toHaveBeenCalledTimes(4);
    navigation.dispose();
  });
});

describe('graph navigation when the pane is resized', () => {
  function mountResizable(content: number) {
    let resize: () => void = () => undefined;
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    const main = document.createElement('main');
    document.body.appendChild(main);
    let paneWidth = 1000;
    Object.defineProperties(main, { clientWidth: { get: () => paneWidth }, clientHeight: { value: 600 } });
    const applyScale = vi.fn();
    const navigation = mountGraphNavigation({ main, overlayHost: main, applyScale });
    navigation.setContent(content);
    const resizeTo = (width: number) => { paneWidth = width; resize(); };
    return { main, applyScale, navigation, resizeTo, input: main.querySelector('input') as HTMLInputElement };
  }

  it('keeps the readable default scale on resize until Fit is pressed, then follows the pane', () => {
    const { main, applyScale, navigation, resizeTo, input } = mountResizable(750);
    expect(input.value).toBe('100%');
    resizeTo(300);
    expect(input.value).toBe('100%');
    (main.querySelector('[data-zoom-fit]') as HTMLButtonElement).click();
    expect(applyScale).toHaveBeenLastCalledWith(0.4);
    expect(input.value).toBe('40%');
    resizeTo(500);
    expect(input.value).toBe('67%');
    resizeTo(1200);
    expect(input.value).toBe('100%');
    navigation.dispose();
    vi.unstubAllGlobals();
  });

  it('repaints at the chosen zoom in manual mode, and Fit fits the current width', () => {
    const { main, applyScale, navigation, resizeTo, input } = mountResizable(750);
    (main.querySelector('[data-zoom-out]') as HTMLButtonElement).click();
    expect(input.value).toBe('90%');
    applyScale.mockClear();
    resizeTo(300);
    expect(applyScale).toHaveBeenCalledWith(0.9);
    expect(input.value).toBe('90%');
    (main.querySelector('[data-zoom-fit]') as HTMLButtonElement).click();
    expect(input.value).toBe('40%');
    navigation.dispose();
    vi.unstubAllGlobals();
  });
});
