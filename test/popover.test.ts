// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountPopover, rovingFocus } from '../src/renderer/popover';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const press = (el: Element) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML =
    '<div id="outside" tabindex="0"></div>' +
    '<button id="t1">menu</button><ul id="p1"><li><button class="it">One</button></li><li><button class="it">Two</button></li><li><button class="it" id="nest">Three</button></li></ul>' +
    '<button id="t2">other</button><div id="p2"><input id="f"></div>';
});

function menu() {
  const items = () => [...$('p1').querySelectorAll<HTMLElement>('.it')];
  const pop = mountPopover($('t1'), $('p1'), { placement: 'top-start', focus: () => items()[0] });
  rovingFocus($('p1'), items);
  return { pop, items };
}

describe('popovers', () => {
  it('opens from its trigger into the top layer, anchored and focused, and closes on a second click', () => {
    const { pop, items } = menu();
    expect($('p1').getAttribute('popover')).toBe('manual');
    expect($('p1').hidden).toBe(true);
    $('t1').click();
    expect(pop.isOpen()).toBe(true);
    expect($('t1').getAttribute('aria-expanded')).toBe('true');
    expect($('t1').style.getPropertyValue('anchor-name')).toBe($('p1').style.getPropertyValue('position-anchor'));
    expect(document.activeElement).toBe(items()[0]);
    $('t1').click();
    expect(pop.isOpen()).toBe(false);
    expect($('t1').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe($('t1'));
  });

  it('closes on a press outside, keeps open on a press inside or on the trigger', () => {
    const { pop } = menu();
    pop.open();
    press($('p1').querySelector('.it')!);
    press($('t1'));
    expect(pop.isOpen()).toBe(true);
    press($('outside'));
    expect(pop.isOpen()).toBe(false);
  });

  it('closes only the topmost on Escape, keeps the key from the page below and refocuses its trigger', () => {
    const { pop } = menu();
    const below = vi.fn();
    document.body.addEventListener('keydown', below);
    const inner = mountPopover($('nest'), $('p2'), { placement: 'bottom-start', focus: () => $('f') });
    pop.open();
    inner.open();
    expect(pop.isOpen()).toBe(true);
    key($('f'), 'Escape');
    expect(inner.isOpen()).toBe(false);
    expect(pop.isOpen()).toBe(true);
    expect(document.activeElement).toBe($('nest'));
    key($('nest'), 'Escape');
    expect(pop.isOpen()).toBe(false);
    expect(below).not.toHaveBeenCalled();
  });

  it('closes an unrelated popover when another opens', () => {
    const { pop } = menu();
    const other = mountPopover($('t2'), $('p2'), { placement: 'bottom-start' });
    pop.open();
    other.open();
    expect(pop.isOpen()).toBe(false);
    expect(other.isOpen()).toBe(true);
  });

  it('closes when focus moves outside, and moves through its items with the arrow keys', () => {
    const { pop, items } = menu();
    pop.open();
    key(items()[0], 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1], 'End');
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2], 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    $('outside').focus();
    expect(pop.isOpen()).toBe(false);
  });

  it('lets go of a popover whose element left the page without closing', () => {
    const { pop } = menu();
    const below = vi.fn();
    document.body.addEventListener('keydown', below);
    pop.open();
    $('p1').remove();
    key($('t1'), 'Escape');
    expect(pop.isOpen()).toBe(false);
    expect($('t1').getAttribute('aria-expanded')).toBe('false');
    expect(below).toHaveBeenCalledTimes(1);
  });

  it('lets a disposed popover go: no listener, no anchor', () => {
    const { pop } = menu();
    pop.open();
    pop.dispose();
    expect(pop.isOpen()).toBe(false);
    expect($('t1').style.getPropertyValue('anchor-name')).toBe('');
    $('t1').click();
    expect(pop.isOpen()).toBe(false);
  });
});
