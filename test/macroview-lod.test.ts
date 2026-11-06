import { describe, expect, it } from 'vitest';
import { FEATURES_RAMP, FILES_RAMP, featuresWeight, filesWeight, fitLabel, isActive, isShown, levelOf, rampWeight, textWidth, wrapLines } from '../src/renderer/lib/macroview/lod';

describe('level of detail', () => {
  it('shows no features on a small area, all of them on a big one, and fades in between', () => {
    expect(featuresWeight(FEATURES_RAMP.from - 1)).toBe(0);
    expect(featuresWeight(FEATURES_RAMP.from + FEATURES_RAMP.span + 1)).toBe(1);
    const middle = featuresWeight(FEATURES_RAMP.from + FEATURES_RAMP.span / 2);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  it('is monotonic: a bigger shape never shows less', () => {
    let last = -1;
    for (let width = 0; width <= 800; width += 10) {
      const now = featuresWeight(width);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('only lists files of a feature whose area already shows its features', () => {
    const wide = FILES_RAMP.from + FILES_RAMP.span + 10;
    expect(filesWeight(wide, 1)).toBe(1);
    expect(filesWeight(wide, 0)).toBe(0);
    expect(filesWeight(wide, 0.5)).toBe(0.5);
    expect(filesWeight(FILES_RAMP.from - 1, 1)).toBe(0);
  });

  it('names the level by what is mostly on show', () => {
    expect(levelOf({ features: 0, files: 0 })).toBe('areas');
    expect(levelOf({ features: 0.6, files: 0.1 })).toBe('features');
    expect(levelOf({ features: 1, files: 0.9 })).toBe('files');
    expect(isShown(0)).toBe(false);
    expect(isShown(0.1)).toBe(true);
    expect(isActive(0.4)).toBe(false);
    expect(isActive(0.5)).toBe(true);
    expect(rampWeight(5, { from: 0, span: 10 })).toBe(0.5);
  });
});

describe('labels stay legible', () => {
  it('keeps a label that fits at its full size', () => {
    expect(fitLabel('Ordering', 400, 20, 12)).toEqual({ text: 'Ordering', size: 20 });
  });

  it('shrinks a label towards its minimum before cutting it', () => {
    const fitted = fitLabel('Fulfilment centre', 110, 20, 12);
    expect(fitted).not.toBeNull();
    expect(fitted?.size).toBeLessThan(20);
    expect(fitted?.size).toBeGreaterThanOrEqual(12);
  });

  it('cuts with an ellipsis once the minimum size is reached and the room is still too small', () => {
    const fitted = fitLabel('Delivery slots and windows', 90, 20, 12);
    expect(fitted?.size).toBe(12);
    expect(fitted?.text.endsWith('…')).toBe(true);
    expect(textWidth(fitted?.text ?? '', fitted?.size ?? 0)).toBeLessThanOrEqual(90);
  });

  it('drops a label that has no room at all rather than drawing a stub', () => {
    expect(fitLabel('Ordering', 12, 20, 12)).toBeNull();
    expect(fitLabel('', 400, 20, 12)).toBeNull();
    expect(fitLabel('Ordering', 0, 20, 12)).toBeNull();
  });

  it('wraps a purpose into at most the lines allowed and closes the last one with an ellipsis', () => {
    const lines = wrapLines('taking money, giving it back and proving it to the people who ask', 140, 12, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    for (const line of lines) expect(textWidth(line, 12)).toBeLessThanOrEqual(140 + 12);
    expect(wrapLines('short', 200, 12, 3)).toEqual(['short']);
    expect(wrapLines('anything', 10, 12, 3)).toEqual([]);
  });
});
