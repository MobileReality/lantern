// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installPopoverShim } from './support/popover-shim';

function popover() {
  const el = document.createElement('div');
  el.setAttribute('popover', 'manual');
  el.hidden = true;
  const button = document.createElement('button');
  el.append(button);
  document.body.append(el);
  return { el, button };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('popover shim', () => {
  it('is installed by the shared setup', () => {
    expect(typeof HTMLElement.prototype.showPopover).toBe('function');
  });

  it('lets an item inside an opened popover take focus', () => {
    const { el, button } = popover();
    el.hidden = false;
    el.showPopover();
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('keeps an unopened popover from taking focus', () => {
    const { el, button } = popover();
    el.hidden = false;
    button.focus();
    expect(document.activeElement).toBe(document.body);
  });

  it('reports the open state through :popover-open', () => {
    const { el } = popover();
    expect(el.matches(':popover-open')).toBe(false);
    el.showPopover();
    expect(el.matches(':popover-open')).toBe(true);
    expect(el.matches('[popover]:not(:popover-open)')).toBe(false);
    el.hidePopover();
    expect(el.matches(':popover-open')).toBe(false);
  });

  it('toggles and honours force', () => {
    const { el } = popover();
    expect(el.togglePopover()).toBe(true);
    expect(el.matches(':popover-open')).toBe(true);
    expect(el.togglePopover(true)).toBe(true);
    expect(el.togglePopover()).toBe(false);
    expect(el.matches(':popover-open')).toBe(false);
  });

  it('refuses an element that is not a popover', () => {
    const plain = document.createElement('div');
    document.body.append(plain);
    expect(() => plain.showPopover()).toThrow(/popover/i);
  });

  it('leaves a native implementation alone', () => {
    const native = () => undefined;
    const proto = { showPopover: native };
    const win = { HTMLElement: { prototype: proto }, Element: { prototype: {} } };
    installPopoverShim(win as never);
    expect(proto.showPopover).toBe(native);
  });
});
