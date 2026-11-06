import { describe, expect, it } from 'vitest';
import type { SetupProgress } from '../src/main/setup-progress';
import { activityOf, deriveRunView, failureNote, formatElapsed, formatEta, phaseOf, resumeLabel } from '../src/renderer/lib/setupprogress';

function progress(extra: Partial<SetupProgress> = {}): SetupProgress {
  return {
    files: { done: 25, total: 63 },
    bytes: { done: 25_000, total: 63_000 },
    chunks: { done: 1, total: 3 },
    next: { id: 2, dir: 'big', files: 25, pending: 25 },
    features: true,
    platforms: false,
    sections: 0,
    ...extra,
  };
}

const NOTHING = progress({ files: { done: 0, total: 63 }, bytes: { done: 0, total: 63_000 }, chunks: { done: 0, total: 3 }, next: { id: 1, dir: 'big', files: 25, pending: 25 }, features: false });

describe('phaseOf', () => {
  it('follows the order the skill leaves things on disk', () => {
    expect(phaseOf(null)).toBe('planning');
    expect(phaseOf(NOTHING)).toBe('planning');
    expect(phaseOf({ ...NOTHING, platforms: true })).toBe('features');
    expect(phaseOf({ ...NOTHING, features: true })).toBe('mapping');
    expect(phaseOf(progress())).toBe('mapping');
    expect(phaseOf(progress({ chunks: { done: 3, total: 3 }, next: null }))).toBe('sections');
    expect(phaseOf(progress({ chunks: { done: 3, total: 3 }, next: null, sections: 2 }))).toBe('finishing');
  });
});

describe('deriveRunView from a fixture plan status', () => {
  it('shows chunk n of m, the directory and the files mapped for a setup', () => {
    const v = deriveRunView({ progress: progress(), baseline: NOTHING, kind: 'lantern', elapsedMs: 30_000 });
    expect(v.chunkText).toBe('chunk 2 of 3');
    expect(v.currentDir).toBe('big');
    expect(v.filesText).toBe('25 of 63 files mapped');
    expect(v.fraction).toBeCloseTo(25 / 63);
    expect([v.chunksDone, v.chunksTotal, v.chunksLeft]).toEqual([1, 3, 2]);
    expect(v.phase).toBe('mapping');
  });

  it('starts a resumed setup partway, since the bar covers the whole project', () => {
    const v = deriveRunView({ progress: progress(), baseline: progress(), kind: 'lantern', elapsedMs: 0 });
    expect(v.fraction).toBeCloseTo(25 / 63);
  });

  it('covers only the files this run had to re-map for a refresh', () => {
    const baseline = progress({ files: { done: 60, total: 63 }, chunks: { done: 2, total: 3 } });
    const now = progress({ files: { done: 62, total: 63 }, chunks: { done: 2, total: 3 } });
    const v = deriveRunView({ progress: now, baseline, kind: 'lantern-refresh', elapsedMs: 0 });
    expect(v.fraction).toBeCloseTo(2 / 3);
    expect(v.filesText).toBe('2 of 3 files re-mapped');
  });

  it('is unknown, not zero, until the first snapshot arrives', () => {
    const v = deriveRunView({ progress: null, baseline: null, kind: 'lantern', elapsedMs: 0 });
    expect(v.known).toBe(false);
    expect(v.chunkText).toBe('');
    expect(v.etaMs).toBeNull();
  });

  it('has no chunk text once every chunk is mapped', () => {
    const done = progress({ files: { done: 63, total: 63 }, chunks: { done: 3, total: 3 }, next: null });
    const v = deriveRunView({ progress: done, baseline: NOTHING, kind: 'lantern', elapsedMs: 0 });
    expect(v.chunkText).toBe('');
    expect(v.fraction).toBe(1);
    expect(v.chunksLeft).toBe(0);
  });
});

describe('remaining estimate', () => {
  const base = progress({ files: { done: 0, total: 100 }, bytes: { done: 0, total: 100_000 }, chunks: { done: 0, total: 4 } });
  const at = (chunks: number, bytes: number, elapsedMs: number) =>
    deriveRunView({ progress: progress({ files: { done: bytes / 1000, total: 100 }, bytes: { done: bytes, total: 100_000 }, chunks: { done: chunks, total: 4 } }), baseline: base, kind: 'lantern', elapsedMs }).etaMs;

  it('is left out until two chunks and two minutes of this run have passed', () => {
    expect(at(0, 0, 600_000)).toBeNull();
    expect(at(1, 25_000, 600_000)).toBeNull();
    expect(at(2, 50_000, 119_000)).toBeNull();
  });

  it('extrapolates this run’s own pace over the bytes still to map', () => {
    expect(at(2, 50_000, 600_000)).toBe(600_000);
    expect(at(3, 75_000, 900_000)).toBe(300_000);
  });

  it('measures a resumed run from where it resumed, not from zero', () => {
    const resumed = progress({ files: { done: 50, total: 100 }, bytes: { done: 50_000, total: 100_000 }, chunks: { done: 2, total: 4 } });
    const now = progress({ files: { done: 75, total: 100 }, bytes: { done: 75_000, total: 100_000 }, chunks: { done: 3, total: 4 } });
    expect(deriveRunView({ progress: now, baseline: resumed, kind: 'lantern', elapsedMs: 300_000 }).etaMs).toBeNull();
    const later = progress({ files: { done: 100, total: 100 }, bytes: { done: 100_000, total: 100_000 }, chunks: { done: 4, total: 4 } });
    expect(deriveRunView({ progress: later, baseline: resumed, kind: 'lantern', elapsedMs: 600_000 }).etaMs).toBe(0);
  });

  it('is left out when no bytes were mapped in this run', () => {
    expect(deriveRunView({ progress: progress(), baseline: progress(), kind: 'lantern', elapsedMs: 600_000 }).etaMs).toBeNull();
  });
});

describe('formatting', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(61_000)).toBe('1:01');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('rounds the remaining estimate and never claims precision', () => {
    expect(formatEta(20_000)).toBe('under a minute');
    expect(formatEta(18 * 60_000)).toBe('about 18 min');
    expect(formatEta(95 * 60_000)).toBe('about 1 h 35 min');
    expect(formatEta(120 * 60_000)).toBe('about 2 h');
  });
});

describe('resumeLabel', () => {
  it('says how many chunks are left', () => {
    expect(resumeLabel(progress({ chunks: { done: 11, total: 42 } }), 'lantern')).toBe('Resume setup (31 of 42 chunks left)');
    expect(resumeLabel(progress({ chunks: { done: 11, total: 42 } }), 'lantern-refresh')).toBe('Resume refresh (31 of 42 chunks left)');
  });

  it('falls back to the final steps, or to a bare label without a snapshot', () => {
    expect(resumeLabel(progress({ chunks: { done: 3, total: 3 }, next: null }), 'lantern')).toBe('Resume setup (final steps left)');
    expect(resumeLabel(null, 'lantern')).toBe('Resume setup');
  });
});

describe('activityOf', () => {
  const root = '/proj';
  it('turns tool calls into one short sentence', () => {
    expect(activityOf('Read', '/proj/src/a.ts', root)).toBe('Reading src/a.ts');
    expect(activityOf('Bash', 'node $L/scripts/plan.mjs . chunk 7', root)).toBe('Reading chunk 7');
    expect(activityOf('Bash', 'node $L/scripts/plan.mjs . pending', root)).toBe('Checking what is left to map');
    expect(activityOf('Bash', 'node $L/scripts/validate.mjs . --settled', root)).toBe('Validating the map');
    expect(activityOf('Write', '/proj/.lantern/map/src/lib.lantern', root)).toBe('Writing the map for src/lib');
    expect(activityOf('Write', '/proj/.lantern/map/.lantern', root)).toBe('Writing the map for .');
    expect(activityOf('Write', '/proj/.lantern/lang/en/src/lib.lantern.json', root)).toBe('Writing the texts');
    expect(activityOf('Write', '/proj/.lantern/sections/rbac.section', root)).toBe('Writing the rbac section');
    expect(activityOf('Write', '/proj/.lantern/features', root)).toBe('Writing the feature list');
    expect(activityOf('Agent', 'map chunk 3', root)).toBe('Handing a chunk to a mapper');
    expect(activityOf('Grep', 'foo', root)).toBe('Searching the project');
    expect(activityOf('TodoWrite', undefined, root)).toBe('TodoWrite');
  });
});

describe('failureNote', () => {
  const kept = 'What was written to .lantern/ is kept, and Resume continues from it.';

  it('separates the error from the kept-work sentence', () => {
    expect(failureNote('Claude CLI not found')).toBe(`Claude CLI not found. ${kept}`);
  });

  it('does not double the final punctuation', () => {
    expect(failureNote('Claude CLI not found. Set LANTERN_CLAUDE_BIN.')).toBe(`Claude CLI not found. Set LANTERN_CLAUDE_BIN. ${kept}`);
  });

  it('falls back to a generic reason', () => {
    expect(failureNote(null)).toBe(`The run failed. ${kept}`);
    expect(failureNote('  ')).toBe(`The run failed. ${kept}`);
  });
});
