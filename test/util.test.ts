import { describe, expect, it } from 'vitest';
import { baseName, folderToPath, formatDay, samePath } from '../src/renderer/lib/util';

describe('formatDay', () => {
  const LATE_DEC_31_UTC = Date.UTC(2026, 11, 31, 23, 30);

  function inTimezone<T>(zone: string, run: () => T): T {
    const before = process.env.TZ;
    process.env.TZ = zone;
    try {
      return run();
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  }

  it('writes day, short month and year, in British order', () => {
    expect(formatDay(Date.UTC(2026, 0, 5, 12), { utc: true })).toBe('5 Jan 2026');
    expect(formatDay(Date.UTC(2026, 11, 31, 23, 59, 59), { utc: true })).toBe('31 Dec 2026');
  });

  it('keeps the year unless told otherwise', () => {
    expect(formatDay(Date.UTC(2026, 11, 31, 12), { utc: true })).toBe(formatDay(Date.UTC(2026, 11, 31, 12), { utc: true, year: true }));
  });

  it('leaves the year out on request', () => {
    expect(formatDay(Date.UTC(2026, 11, 31, 12), { utc: true, year: false })).toBe('31 Dec');
  });

  it('reads the day in UTC when asked, wherever the computer is', () => {
    expect(inTimezone('Pacific/Kiritimati', () => formatDay(LATE_DEC_31_UTC, { utc: true }))).toBe('31 Dec 2026');
    expect(inTimezone('America/Los_Angeles', () => formatDay(LATE_DEC_31_UTC, { utc: true }))).toBe('31 Dec 2026');
  });

  it('reads the day on the local clock otherwise, so the same moment can fall on another date', () => {
    expect(inTimezone('Pacific/Kiritimati', () => formatDay(LATE_DEC_31_UTC))).toBe('1 Jan 2027');
    expect(inTimezone('America/Los_Angeles', () => formatDay(LATE_DEC_31_UTC))).toBe('31 Dec 2026');
    expect(inTimezone('Pacific/Kiritimati', () => formatDay(LATE_DEC_31_UTC, { year: false }))).toBe('1 Jan');
  });

  it('says nothing for a time that is not a date', () => {
    expect(formatDay(Number.NaN)).toBe('');
    expect(formatDay(Number.POSITIVE_INFINITY, { utc: true })).toBe('');
    expect(formatDay(8.64e15 + 1)).toBe('');
  });
});

describe('baseName', () => {
  it('returns the last segment of a posix path', () => {
    expect(baseName('/Users/me/project/file.ts')).toBe('file.ts');
  });

  it('returns the last segment of a windows path', () => {
    expect(baseName('C:\\Users\\me\\file.ts')).toBe('file.ts');
  });

  it('ignores trailing slashes', () => {
    expect(baseName('/Users/me/project/')).toBe('project');
  });

  it('returns the input for an empty string', () => {
    expect(baseName('')).toBe('');
  });
});

describe('folderToPath', () => {
  it('converts a serve-web windows uri to a real os path', () => {
    expect(folderToPath('/C:/Users/me/project')).toBe('C:\\Users\\me\\project');
  });

  it('leaves a posix path untouched', () => {
    expect(folderToPath('/Users/me/project')).toBe('/Users/me/project');
  });

  it('handles an empty input', () => {
    expect(folderToPath('')).toBe('');
  });
});

describe('samePath', () => {
  it('matches identical paths', () => {
    expect(samePath('/a/b/c', '/a/b/c')).toBe(true);
  });

  it('matches when one path is a suffix of the other', () => {
    expect(samePath('/repo/src/a.ts', 'src/a.ts')).toBe(true);
  });

  it('does not match unrelated paths', () => {
    expect(samePath('/repo/src/a.ts', '/repo/src/b.ts')).toBe(false);
  });

  it('returns false when either path is missing', () => {
    expect(samePath(undefined, '/a')).toBe(false);
    expect(samePath('/a', undefined)).toBe(false);
  });
});
