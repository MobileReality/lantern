import { FLAT_INK, FLAT_LINE, MACRO_STYLE_CLASSES } from './lanternmacrostyles';
import type { MacroStyle } from './lanternmacrostyles';

type LegendWhen = 'always' | 'selection' | 'block' | 'links' | 'uses' | 'pr' | 'reading' | 'flow' | 'pending' | 'systems' | 'system';

type Swatch =
  | { kind: 'shape'; shape: 'area' | 'feature'; classes: readonly string[] }
  | { kind: 'ribbon'; classes: readonly string[]; width: number }
  | { kind: 'pill'; classes: readonly string[]; text: string }
  | { kind: 'chip' }
  | { kind: 'line'; ink: string; width: number; opacity: number }
  | { kind: 'frame'; ink: string; width: number };

interface LegendEntry {
  id: string;
  swatch: Swatch;
  text: string;
  when: LegendWhen;
  covers: readonly MacroStyle[];
}

type LegendKind = 'areas' | 'flat';

const MIN_PLACEHOLDER = '{min}';
const MAIN_RIBBON_WIDTH = 2.4;

const shapeOf = (style: MacroStyle, shape: 'area' | 'feature' = 'feature'): Swatch => ({ kind: 'shape', shape, classes: [MACRO_STYLE_CLASSES[style]] });

const AREAS_LEGEND: readonly LegendEntry[] = [
  { id: 'main', swatch: { kind: 'ribbon', classes: [MACRO_STYLE_CLASSES.main], width: MAIN_RIBBON_WIDTH }, text: 'Main link, thicker for more relations', when: 'always', covers: ['main'] },
  { id: 'selected', swatch: shapeOf('selected'), text: 'Selected', when: 'selection', covers: ['selected', 'picked'] },
  { id: 'related', swatch: shapeOf('related'), text: 'Works with the selection', when: 'selection', covers: ['related', 'linked'] },
  { id: 'hot', swatch: { kind: 'ribbon', classes: [MACRO_STYLE_CLASSES.hot], width: MAIN_RIBBON_WIDTH }, text: 'Links of the selection', when: 'links', covers: ['hot'] },
  { id: 'uses', swatch: shapeOf('uses'), text: 'Reached through relations only', when: 'uses', covers: ['uses'] },
  { id: 'dim', swatch: shapeOf('dim'), text: 'Not linked to it', when: 'selection', covers: ['dim'] },
  { id: 'lit', swatch: shapeOf('lit'), text: 'Changed in the pull request', when: 'pr', covers: ['lit', 'changed', 'tally'] },
  { id: 'reading', swatch: shapeOf('reading'), text: 'Open in the review pane (READING)', when: 'reading', covers: ['reading', 'mark'] },
  { id: 'flow', swatch: shapeOf('flow'), text: 'In the picked Flow step (STEP)', when: 'flow', covers: ['flow'] },
  { id: 'pending', swatch: shapeOf('pending', 'area'), text: 'Features not in an area yet', when: 'pending', covers: ['pending'] },
  { id: 'system', swatch: { kind: 'chip' }, text: 'Outside system, listed under the map', when: 'systems', covers: ['system'] },
  { id: 'count', swatch: { kind: 'pill', classes: [MACRO_STYLE_CLASSES.count], text: '4×' }, text: 'Relations with the picked system', when: 'system', covers: ['count'] },
];

const FLAT_LEGEND: readonly LegendEntry[] = [
  { id: 'strong', swatch: { kind: 'line', ink: FLAT_INK.ink, width: FLAT_LINE.strongWidth, opacity: 1 }, text: `Strong link, ${MIN_PLACEHOLDER}+ relations`, when: 'always', covers: [] },
  { id: 'weak', swatch: { kind: 'line', ink: FLAT_INK.quiet, width: FLAT_LINE.weakWidth, opacity: FLAT_LINE.weakAlpha }, text: `Weaker link, fewer than ${MIN_PLACEHOLDER}`, when: 'always', covers: [] },
  { id: 'leaves', swatch: { kind: 'line', ink: FLAT_INK.leaves, width: FLAT_LINE.pickedWidth, opacity: 1 }, text: 'Leaves the selected block', when: 'block', covers: [] },
  { id: 'arrives', swatch: { kind: 'line', ink: FLAT_INK.arrives, width: FLAT_LINE.pickedWidth, opacity: 1 }, text: 'Arrives at the selected block', when: 'block', covers: [] },
  { id: 'lit', swatch: { kind: 'frame', ink: FLAT_INK.glow, width: FLAT_LINE.litFrameWidth }, text: 'Changed in the pull request', when: 'pr', covers: [] },
  { id: 'reading', swatch: { kind: 'frame', ink: FLAT_INK.read, width: FLAT_LINE.readingFrameWidth }, text: 'Open in the review pane (READING)', when: 'reading', covers: [] },
  { id: 'system', swatch: { kind: 'frame', ink: FLAT_INK.rule, width: FLAT_LINE.restFrameWidth }, text: 'Outside system', when: 'systems', covers: [] },
];

const AREAS_HELP: readonly string[] = ['Click selects, click again clears.', 'Double-click or Enter opens, Esc steps back.'];
const FLAT_HELP: readonly string[] = ['Click a block to follow its links, click again to clear.', 'The number on a line counts its relations.'];

const LEGENDS: Record<LegendKind, readonly LegendEntry[]> = { areas: AREAS_LEGEND, flat: FLAT_LEGEND };
const HELP: Record<LegendKind, readonly string[]> = { areas: AREAS_HELP, flat: FLAT_HELP };

function legendEntries(kind: LegendKind, holds: ReadonlySet<LegendWhen>): LegendEntry[] {
  return LEGENDS[kind].filter((entry) => entry.when === 'always' || holds.has(entry.when));
}

function legendText(entry: LegendEntry, minStrongEdge: number) {
  return entry.text.replace(MIN_PLACEHOLDER, String(minStrongEdge));
}

export { FLAT_HELP, FLAT_LEGEND, HELP, AREAS_HELP, AREAS_LEGEND, legendEntries, legendText };
export type { LegendEntry, LegendKind, LegendWhen, Swatch };
