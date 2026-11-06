const MACRO_STYLE_CLASSES = {
  selected: 'is-selected',
  related: 'is-related',
  uses: 'is-uses',
  dim: 'is-dim',
  lit: 'is-lit',
  reading: 'is-reading',
  flow: 'is-flow',
  focus: 'is-focus',
  pending: 'mv-pending',
  changed: 'is-changed',
  picked: 'is-picked',
  linked: 'is-linked',
  main: 'is-main',
  hot: 'is-hot',
  tally: 'mv-tally',
  mark: 'mv-mark',
  count: 'mv-count',
  system: 'mv-system',
} as const;

type MacroStyle = keyof typeof MACRO_STYLE_CLASSES;

const UNLEGENDED_STYLES: readonly MacroStyle[] = ['focus'];

const FLAT_LINE = {
  strongWidth: 3.2,
  weakWidth: 1.2,
  weakAlpha: 0.55,
  markedWidth: 2.8,
  pickedWidth: 2.2,
  litFrameWidth: 1.6,
  readingFrameWidth: 2.5,
  restFrameWidth: 1,
} as const;

const FLAT_INK = {
  ink: 'var(--lt-ink)',
  quiet: 'var(--lt-ink-3)',
  rule: 'var(--lt-rule)',
  glow: 'var(--lt-glow)',
  read: 'var(--lt-k-ref)',
  leaves: 'var(--lt-k-send)',
  arrives: 'var(--lt-k-take)',
} as const;

export { FLAT_INK, FLAT_LINE, UNLEGENDED_STYLES, MACRO_STYLE_CLASSES };
export type { MacroStyle };
