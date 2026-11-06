import { VIEW, say } from '../../../shared/lantern-plan-messages';
import { plural } from '../lanternmacro';
import { MACRO_STYLE_CLASSES } from '../lanternmacrostyles';
import type { AreaNodes, EntryNodes, FeatureNodes, Item, Scene } from './build';
import type { Related } from './focus';
import type { Tally, MacroViewMarks } from './marks';
import { tallyText } from './marks';
import type { MacroViewModel } from './model';
import { setAttr, setFlag } from './svg';

interface StateInput {
  scene: Scene;
  model: MacroViewModel;
  marks: MacroViewMarks;
  selection: string | null;
  related: Related;
  focusKey: string | null;
  systemName: string | null;
}

interface Flags {
  selected: boolean;
  related: boolean;
  uses: boolean;
  dim: boolean;
  lit: boolean;
  reading: boolean;
  flow: boolean;
  focus: boolean;
}

interface Presence {
  lit: boolean;
  home: boolean;
  current: boolean;
  flow: boolean;
}

const ABSENT: Presence = { lit: false, home: false, current: false, flow: false };

function flagsOf(item: Item, input: StateInput, here: Presence, parentDim = false): Flags {
  const { selection, related, marks } = input;
  const selected = item.key === selection;
  const partner = !selected && related.keys.has(item.key);
  const uses = !selected && !partner && related.uses.has(item.key);
  const calm = !selection && (!!marks.flow || !!marks.reading.file || !!marks.plan);
  const dim = !parentDim && (selection ? !selected && !partner && !uses : calm && !here.current && !here.flow);
  return { selected, related: partner, uses, dim, lit: here.lit, reading: here.home, flow: here.flow, focus: item.key === input.focusKey };
}

function paintFlags(item: Item, flags: Flags) {
  setFlag(item.g, MACRO_STYLE_CLASSES.selected, flags.selected);
  setFlag(item.g, MACRO_STYLE_CLASSES.related, flags.related);
  setFlag(item.g, MACRO_STYLE_CLASSES.uses, flags.uses);
  setFlag(item.g, MACRO_STYLE_CLASSES.dim, flags.dim);
  setFlag(item.g, MACRO_STYLE_CLASSES.lit, flags.lit);
  setFlag(item.g, MACRO_STYLE_CLASSES.reading, flags.reading);
  setFlag(item.g, MACRO_STYLE_CLASSES.flow, flags.flow);
  setFlag(item.g, MACRO_STYLE_CLASSES.focus, flags.focus);
  setAttr(item.g, 'aria-pressed', String(flags.selected));
}

function noteOf(tally: Tally | undefined, reading: boolean, flow: boolean, uses = '', plan = '') {
  return [uses, tally ? `${tallyText(tally)} files changed in the pull request` : '', reading ? 'being read' : '', flow ? 'in the picked Flow step' : '', plan].filter(Boolean).join(', ');
}

const planNote = (marks: StateInput['marks'], named: boolean) => (marks.plan && named ? say(VIEW.NOTE_PLAN, { label: marks.plan.label }) : '');

function usesNote(input: StateInput, key: string) {
  const count = input.related.counts.get(key);
  return count && input.systemName ? `${plural(count, 'relation')} with ${input.systemName}` : '';
}

function areaLabel(area: AreaNodes, tally: Tally | undefined, flags: Flags, uses: string, plan: string) {
  const { model } = area;
  const lead = `${model.name}, ${model.pending ? 'features not in an area yet' : 'area'}, ${plural(model.features.length, 'feature')}, ${plural(model.files, 'file')}`;
  return [lead, model.purpose, noteOf(tally, flags.reading, flags.flow, uses, plan)].filter(Boolean).join('. ');
}

function featureLabel(feature: FeatureNodes, tally: Tally | undefined, flags: Flags, uses: string, plan: string) {
  const { model } = feature;
  return [`${model.name}, feature, ${plural(model.files, 'file')}`, model.purpose, noteOf(tally, flags.reading, flags.flow, uses, plan)].filter(Boolean).join('. ');
}

function applyArea(area: AreaNodes, input: StateInput) {
  const { marks } = input;
  const tally = marks.areas.get(area.id);
  const planned = !!marks.plan?.areas.has(area.id);
  const flags = flagsOf(area, input, { lit: !!tally || planned, home: marks.home.areas.has(area.id), current: marks.reading.areas.has(area.id) || planned, flow: !!marks.flow?.areas.has(area.id) });
  paintFlags(area, flags);
  setAttr(area.g, 'aria-label', areaLabel(area, tally, flags, usesNote(input, area.key), planNote(marks, planned)));
  for (const feature of area.features) {
    const own = marks.features.get(feature.id);
    const plannedFeature = !!marks.plan?.features.has(feature.id);
    const featureFlags = flagsOf(feature, input, { lit: !!own || plannedFeature, home: marks.home.features.has(feature.id), current: marks.reading.features.has(feature.id) || plannedFeature, flow: !!marks.flow?.features.has(feature.id) }, flags.dim);
    paintFlags(feature, featureFlags);
    setAttr(feature.g, 'aria-label', featureLabel(feature, own, featureFlags, usesNote(input, feature.key), planNote(marks, plannedFeature)));
  }
}

function applyEntry(entry: EntryNodes, input: StateInput) {
  const { marks } = input;
  const tally = marks.foundation.get(entry.id);
  const reading = marks.reading.foundation.has(entry.id);
  const planned = !!marks.plan?.foundation.has(entry.id);
  const flags = flagsOf(entry, input, { lit: !!tally || planned, home: reading, current: reading || planned, flow: false });
  paintFlags(entry, flags);
  setAttr(entry.g, 'aria-label', [`${entry.g.getAttribute('data-name') ?? entry.id}, shared foundation entry`, noteOf(tally, flags.reading, false, usesNote(input, entry.key), planNote(marks, planned))].filter(Boolean).join('. '));
}

function applyState(input: StateInput) {
  const { scene } = input;
  for (const area of scene.areas) applyArea(area, input);
  for (const entry of scene.entries) applyEntry(entry, input);
  if (scene.band) {
    paintFlags(scene.band, flagsOf(scene.band, input, ABSENT));
    setAttr(scene.band.g, 'aria-label', 'Shared foundation, the plumbing several features rely on');
  }
}

export { applyState };
export type { StateInput };
