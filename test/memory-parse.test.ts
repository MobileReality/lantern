import { describe, expect, it } from 'vitest';
import { parseEtime, parseLsofCwd, parseMemoryPressure, parsePsAged, parseTopFootprint } from '../src/main/memory-parse';
import { fixture } from './helpers/memory-fixtures';

const MB = 1024 ** 2;

describe('parseEtime', () => {
  it.each([
    ['00:07', 7],
    ['09:26', 566],
    ['12:30:05', 12 * 3600 + 30 * 60 + 5],
    ['3-22:48:27', 3 * 86400 + 22 * 3600 + 48 * 60 + 27],
    ['03-22:48:27', 3 * 86400 + 22 * 3600 + 48 * 60 + 27],
    ['1-00:00:00', 86400],
  ])('reads %s as %i seconds', (etime, seconds) => {
    expect(parseEtime(etime)).toBe(seconds);
  });

  it('reads an unrecognised age as zero instead of guessing', () => {
    expect(parseEtime('-')).toBe(0);
    expect(parseEtime('')).toBe(0);
  });
});

describe('parsePsAged', () => {
  const rows = parsePsAged(fixture('ps-aged.txt'));
  const byPid = new Map(rows.map((row) => [row.pid, row]));

  it('reads pid, parent, age, state and the whole command', () => {
    expect(byPid.get(4021)).toMatchObject({ ppid: 4020, ageSeconds: 86400 + 2 * 3600, stat: 'S' });
    expect(byPid.get(4021)?.command).toContain('--resume=7e166f5d');
    expect(byPid.get(4001)?.command).toContain('Lantern Helper (GPU)');
  });

  it('keeps zombies and short ages', () => {
    expect(byPid.get(4033)).toMatchObject({ stat: 'Z', ageSeconds: 5 });
    expect(byPid.get(4051)?.ageSeconds).toBe(3);
  });

  it('skips lines that are not process rows', () => {
    expect(parsePsAged('\n  PID PPID\nnot a row\n')).toEqual([]);
  });
});

describe('parseTopFootprint', () => {
  const bytes = parseTopFootprint(fixture('top-footprint.txt'));

  it('reads K, M and G units as powers of 1024', () => {
    expect(bytes.get(4010)).toBe(3744 * 1024);
    expect(bytes.get(4003)).toBe(462 * MB);
    expect(bytes.get(4020)).toBe(Math.round(1.5 * 1024 ** 3));
  });

  it('ignores the trailing + and - markers', () => {
    expect(bytes.get(4001)).toBe(359 * MB);
    expect(bytes.get(4002)).toBe(13 * MB);
    expect(bytes.get(4022)).toBe(2423 * MB);
  });

  it('reads bare bytes and zero', () => {
    expect(bytes.get(4051)).toBe(0);
    expect(parseTopFootprint('PID MEM\n77 512B\n').get(77)).toBe(512);
  });

  it('does not mistake the summary header for process rows', () => {
    expect(bytes.size).toBe(22);
    expect([...bytes.keys()].every((pid) => pid >= 4000)).toBe(true);
  });

  it('returns nothing for empty output', () => {
    expect(parseTopFootprint('').size).toBe(0);
  });
});

describe('parseLsofCwd', () => {
  const cwds = parseLsofCwd(fixture('lsof-cwd.txt'));

  it('maps each pid to its working directory', () => {
    expect(cwds.get(4021)).toBe('/Users/dev/GIT/webapp');
    expect(cwds.get(4020)).toBe('/');
    expect(cwds.get(4030)).toBe('/Users/dev/GIT/webapp/.claude/worktrees/agent-9f2');
  });

  it('returns nothing for empty output', () => {
    expect(parseLsofCwd('').size).toBe(0);
  });
});

describe('parseMemoryPressure', () => {
  it('reads installed memory and the free percentage', () => {
    expect(parseMemoryPressure(fixture('memory-pressure.txt'))).toEqual({ installedBytes: 25769803776, freePercent: 43 });
  });

  it('reports unknown values as null', () => {
    expect(parseMemoryPressure('')).toEqual({ installedBytes: null, freePercent: null });
  });
});
