const GUIDE_FILE_LINES = ['+ src/a.ts', '~ src/b.ts', '+ docs/my%20notes%231.md'];

const sentence = (length: number) => 'x'.repeat(length);
const steps = (count: number) => Array.from({ length: count }, (_, i) => [`#gstep skim s${i}`, '#gwhy Why.', '#ghunk src/a.ts']).flat();
const OPENING = ['#guide Adds a limit.', '#risk low Small change.'];
const STEP = ['#gstep careful Core', '#gwhy It carries the idea.', '#ghunk src/a.ts'];

const GUIDE_LINES = [
  '#guide Adds a limit to refunds.',
  '#risk medium Touches the refund path.',
  '#gstep careful Refund limit',
  '#gwhy The limit is checked first. Everything else reads it.',
  '#ghunk src/a.ts +10-20',
  '#ghunk src/a.ts -3',
  '#gpseudo if amount > limit: refuse',
  '#gpseudo else: continue',
  '#gstep skim Callers and docs',
  '#gwhy Follow-on edits.',
  '#ghunk src/b.ts',
  '#ghunk docs/my%20notes%231.md +1',
];

const GUIDE_VALUE = {
  summary: 'Adds a limit to refunds.',
  risk: { level: 'medium', why: 'Touches the refund path.' },
  steps: [
    {
      title: 'Refund limit',
      why: 'The limit is checked first. Everything else reads it.',
      careful: true,
      hunks: [{ path: 'src/a.ts', side: 'new', start: 10, end: 20 }, { path: 'src/a.ts', side: 'old', start: 3, end: 3 }],
    },
    {
      title: 'Callers and docs',
      why: 'Follow-on edits.',
      careful: false,
      hunks: [{ path: 'src/b.ts' }, { path: 'docs/my notes#1.md', side: 'new', start: 1, end: 1 }],
    },
  ],
};

const REJECTED_GUIDES: [string, string[], RegExp][] = [
  ['a guide with no summary', ['#risk low w', ...STEP], /a guide needs a #guide summary line/],
  ['a guide with no risk', ['#guide s', ...STEP], /a guide needs a #risk line/],
  ['a guide with no step', [...OPENING], /a guide needs at least one #gstep/],
  ['a repeated summary', [...OPENING, '#guide again', ...STEP], /#guide appears more than once/],
  ['a repeated risk', [...OPENING, '#risk high again', ...STEP], /#risk appears more than once/],
  ['an empty summary', ['#guide', '#risk low w', ...STEP], /#guide the summary is empty/],
  ['an over-long summary', [`#guide ${sentence(161)}`, '#risk low w', ...STEP], /the summary is 161 characters, the cap is 160/],
  ['a summary with a control character', ['#guide a\u0007b', '#risk low w', ...STEP], /control character/],
  ['an unknown risk level', ['#guide s', '#risk severe w', ...STEP], /level must be one of low, medium, high, got "severe"/],
  ['a risk with no why', ['#guide s', '#risk low', ...STEP], /the risk why is empty/],
  ['an over-long risk why', ['#guide s', `#risk low ${sentence(161)}`, ...STEP], /the risk why is 161 characters/],
  ['an unknown step mode', [...OPENING, '#gstep read t', '#gwhy w', '#ghunk src/a.ts'], /got mode "read"/],
  ['a step with no title', [...OPENING, '#gstep careful', '#gwhy w', '#ghunk src/a.ts'], /the title is empty/],
  ['an over-long title', [...OPENING, `#gstep careful ${sentence(61)}`, '#gwhy w', '#ghunk src/a.ts'], /the title is 61 characters, the cap is 60/],
  ['nine steps', [...OPENING, ...steps(9)], /more than 8 steps/],
  ['a why before any step', [...OPENING, '#gwhy w', ...STEP], /#gwhy before any #gstep/],
  ['a hunk before any step', [...OPENING, '#ghunk src/a.ts', ...STEP], /#ghunk before any #gstep/],
  ['a step with no why', [...OPENING, '#gstep skim t', '#ghunk src/a.ts'], /step "t" has no #gwhy line/],
  ['a step with no hunk', [...OPENING, '#gstep skim t', '#gwhy w'], /step "t" has no #ghunk line/],
  ['a repeated why', [...OPENING, ...STEP, '#gwhy second'], /#gwhy appears more than once in step "Core"/],
  ['an over-long why', [...OPENING, '#gstep skim t', `#gwhy ${sentence(241)}`, '#ghunk src/a.ts'], /the why is 241 characters, the cap is 240/],
  ['a why of three sentences', [...OPENING, '#gstep skim t', '#gwhy One. Two. Three.', '#ghunk src/a.ts'], /the why is 3 sentences, the cap is 2/],
  ['a hunk the record does not list', [...OPENING, ...STEP, '#ghunk src/zzz.ts'], /#ghunk names src\/zzz\.ts, which is not a file line of this record/],
  ['a hunk with no path', [...OPENING, ...STEP, '#ghunk'], /#ghunk must be "#ghunk <path>"/],
  ['a hunk with two ranges', [...OPENING, ...STEP, '#ghunk src/a.ts +1-2 +3-4'], /#ghunk takes a path and at most one range/],
  ['a malformed range', [...OPENING, ...STEP, '#ghunk src/a.ts 10-20'], /range "10-20" must be/],
  ['a range that starts at zero', [...OPENING, ...STEP, '#ghunk src/a.ts +0-5'], /a line range is whole numbers from line 1/],
  ['a range that ends before it starts', [...OPENING, ...STEP, '#ghunk src/a.ts +9-3'], /the range 9-3 ends before it starts/],
  ['a repeated hunk', [...OPENING, ...STEP, '#ghunk src/a.ts'], /#ghunk repeats a hunk of step "Core"/],
  ['sixty-one hunks on a step', [...OPENING, '#gstep skim t', '#gwhy w', ...Array.from({ length: 61 }, (_, i) => `#ghunk src/a.ts +${i + 1}`)], /more than 60 #ghunk lines/],
];

const LEGACY_PSEUDO_LINES = [
  ...OPENING,
  '#gpseudo before any step',
  ...STEP,
  '#gpseudo',
  `#gpseudo ${sentence(101)}`,
  ...Array.from({ length: 9 }, (_, i) => `#gpseudo line ${i}`),
  '#gstep skim t',
  '#gwhy w',
  '#ghunk src/a.ts +1',
  '#gpseudo on a skim step',
];

const LEGACY_PSEUDO_GUIDE = {
  summary: 'Adds a limit.',
  risk: { level: 'low', why: 'Small change.' },
  steps: [
    { title: 'Core', why: 'It carries the idea.', careful: true, hunks: [{ path: 'src/a.ts' }] },
    { title: 't', why: 'w', careful: false, hunks: [{ path: 'src/a.ts', side: 'new', start: 1, end: 1 }] },
  ],
};

export { GUIDE_FILE_LINES, GUIDE_LINES, GUIDE_VALUE, LEGACY_PSEUDO_GUIDE, LEGACY_PSEUDO_LINES, REJECTED_GUIDES };
