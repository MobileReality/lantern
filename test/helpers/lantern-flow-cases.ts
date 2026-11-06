const TEXT_MAX = 80;
const STORIES_MAX = 5;
const STEPS_MAX = 6;
const tooLong = 'x'.repeat(TEXT_MAX + 1);

const FLOW_STORY = [
  '#story Admin lets a user refund orders',
  '#step actor Admin',
  '#step action changes permissions of',
  '#step subject another user',
  '#below actor Another user',
  '#below interaction can now refund orders',
  '#below consequence could only view orders => can refund orders',
];

const FLOW_STORY_VALUE = {
  title: 'Admin lets a user refund orders',
  steps: [
    { kind: 'actor', text: 'Admin' },
    { kind: 'action', text: 'changes permissions of' },
    { kind: 'subject', text: 'another user' },
  ],
  below: [
    { kind: 'actor', text: 'Another user' },
    { kind: 'interaction', text: 'can now refund orders' },
    { kind: 'consequence', old: 'could only view orders', new: 'can refund orders' },
  ],
};

const REJECTED_FLOWS: [string, string[], RegExp][] = [
  ['an unknown kind', ['#story s', '#step person Admin'], /unknown kind "person"/],
  ['a step with no kind', ['#story s', '#step'], /must be "<kind> <text>"/],
  ['a step with no text', ['#story s', '#step actor'], /the actor text is empty/],
  ['a story with no title', ['#story', '#step actor A'], /the story title is empty/],
  ['an over-long title', [`#story ${tooLong}`, '#step actor A'], /the story title is 81 characters/],
  ['an over-long text', ['#story s', `#step action ${tooLong}`], /the action text is 81 characters/],
  ['an over-long old text', ['#story s', `#step consequence ${tooLong} => new`], /the old text is 81 characters/],
  ['an over-long new text', ['#story s', `#step consequence old => ${tooLong}`], /the new text is 81 characters/],
  ['a control character', ['#story s', '#step actor Ad\u0007min'], /control character/],
  ['a consequence with no arrow', ['#story s', '#step consequence only one text'], /a consequence is "<old text> => <new text>"/],
  ['a consequence with an empty old text', ['#story s', '#step consequence  => new'], /a consequence is/],
  ['a consequence with an empty new text', ['#story s', '#step consequence old => '], /a consequence is|the new text is empty/],
  ['a step before any story', ['#step actor A'], /#step before any #story/],
  ['a row below before any story', ['#below actor A'], /#below before any #story/],
  ['a step after the row below', ['#story s', '#step actor A', '#below actor B', '#step action x'], /#step after #below/],
  ['a story with no step', ['#story s', '#below actor A'], /story "s" has no #step/],
  ['six stories', Array.from({ length: STORIES_MAX + 1 }, (_, i) => [`#story s${i}`, '#step actor a']).flat(), /more than 5 stories/],
  ['seven steps in a row', ['#story s', ...Array.from({ length: STEPS_MAX + 1 }, () => '#step actor a')], /more than 6 #step lines/],
  ['seven steps below', ['#story s', '#step actor a', ...Array.from({ length: STEPS_MAX + 1 }, () => '#below actor a')], /more than 6 #below lines/],
];

const FILES_MAX = 6;
const REF_PATHS = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts', 'src/g.ts'];
const REF_FILE_LINES = REF_PATHS.map((file) => `+ ${file}`);
const refLines = (...files: string[]) => files.map((file) => `#file ${file}`);

const REF_STORY = [
  '#story Admin lets a user refund orders',
  '#step actor Admin',
  ...refLines('src/a.ts', 'src/b.ts'),
  '#step action changes permissions of',
  '#below consequence could only view orders => can refund orders',
  ...refLines('src/a.ts'),
];

const REF_STORY_VALUE = {
  title: 'Admin lets a user refund orders',
  steps: [
    { kind: 'actor', text: 'Admin', files: ['src/a.ts', 'src/b.ts'] },
    { kind: 'action', text: 'changes permissions of' },
  ],
  below: [{ kind: 'consequence', old: 'could only view orders', new: 'can refund orders', files: ['src/a.ts'] }],
};

const REJECTED_REFERENCES: [string, string[], RegExp][] = [
  ['a file the record does not list', ['#story s', '#step actor A', '#file src/zzz.ts'], /#file names src\/zzz\.ts, which is not a file line of this record/],
  ['the same file twice on one step', ['#story s', '#step actor A', ...refLines('src/a.ts', 'src/a.ts')], /#file names src\/a\.ts twice on one step/],
  ['seven files on one step', ['#story s', '#step actor A', ...refLines(...REF_PATHS)], /#file has more than 6 files on one step/],
  ['seven files on one row-below step', ['#story s', '#step actor A', '#below actor B', ...refLines(...REF_PATHS)], /more than 6 files on one step/],
  ['a file with no path', ['#story s', '#step actor A', '#file'], /#file must be "#file <path>"/],
  ['a file with two paths', ['#story s', '#step actor A', '#file src/a.ts src/b.ts'], /#file takes one path/],
  ['a file before any story', ['#file src/a.ts'], /#file before any #story/],
  ['a file after the story title but before a step', ['#story s', '#file src/a.ts', '#step actor A'], /#file before any #step/],
];

export { FILES_MAX, FLOW_STORY, FLOW_STORY_VALUE, REF_FILE_LINES, REF_PATHS, REF_STORY, REF_STORY_VALUE, REJECTED_FLOWS, REJECTED_REFERENCES, STEPS_MAX, STORIES_MAX, TEXT_MAX, refLines };
