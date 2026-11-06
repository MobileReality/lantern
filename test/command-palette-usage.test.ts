// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bumpUsage, readUsage } from '../src/renderer/command-palette/usage';

const KEY = 'lantern.commandUsage';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('command usage', () => {
  it('reads nothing when nothing is stored', () => {
    expect(readUsage()).toEqual({});
  });

  it('round-trips bumps through localStorage', () => {
    bumpUsage('lantern.open');
    expect(readUsage()).toEqual({ 'lantern.open': 1 });
    expect(JSON.parse(localStorage.getItem(KEY) ?? '')).toEqual({ 'lantern.open': 1 });
  });

  it('increments an existing count', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'palette.open': 40 }));
    bumpUsage('palette.open');
    bumpUsage('settings.open');
    expect(readUsage()).toEqual({ 'palette.open': 41, 'settings.open': 1 });
  });

  it('ignores malformed JSON and non-object values', () => {
    localStorage.setItem(KEY, '{broken');
    expect(readUsage()).toEqual({});
    localStorage.setItem(KEY, '[1, 2]');
    expect(readUsage()).toEqual({});
    localStorage.setItem(KEY, 'null');
    expect(readUsage()).toEqual({});
  });

  it('keeps only numeric counts', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 3, b: '4', c: null, d: { n: 1 } }));
    expect(readUsage()).toEqual({ a: 3 });
  });

  it('swallows storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readUsage()).toEqual({});
    expect(() => bumpUsage('lantern.open')).not.toThrow();
  });
});
