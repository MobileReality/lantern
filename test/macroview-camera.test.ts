import { describe, expect, it } from 'vitest';
import { clamp, constrainCamera, easeInOut, fitCamera, intersects, lerpCamera, panBy, sameCamera, toScreen, toWorld, unionOf, worldRect, zoomAt, zoomLimits } from '../src/renderer/lib/macroview/camera';
import type { Camera, Rect } from '../src/renderer/lib/macroview/camera';
import { actionOf } from '../src/renderer/lib/macroview/keys';
import { wheelFactor } from '../src/renderer/lib/macroview/input';

const VIEWPORT = { w: 800, h: 600 };
const WORLD: Rect = { x: 0, y: 0, w: 2000, h: 1000 };

describe('fitCamera', () => {
  it('shows the whole rect with the padding left around it and centres it', () => {
    const camera = fitCamera(WORLD, VIEWPORT, 20);
    expect(camera.k).toBeCloseTo(760 / 2000);
    const corner = toScreen(camera, { x: 0, y: 0 });
    const far = toScreen(camera, { x: 2000, y: 1000 });
    expect(corner.x).toBeCloseTo(20);
    expect(far.x).toBeCloseTo(780);
    expect(corner.y + far.y).toBeCloseTo(VIEWPORT.h);
  });

  it('fits a tall rect by its height', () => {
    const camera = fitCamera({ x: 100, y: 100, w: 100, h: 1000 }, VIEWPORT, 0);
    expect(camera.k).toBeCloseTo(0.6);
    const middle = toScreen(camera, { x: 150, y: 600 });
    expect(middle.x).toBeCloseTo(400);
    expect(middle.y).toBeCloseTo(300);
  });

  it('leaves room at the bottom when asked to', () => {
    const camera = fitCamera(WORLD, VIEWPORT, 0, 100);
    const bottom = toScreen(camera, { x: 1000, y: 1000 });
    expect(bottom.y).toBeLessThanOrEqual(VIEWPORT.h - 100 + 0.001);
  });

  it('does not divide by zero on an empty rect or viewport', () => {
    expect(fitCamera({ x: 0, y: 0, w: 0, h: 0 }, VIEWPORT).k).toBe(1);
    expect(Number.isFinite(fitCamera(WORLD, { w: 0, h: 0 }).k)).toBe(true);
  });
});

describe('zoomAt', () => {
  const fit = fitCamera(WORLD, VIEWPORT);
  const limits = zoomLimits(fit);

  it('keeps the world point under the pointer where it was', () => {
    const anchor = { x: 300, y: 200 };
    const before = toWorld(fit, anchor);
    const zoomed = zoomAt(fit, 3, anchor, limits);
    expect(zoomed.k).toBeCloseTo(fit.k * 3);
    const after = toWorld(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('stops at the limits however large the factor', () => {
    expect(zoomAt(fit, 1e6, { x: 0, y: 0 }, limits).k).toBe(limits.max);
    expect(zoomAt(fit, 1e-6, { x: 0, y: 0 }, limits).k).toBe(limits.min);
  });

  it('keeps the anchor fixed even when the zoom was clamped', () => {
    const anchor = { x: 120, y: 90 };
    const clamped = zoomAt(fit, 1e6, anchor, limits);
    const world = toWorld(fit, anchor);
    const after = toWorld(clamped, anchor);
    expect(after.x).toBeCloseTo(world.x);
    expect(after.y).toBeCloseTo(world.y);
  });
});

describe('zoom limits', () => {
  it('allow zooming out a little past the fit and in many times, never past the absolute maximum', () => {
    const fit = fitCamera(WORLD, VIEWPORT);
    const limits = zoomLimits(fit);
    expect(limits.min).toBeLessThan(fit.k);
    expect(limits.max).toBeGreaterThan(fit.k * 8);
    expect(limits.max).toBeLessThanOrEqual(4);
    expect(zoomLimits({ x: 0, y: 0, k: 3 }).max).toBeGreaterThanOrEqual(3);
  });
});

describe('panning and bounds', () => {
  it('moves the camera by whole screen pixels', () => {
    expect(panBy({ x: 10, y: 20, k: 2 }, 5, -7)).toEqual({ x: 15, y: 13, k: 2 });
  });

  it('keeps the centre of the view inside the world, with some slack', () => {
    const lost: Camera = { x: -50000, y: -50000, k: 1 };
    const back = constrainCamera(lost, WORLD, VIEWPORT);
    const centre = toWorld(back, { x: VIEWPORT.w / 2, y: VIEWPORT.h / 2 });
    expect(centre.x).toBeLessThanOrEqual(WORLD.w * 1.13);
    expect(centre.y).toBeLessThanOrEqual(WORLD.h * 1.13);
    const fine = { x: 100, y: 100, k: 1 };
    expect(constrainCamera(fine, WORLD, VIEWPORT)).toEqual(fine);
  });

  it('converts between screen and world and back', () => {
    const camera = { x: 40, y: -30, k: 1.7 };
    const world = toWorld(camera, { x: 250, y: 125 });
    const screen = toScreen(camera, world);
    expect(screen.x).toBeCloseTo(250);
    expect(screen.y).toBeCloseTo(125);
    const visible = worldRect(camera, VIEWPORT);
    expect(visible.w).toBeCloseTo(VIEWPORT.w / 1.7);
  });
});

describe('animation maths', () => {
  const from: Camera = { x: 0, y: 0, k: 0.3 };
  const to: Camera = { x: -900, y: -400, k: 2.4 };

  it('starts at the first camera and ends at the second', () => {
    expect(lerpCamera(from, to, 0, VIEWPORT)).toEqual({ x: expect.closeTo(0), y: expect.closeTo(0), k: expect.closeTo(0.3) });
    const end = lerpCamera(from, to, 1, VIEWPORT);
    expect(end.k).toBeCloseTo(2.4);
    expect(end.x).toBeCloseTo(-900);
    expect(end.y).toBeCloseTo(-400);
  });

  it('changes the zoom geometrically, so the middle is the geometric mean', () => {
    expect(lerpCamera(from, to, 0.5, VIEWPORT).k).toBeCloseTo(Math.sqrt(0.3 * 2.4));
  });

  it('eases in and out and stays inside 0..1', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(7)).toBe(1);
  });

  it('knows when two cameras are the same', () => {
    expect(sameCamera(from, { ...from, x: 0.2 })).toBe(true);
    expect(sameCamera(from, { ...from, k: 0.31 })).toBe(false);
  });
});

describe('rect helpers', () => {
  it('unions, intersects and clamps', () => {
    expect(unionOf([])).toBeNull();
    expect(unionOf([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 30, h: 15 });
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(clamp(5, 1, 3)).toBe(3);
  });
});

describe('wheel and keys', () => {
  it('turns a wheel step into a zoom factor, bounded so one tick never jumps', () => {
    expect(wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeGreaterThan(1);
    expect(wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeLessThan(1);
    expect(wheelFactor({ deltaY: -100000, deltaMode: 0, ctrlKey: false })).toBeLessThanOrEqual(Math.exp(0.5));
    expect(wheelFactor({ deltaY: -5, deltaMode: 0, ctrlKey: true })).toBeGreaterThan(wheelFactor({ deltaY: -5, deltaMode: 0, ctrlKey: false }));
    expect(wheelFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false })).toBeGreaterThan(wheelFactor({ deltaY: -3, deltaMode: 0, ctrlKey: false }));
  });

  it('maps the keys to actions and ignores the modified ones', () => {
    const key = (name: string, extra: Partial<KeyboardEvent> = {}) => actionOf({ key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
    expect(key('+')).toEqual({ type: 'zoom', factor: expect.any(Number) });
    expect((key('-') as { factor: number }).factor).toBeLessThan(1);
    expect(key('0')).toEqual({ type: 'fit' });
    expect(key('Enter')).toEqual({ type: 'dive' });
    expect(key('Escape')).toEqual({ type: 'out' });
    expect(key('ArrowLeft')).toEqual({ type: 'move', direction: 'left' });
    expect(key('ArrowDown', { shiftKey: true })).toEqual({ type: 'pan', direction: 'down' });
    expect(key('+', { metaKey: true })).toBeNull();
    expect(key('0', { metaKey: true })).toBeNull();
    expect(key('0', { ctrlKey: true })).toBeNull();
    expect(key('a')).toBeNull();
    expect(key('Enter', { altKey: true })).toBeNull();
  });
});
