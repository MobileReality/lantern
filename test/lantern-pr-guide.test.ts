import { describe, expect, it } from 'vitest';
import {
  GUIDE_MAX_PSEUDO_LINES,
  GUIDE_MAX_STEPS,
  GUIDE_TITLE_MAX,
  GUIDE_WHY_MAX,
  guideCoverage,
  guideFromJson,
  guideRecordLines,
  parseGuideLines,
} from '../skills/lantern-setup/scripts/prguide.mjs';
import { parseBranchRecord, parsePr } from '../skills/lantern-setup/scripts/prs.mjs';

const HEAD = '3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c';
const RECORD = ['lantern-pr 1', '# 7', '#title t', '#url https://x.test/7', '#branch b', '#base main', '#opened 2026-09-30', `#head ${HEAD}`, '+ src/a.ts', '+ src/my%20file.ts', '- src/old.ts'];

const GUIDE = {
  summary: 'Adds a guide to the pull request record',
  risk: { level: 'medium', why: 'The record grammar grows' },
  steps: [
    {
      title: 'Guide model',
      why: 'The types come first. Everything else reads them.',
      careful: true,
      hunks: [{ path: 'src/a.ts', side: 'new', start: 1, end: 20 }, { path: 'src/old.ts' }],
      pseudo: ['for each step', 'check every hunk is owned once'],
    },
    {
      title: 'Callers',
      why: 'Wiring only.',
      careful: false,
      hunks: [{ path: 'src/a.ts', side: 'old', start: 30, end: 30 }, { path: 'src/my file.ts' }],
    },
  ],
};

const hunk = (path: string, oldStart: number, oldCount: number, newStart: number, newCount: number) => ({ path, oldStart, oldCount, newStart, newCount });

function asLines(lines: string[]) {
  return lines.map((line, index) => {
    const cut = line.search(/\s/);
    return { tag: line.slice(1, cut === -1 ? undefined : cut), raw: cut === -1 ? '' : line.slice(cut).trim(), where: `line ${index + 1}` };
  });
}

function parseRecord(...guideLines: string[]) {
  return parsePr(`${[...RECORD, ...guideLines].join('\n')}\n`, '7.pr');
}

describe('a guide round trip', () => {
  it('goes JSON -> record lines -> parsed guide unchanged', () => {
    const made = guideFromJson(GUIDE);
    expect(made.errors).toEqual([]);
    const lines = guideRecordLines(made.guide);
    expect(lines).toContain('#ghunk src/a.ts +1-20');
    expect(lines).toContain('#ghunk src/a.ts -30');
    expect(lines).toContain('#ghunk src/my%20file.ts');
    const parsed = parseGuideLines(asLines(lines));
    expect(parsed.errors).toEqual([]);
    expect(parsed.guide).toEqual(GUIDE);
  });

  it('round trips through a pr record and a branch record', () => {
    const lines = guideRecordLines(guideFromJson(GUIDE).guide);
    const pr = parseRecord(...lines);
    expect(pr.errors).toEqual([]);
    expect(pr.guide).toEqual(GUIDE);
    const branch = parseBranchRecord(`${['lantern-branch 1', '#branch b', '#base main', '#opened 2026-09-30', `#head ${HEAD}`, '+ src/a.ts', '+ src/my%20file.ts', '- src/old.ts', ...lines].join('\n')}\n`, 'b.branch');
    expect(branch.errors).toEqual([]);
    expect(branch.guide).toEqual(GUIDE);
  });

  it('keeps a record with no guide valid, with guide null', () => {
    const pr = parseRecord();
    expect(pr.errors).toEqual([]);
    expect(pr.guide).toBeNull();
  });
});

describe('guideFromJson limits', () => {
  const withStep = (patch: object) => ({ ...GUIDE, steps: [{ ...GUIDE.steps[0], ...patch }] });

  it('rejects an over-long why, by characters and by sentences', () => {
    expect(guideFromJson(withStep({ why: 'x'.repeat(GUIDE_WHY_MAX + 1) })).errors[0]).toMatch(/the why is \d+ characters/);
    expect(guideFromJson(withStep({ why: 'One. Two. Three.' })).errors[0]).toMatch(/3 sentences/);
    expect(guideFromJson(withStep({ why: 'x'.repeat(GUIDE_WHY_MAX) })).errors).toEqual([]);
  });

  it('rejects pseudocode on a skim step and too many pseudocode lines', () => {
    expect(guideFromJson(withStep({ careful: false })).errors[0]).toMatch(/only on a careful step/);
    expect(guideFromJson(withStep({ pseudo: Array.from({ length: GUIDE_MAX_PSEUDO_LINES + 1 }, () => 'x') })).errors[0]).toMatch(/more than 8 #gpseudo/);
  });

  it('rejects too many steps, a long title, no hunks, a bad risk and a backwards range', () => {
    const many = { ...GUIDE, steps: Array.from({ length: GUIDE_MAX_STEPS + 1 }, (_, i) => ({ ...GUIDE.steps[1], title: `s${i}` })) };
    expect(guideFromJson(many).errors.join('\n')).toMatch(/more than 8 steps/);
    expect(guideFromJson(withStep({ title: 't'.repeat(GUIDE_TITLE_MAX + 1) })).errors[0]).toMatch(/the title is/);
    expect(guideFromJson(withStep({ hunks: [] })).errors[0]).toMatch(/no #ghunk/);
    expect(guideFromJson({ ...GUIDE, risk: { level: 'severe', why: 'x' } }).errors[0]).toMatch(/level must be/);
    expect(guideFromJson(withStep({ hunks: [{ path: 'a', side: 'new', start: 5, end: 2 }] })).errors[0]).toMatch(/ends before it starts/);
    expect(guideFromJson({ summary: 'x' }).errors.length).toBeGreaterThan(0);
  });

  it('checks the hunk paths against the listed files when given', () => {
    expect(guideFromJson(GUIDE, new Set(['src/a.ts', 'src/my file.ts', 'src/old.ts'])).errors).toEqual([]);
    expect(guideFromJson(GUIDE, new Set(['src/a.ts'])).errors[0]).toMatch(/not a file line of this record/);
  });
});

describe('a malformed guide in a record is an error, as a malformed flow is', () => {
  const ok = guideRecordLines(guideFromJson(GUIDE).guide);
  const cases: Array<[string, string[], RegExp]> = [
    ['a step with no why', ['#guide s', '#risk low fine', '#gstep skim t', '#ghunk src/a.ts'], /no #gwhy/],
    ['a step with no hunk', ['#guide s', '#risk low fine', '#gstep skim t', '#gwhy ok.'], /no #ghunk/],
    ['a hunk before any step', ['#guide s', '#risk low fine', '#ghunk src/a.ts'], /before any #gstep/],
    ['a missing risk', ['#guide s', '#gstep skim t', '#gwhy ok.', '#ghunk src/a.ts'], /needs a #risk/],
    ['a repeated summary', ['#guide s', '#guide t', '#risk low fine', '#gstep skim t', '#gwhy ok.', '#ghunk src/a.ts'], /appears more than once/],
    ['an unknown mode', ['#guide s', '#risk low fine', '#gstep loud t', '#gwhy ok.', '#ghunk src/a.ts'], /mode "loud"/],
    ['a path the record does not list', ['#guide s', '#risk low fine', '#gstep skim t', '#gwhy ok.', '#ghunk src/zzz.ts'], /not a file line/],
    ['a bad range', ['#guide s', '#risk low fine', '#gstep skim t', '#gwhy ok.', '#ghunk src/a.ts 3-4'], /range "3-4"/],
    ['a long why', ['#guide s', '#risk low fine', '#gstep skim t', `#gwhy ${'x'.repeat(GUIDE_WHY_MAX + 1)}`, '#ghunk src/a.ts'], /#gwhy the why is/],
  ];
  for (const [name, lines, message] of cases) {
    it(`rejects ${name}`, () => {
      const pr = parseRecord(...lines);
      expect(pr.errors.join('\n')).toMatch(message);
      expect(pr.guide).toBeNull();
    });
  }

  it('accepts the valid lines the cases were cut from', () => {
    expect(parseRecord(...ok).errors).toEqual([]);
  });
});

describe('guideCoverage', () => {
  const hunks = [hunk('src/a.ts', 0, 0, 1, 20), hunk('src/a.ts', 30, 1, 29, 0), hunk('src/old.ts', 1, 9, 0, 0), hunk('src/my file.ts', 0, 0, 1, 3)];
  const guide = guideFromJson(GUIDE).guide;

  it('passes when every hunk is in exactly one step, including a deleted file and a deletion-only hunk', () => {
    expect(guideCoverage(hunks, guide)).toEqual({ missed: [], doubled: [], unknown: [], ok: true });
  });

  it('reports a missed hunk', () => {
    const extra = hunk('src/b.ts', 0, 0, 1, 2);
    const report = guideCoverage([...hunks, extra], guide);
    expect(report.missed).toEqual([extra]);
    expect(report.ok).toBe(false);
  });

  it('reports a doubled hunk with the steps that own it', () => {
    const twice = { ...guide, steps: [guide.steps[0], { ...guide.steps[1], hunks: [...guide.steps[1].hunks, { path: 'src/a.ts', side: 'new', start: 10, end: 12 }] }] };
    const report = guideCoverage(hunks, twice);
    expect(report.doubled).toEqual([{ hunk: hunks[0], steps: [0, 1] }]);
    expect(report.ok).toBe(false);
  });

  it('counts a whole-file reference as covering every hunk of the file, and a no-line change only by it', () => {
    const rename = hunk('img.png', 0, 0, 0, 0);
    const whole = { ...guide, steps: [{ ...guide.steps[0], hunks: [{ path: 'src/a.ts' }, { path: 'src/old.ts' }, { path: 'img.png' }] }, guide.steps[1]] };
    const report = guideCoverage([...hunks, rename], whole);
    expect(report.missed).toEqual([]);
    expect(report.doubled.map((d: { hunk: unknown }) => d.hunk)).toEqual([hunks[1]]);
    const ranged = { ...guide, steps: [{ ...guide.steps[0], hunks: [...guide.steps[0].hunks, { path: 'img.png', side: 'new', start: 1, end: 5 }] }, guide.steps[1]] };
    expect(guideCoverage([...hunks, rename], ranged).missed).toEqual([rename]);
  });

  it('names a reference that matches no hunk of the change', () => {
    const stray = { path: 'src/gone.ts' };
    const report = guideCoverage(hunks, { ...guide, steps: [{ ...guide.steps[0], hunks: [...guide.steps[0].hunks, stray] }, guide.steps[1]] });
    expect(report.unknown).toEqual([{ step: 0, ref: stray }]);
    expect(report.ok).toBe(false);
  });
});
