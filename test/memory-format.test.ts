import { describe, expect, it } from 'vitest';
import { formatAge, formatBytes, formatInstalled, formatShare, sparklinePoints } from '../src/renderer/lib/memoryformat';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

describe('formatBytes', () => {
  it.each([
    [0, '0 KB'],
    [900 * 1024, '900 KB'],
    [512 * MB, '512 MB'],
    [1023 * MB, '1023 MB'],
    [1.62 * GB, '1.62 GB'],
    [18.94 * GB, '18.9 GB'],
  ])('formats %d bytes as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe('formatAge', () => {
  it.each([
    [42, '42s'],
    [60, '1m'],
    [59 * 60, '59m'],
    [3 * 3600 + 12 * 60, '3h 12m'],
    [40 * 3600, '1d 16h'],
    [4 * 86400 + 5 * 3600, '4d 5h'],
  ])('formats %d seconds as %s', (seconds, text) => {
    expect(formatAge(seconds)).toBe(text);
  });
});

describe('formatShare and formatInstalled', () => {
  it('shows one decimal below ten percent and none above', () => {
    expect(formatShare(2 * GB, 24 * GB)).toBe('8.3%');
    expect(formatShare(18.9 * GB, 24 * GB)).toBe('79%');
    expect(formatShare(1, 0)).toBe('0%');
  });

  it('rounds installed memory to whole gigabytes', () => {
    expect(formatInstalled(25769803776)).toBe('24 GB');
  });
});

describe('sparklinePoints', () => {
  it('needs at least two readings', () => {
    expect(sparklinePoints([], 60, 16)).toBe('');
    expect(sparklinePoints([5], 60, 16)).toBe('');
  });

  it('draws growth upwards: later and larger readings sit higher and further right', () => {
    const points = sparklinePoints([10, 20, 30], 60, 16)
      .split(' ')
      .map((pair) => pair.split(',').map(Number));
    expect(points.map(([x]) => x)).toEqual([1.5, 30, 58.5]);
    expect(points.map(([, y]) => y)).toEqual([14.5, 8, 1.5]);
  });

  it('keeps jitter of a percent or two nearly flat instead of stretching it to full height', () => {
    const ys = sparklinePoints([600 * MB, 602 * MB, 599 * MB, 601 * MB], 60, 16)
      .split(' ')
      .map((pair) => Number(pair.split(',')[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(3);
  });

  it('draws a flat series in the middle', () => {
    const ys = sparklinePoints([7, 7, 7], 60, 16)
      .split(' ')
      .map((pair) => Number(pair.split(',')[1]));
    expect(new Set(ys)).toEqual(new Set([8]));
  });
});
