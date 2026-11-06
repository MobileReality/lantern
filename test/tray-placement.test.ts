import { describe, expect, it } from 'vitest';
import { maxPopoverHeight, POPOVER_WIDTH, popoverBounds, shouldOpen } from '../src/main/tray-placement';

const workArea = { x: 0, y: 25, width: 1440, height: 875 };
const icon = (x: number) => ({ x, y: 0, width: 24, height: 25 });

describe('popoverBounds', () => {
  it('centres the popover under the icon, a few pixels below the menu bar', () => {
    expect(popoverBounds(icon(700), 300, workArea)).toEqual({ x: 700 + 12 - POPOVER_WIDTH / 2, y: 31, width: POPOVER_WIDTH, height: 300 });
  });

  it('keeps the popover on the screen when the icon is at the right edge', () => {
    const bounds = popoverBounds(icon(1416), 300, workArea);
    expect(bounds.x + bounds.width).toBe(1440 - 8);
  });

  it('keeps the popover on the screen when the icon is at the left edge', () => {
    expect(popoverBounds(icon(2), 300, workArea).x).toBe(8);
  });

  it('places it on the display the icon is on, including one left of the primary', () => {
    const left = { x: -1920, y: 25, width: 1920, height: 1055 };
    expect(popoverBounds(icon(-1000), 300, left).x).toBe(-1000 + 12 - POPOVER_WIDTH / 2);
    expect(popoverBounds(icon(-1910), 300, left).x).toBe(-1920 + 8);
  });

  it('places it under the menu bar of a display whose work area starts lower than the icon', () => {
    expect(popoverBounds({ x: 700, y: 0, width: 24, height: 22 }, 300, { ...workArea, y: 38 }).y).toBe(44);
  });

  it('shrinks to the room left below the icon', () => {
    expect(popoverBounds(icon(700), 5000, workArea).height).toBe(25 + 875 - 31 - 8);
  });

  it('falls back to the top right corner when the system gives no icon rectangle', () => {
    expect(popoverBounds({ x: 0, y: 0, width: 0, height: 0 }, 300, workArea)).toEqual({ x: 1440 - POPOVER_WIDTH - 8, y: 31, width: POPOVER_WIDTH, height: 300 });
  });

  it('never returns a height below one pixel', () => {
    expect(popoverBounds(icon(700), 0, workArea).height).toBe(1);
  });
});

describe('maxPopoverHeight', () => {
  it('is the room below the icon on that display', () => {
    expect(maxPopoverHeight(icon(700), workArea)).toBe(25 + 875 - 31 - 8);
  });
});

describe('shouldOpen', () => {
  it('ignores the click that closed the popover by blurring it', () => {
    expect(shouldOpen(1000, 1100)).toBe(false);
  });

  it('opens on a later click', () => {
    expect(shouldOpen(1000, 1400)).toBe(true);
    expect(shouldOpen(0, 5000)).toBe(true);
  });
});
