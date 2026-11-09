// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tipEl = () => document.getElementById('lt-tip') as HTMLElement;
const over = (el: Element, x = 10, y = 10) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: x, clientY: y }));
const move = (el: Element, x: number, y: number) => el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
const out = (el: Element, to: Element | null) => el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: to }));

async function setup(keysFor?: (command: string) => string[] | undefined) {
  vi.resetModules();
  document.body.innerHTML = '<button id="a" data-tip="Reload the map">⟳</button><button id="b" data-tip="Open settings" aria-label="Open settings">⚙</button><span id="c" data-tip="">none</span><canvas id="g" data-tip-at="pointer" data-tip=""></canvas>';
  const mod = await import('../src/renderer/tooltip');
  mod.installTooltips(keysFor ? { keysFor } : {});
  return mod;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('tooltips', () => {
  it('shows after the delay, then the next one at once while warm, and hides on leave', async () => {
    const { SHOW_DELAY_MS } = await setup();
    over($('a'));
    expect(tipEl().hidden).toBe(true);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tipEl().hidden).toBe(false);
    expect(tipEl().textContent).toBe('Reload the map');
    expect([tipEl().style.left, tipEl().style.top]).toEqual(['8px', '8px']);
    over($('b'));
    expect(tipEl().hidden).toBe(false);
    expect(tipEl().textContent).toBe('Open settings');
    out($('b'), null);
    expect(tipEl().hidden).toBe(true);
  });

  it('waits the full delay again once the skip window has passed', async () => {
    const { SHOW_DELAY_MS, SKIP_DELAY_MS } = await setup();
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    out($('a'), null);
    vi.advanceTimersByTime(SKIP_DELAY_MS + 50);
    over($('b'));
    expect(tipEl().hidden).toBe(true);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tipEl().hidden).toBe(false);
  });

  it('skips an empty tip and stays hidden after a press until the pointer leaves', async () => {
    const { SHOW_DELAY_MS } = await setup();
    over($('c'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tipEl().hidden).toBe(true);
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    $('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(tipEl().hidden).toBe(true);
    move($('a'), 12, 12);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tipEl().hidden).toBe(true);
  });

  it('waits the full delay after a press, even on a control repainted by the click', async () => {
    const { SHOW_DELAY_MS } = await setup();
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    $('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const fresh = $('a').cloneNode(true) as HTMLElement;
    $('a').replaceWith(fresh);
    move(fresh, 11, 11);
    expect(tipEl().hidden).toBe(true);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tipEl().hidden).toBe(false);
  });

  it('describes the element only when the tip adds something to its label', async () => {
    const { SHOW_DELAY_MS } = await setup();
    over($('a'));
    expect($('a').getAttribute('aria-describedby')).toBe('lt-tip');
    over($('b'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect($('a').hasAttribute('aria-describedby')).toBe(false);
    expect($('b').hasAttribute('aria-describedby')).toBe(false);
  });

  it('adds the key chips of a command and follows a changed or emptied tip', async () => {
    const { SHOW_DELAY_MS } = await setup((command) => (command === 'lantern.refresh' ? ['⌘', 'R'] : undefined));
    $('a').dataset.tipCommand = 'lantern.refresh';
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect([...tipEl().querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['⌘', 'R']);
    $('a').dataset.tip = 'Another run is in progress';
    await Promise.resolve();
    expect(tipEl().firstChild?.textContent).toBe('Another run is in progress');
    $('a').dataset.tip = '';
    await Promise.resolve();
    expect(tipEl().hidden).toBe(true);
  });

  it('shows a registered card in place of the text, and plain text again on the next element', async () => {
    const { SHOW_DELAY_MS, setTipCard } = await setup();
    setTipCard($('b'), () => {
      const card = document.createElement('div');
      card.className = 'card';
      card.textContent = 'Opened by Ada';
      return card;
    });
    over($('b'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tipEl().querySelector('.card')?.textContent).toBe('Opened by Ada');
    expect(tipEl().classList.contains('is-card')).toBe(true);
    expect($('b').getAttribute('aria-describedby')).toBe('lt-tip');
    over($('a'));
    expect(tipEl().textContent).toBe('Reload the map');
    expect(tipEl().classList.contains('is-card')).toBe(false);
  });

  it('follows the pointer on a canvas whose tip changes under it', async () => {
    const { SHOW_DELAY_MS } = await setup();
    move($('g'), 40, 50);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tipEl().hidden).toBe(true);
    $('g').dataset.tip = 'src/main/lantern.ts — service';
    await Promise.resolve();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tipEl().hidden).toBe(false);
    expect(tipEl().classList.contains('is-at-pointer')).toBe(true);
    expect(tipEl().style.left).toBe('54px');
    expect(tipEl().style.top).toBe('64px');
    move($('g'), 100, 120);
    expect(tipEl().style.left).toBe('114px');
  });

  it('comes back on a clicked canvas once the pointer reaches another node', async () => {
    const { SHOW_DELAY_MS } = await setup();
    $('g').dataset.tip = 'node one';
    move($('g'), 40, 50);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    $('g').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    move($('g'), 41, 51);
    expect(tipEl().hidden).toBe(true);
    $('g').dataset.tip = 'node two';
    await Promise.resolve();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tipEl().hidden).toBe(false);
    expect(tipEl().textContent).toBe('node two');
  });

  it('hides a hover tip when focus moves elsewhere by keyboard', async () => {
    const { SHOW_DELAY_MS } = await setup();
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(tipEl().hidden).toBe(true);
  });

  it('hides on Escape, on scroll and when its element leaves the page', async () => {
    const { SHOW_DELAY_MS } = await setup();
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tipEl().hidden).toBe(true);
    over($('b'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    document.dispatchEvent(new Event('scroll'));
    expect(tipEl().hidden).toBe(true);
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    $('a').remove();
    vi.advanceTimersByTime(250);
    expect(tipEl().hidden).toBe(true);
  });
});
