import { describe, expect, it } from 'vitest';
import { keepActive, NONE, trayIntent } from '../src/shared/tray-keys';

const press = (key: string, active: number, count = 5, shift = false) => trayIntent({ key, shift }, active, count);

describe('the tray keyboard', () => {
  it('moves down, and the first press selects the first item', () => {
    expect(press('ArrowDown', NONE)).toEqual({ kind: 'move', to: 0 });
    expect(press('ArrowDown', 1)).toEqual({ kind: 'move', to: 2 });
  });

  it('moves up, and the first press selects the last item', () => {
    expect(press('ArrowUp', NONE)).toEqual({ kind: 'move', to: 4 });
    expect(press('ArrowUp', 3)).toEqual({ kind: 'move', to: 2 });
  });

  it('wraps at both ends', () => {
    expect(press('ArrowDown', 4)).toEqual({ kind: 'move', to: 0 });
    expect(press('ArrowUp', 0)).toEqual({ kind: 'move', to: 4 });
  });

  it('jumps to the ends with Home and End', () => {
    expect(press('Home', 3)).toEqual({ kind: 'move', to: 0 });
    expect(press('End', 1)).toEqual({ kind: 'move', to: 4 });
  });

  it('treats Tab like the arrows so focus never leaves the popover', () => {
    expect(press('Tab', 1)).toEqual({ kind: 'move', to: 2 });
    expect(press('Tab', 1, 5, true)).toEqual({ kind: 'move', to: 0 });
  });

  it('opens the active item on Enter and does nothing when none is active', () => {
    expect(press('Enter', 2)).toEqual({ kind: 'activate' });
    expect(press('Enter', NONE)).toBeNull();
  });

  it('closes on Escape even when the list is empty', () => {
    expect(press('Escape', 2)).toEqual({ kind: 'close' });
    expect(press('Escape', NONE, 0)).toEqual({ kind: 'close' });
  });

  it('ignores movement with nothing to move to, and other keys', () => {
    expect(press('ArrowDown', NONE, 0)).toBeNull();
    expect(press('a', 1)).toBeNull();
  });
});

describe('keepActive', () => {
  it('follows the same item to its new place after the list changes', () => {
    expect(keepActive('project:/b', ['project:/a', 'project:/b'], 0)).toBe(1);
  });

  it('stays on the same position when its item is gone, clamped to the new end', () => {
    expect(keepActive('project:/gone', ['project:/a', 'project:/b'], 5)).toBe(1);
    expect(keepActive('project:/gone', ['project:/a', 'project:/b'], 0)).toBe(0);
  });

  it('keeps nothing active when nothing was and when nothing is left', () => {
    expect(keepActive(null, ['project:/a'], NONE)).toBe(NONE);
    expect(keepActive('project:/a', [], 0)).toBe(NONE);
  });
});
