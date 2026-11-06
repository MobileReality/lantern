import { vi } from 'vitest';

const WIDE_PANE = { w: 700, h: 880 };
const SMALL_PANE = { w: 280, h: 360 };

function sizeTheMacroViewPane(pane = SMALL_PANE) {
  const sized = (property: 'clientWidth' | 'clientHeight', value: number) =>
    vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('lt-macroview') ? value : 0;
    });
  sized('clientWidth', pane.w);
  sized('clientHeight', pane.h);
  Object.assign(HTMLElement.prototype, { setPointerCapture: () => undefined, releasePointerCapture: () => undefined, hasPointerCapture: () => true });
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
}

const macroViewRoot = (root: ParentNode) => root.querySelector('.lt-macroview-host .lt-macroview') as HTMLElement;
const macroViewItem = (root: ParentNode, key: string) => root.querySelector(`.lt-macroview [data-key="${key}"]`) as SVGGElement;
const shapeOf = (item: Element) => (item.querySelector(':scope > .mv-shape, :scope > .mv-lane-shape') ?? item) as Element;

function pick(root: ParentNode, key: string) {
  const target = shapeOf(macroViewItem(root, key));
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
}

function dive(root: ParentNode, key: string) {
  shapeOf(macroViewItem(root, key)).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}

function flagged(root: ParentNode, flag: string, kind = ''): string[] {
  return [...root.querySelectorAll(`.lt-macroview .mv-item${kind}.${flag}`)].map((item) => item.getAttribute('data-key') ?? '').sort();
}

function label(root: ParentNode, key: string) {
  return macroViewItem(root, key).getAttribute('aria-label') ?? '';
}

export { SMALL_PANE, WIDE_PANE, dive, flagged, label, pick, sizeTheMacroViewPane, macroViewItem, macroViewRoot };
