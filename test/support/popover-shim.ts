const OPEN_ATTRIBUTE = 'data-popover-open';
const STYLE_ID = 'popover-shim-style';
const OPEN_SELECTOR = /:popover-open/g;

function revealOpenPopovers(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `[popover][${OPEN_ATTRIBUTE}] { display: block; }`;
  (doc.head ?? doc.documentElement).append(style);
}

export function installPopoverShim(win: Window & typeof globalThis) {
  const proto = win.HTMLElement?.prototype;
  if (!proto || 'showPopover' in proto) return;

  function assertPopover(el: HTMLElement) {
    if (!el.hasAttribute('popover')) throw new win.DOMException('Not a popover element', 'NotSupportedError');
  }

  proto.showPopover = function showPopover(this: HTMLElement) {
    assertPopover(this);
    revealOpenPopovers(this.ownerDocument);
    this.setAttribute(OPEN_ATTRIBUTE, '');
  };

  proto.hidePopover = function hidePopover(this: HTMLElement) {
    assertPopover(this);
    this.removeAttribute(OPEN_ATTRIBUTE);
  };

  proto.togglePopover = function togglePopover(this: HTMLElement, force?: boolean) {
    const open = this.hasAttribute(OPEN_ATTRIBUTE);
    if (force === open) return open;
    if (open) this.hidePopover();
    else this.showPopover();
    return !open;
  };

  const realMatches = win.Element.prototype.matches;
  win.Element.prototype.matches = function matches(this: Element, selector: string) {
    return realMatches.call(this, selector.replace(OPEN_SELECTOR, `[${OPEN_ATTRIBUTE}]`));
  };
}
