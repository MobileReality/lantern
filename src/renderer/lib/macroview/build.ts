import { FOUNDATION_KEY } from '../lanternmacro';
import { fileIconUrl } from '../file-icons';
import { MACRO_STYLE_CLASSES } from '../lanternmacrostyles';
import type { Rect } from './camera';
import type { AreaBox, Box, FeatureBox, MacroViewLayout } from './layout';
import { MAX_FILES, MAX_RELATIONS } from './files';
import type { ModelArea, ModelEntry, ModelFeature, MacroViewModel } from './model';
import { el, setRect, textEl } from './svg';

const AREA_RADIUS = 18;
const TILE_RADIUS = 12;
const PURPOSE_LINES = 3;
const TILE_PURPOSE_LINES = 2;
const BAND_RADIUS = 16;

type ItemKind = 'area' | 'feature' | 'foundation' | 'band' | 'file';

interface Item {
  key: string;
  kind: ItemKind;
  id: string;
  rect: Rect;
  g: SVGGElement;
  shape: SVGRectElement;
}

interface Badge {
  g: SVGGElement;
  bg: SVGRectElement;
  text: SVGTextElement;
}

interface FileNodes {
  g: SVGGElement;
  bg: SVGRectElement;
  icon: SVGImageElement;
  name: SVGTextElement;
  tag: SVGTextElement;
  path: string;
}

interface FeatureNodes extends Item {
  box: FeatureBox;
  model: ModelFeature;
  name: SVGTextElement;
  caption: SVGTextElement;
  purpose: SVGTextElement[];
  badge: Badge;
  mark: Badge;
  count: Badge;
  files: SVGGElement;
  filesTitle: SVGTextElement;
  rows: FileNodes[];
  more: SVGTextElement;
  relTitle: SVGTextElement;
  relations: SVGTextElement[];
}

interface AreaNodes extends Item {
  box: AreaBox;
  model: ModelArea;
  featuresGroup: SVGGElement;
  title: SVGTextElement;
  purpose: SVGTextElement[];
  caption: SVGTextElement;
  headName: SVGTextElement;
  headPurpose: SVGTextElement;
  badge: Badge;
  mark: Badge;
  count: Badge;
  features: FeatureNodes[];
}

interface EntryNodes extends Item {
  name: SVGTextElement;
  caption: SVGTextElement;
  badge: Badge;
  count: Badge;
}

interface LaneNodes {
  g: SVGGElement;
  shape: SVGRectElement;
  label: SVGTextElement;
  rect: Rect;
}

interface Scene {
  svg: SVGSVGElement;
  world: SVGGElement;
  links: SVGGElement;
  hot: SVGGElement;
  areas: AreaNodes[];
  entries: EntryNodes[];
  band: (LaneNodes & Item) | null;
  items: Map<string, Item>;
  uid: string;
}

type PillKind = typeof MACRO_STYLE_CLASSES.tally | typeof MACRO_STYLE_CLASSES.mark | typeof MACRO_STYLE_CLASSES.count;

function pillOf(parent: Element, kind: PillKind): Badge {
  const g = el('g', `mv-badge ${kind}`, {}, parent);
  const bg = el('rect', 'mv-badge-bg', {}, g);
  const text = textEl('mv-badge-text', g, 'middle');
  g.style.display = 'none';
  return { g, bg, text };
}

const badgeOf = (parent: Element) => pillOf(parent, MACRO_STYLE_CLASSES.tally);
const markOf = (parent: Element) => pillOf(parent, MACRO_STYLE_CLASSES.mark);
const countOf = (parent: Element) => pillOf(parent, MACRO_STYLE_CLASSES.count);

function lines(count: number, className: string, parent: Element, anchor: 'start' | 'middle' = 'middle') {
  return Array.from({ length: count }, () => textEl(className, parent, anchor));
}

function itemOf(parent: Element, key: string, kind: ItemKind, id: string, rect: Rect, className: string, radius: number, index: number, uid: string): Item {
  const g = el('g', `mv-item ${className}`, { 'data-key': key, 'data-kind': kind, id: `${uid}-${index}`, role: 'button', tabindex: '-1' }, parent);
  const shape = el('rect', 'mv-shape', {}, g);
  setRect(shape, rect, radius);
  return { key, kind, id, rect, g, shape };
}

function featureNodes(parent: Element, box: FeatureBox, model: ModelFeature, index: number, uid: string): FeatureNodes {
  const item = itemOf(parent, box.key, 'feature', box.id, box.rect, 'mv-feature', TILE_RADIUS, index, uid);
  const name = textEl('mv-fname', item.g);
  const caption = textEl('mv-fcaption', item.g);
  const purpose = lines(TILE_PURPOSE_LINES, 'mv-fpurpose', item.g, 'start');
  const files = el('g', 'mv-files', {}, item.g);
  files.style.display = 'none';
  const filesTitle = textEl('mv-ftitle', files);
  const more = textEl('mv-rowmore', files);
  const relTitle = textEl('mv-ftitle', files);
  const relations = lines(MAX_RELATIONS, 'mv-relation', files, 'start');
  return { ...item, box, model, name, caption, purpose, badge: badgeOf(item.g), mark: markOf(item.g), count: countOf(item.g), files, filesTitle, rows: [], more, relTitle, relations };
}

function areaNodes(parent: Element, box: AreaBox, model: ModelArea, index: number, uid: string, counter: { next: number }): AreaNodes {
  const item = itemOf(parent, box.key, 'area', box.id, box.rect, box.pending ? `mv-area ${MACRO_STYLE_CLASSES.pending}` : 'mv-area', AREA_RADIUS, index, uid);
  const title = textEl('mv-title', item.g, 'middle');
  const purpose = lines(PURPOSE_LINES, 'mv-purpose', item.g);
  const caption = textEl('mv-caption', item.g, 'middle');
  const featuresGroup = el('g', 'mv-features', {}, item.g);
  featuresGroup.style.display = 'none';
  const features = box.features.map((feature, at) => featureNodes(featuresGroup, feature, model.features[at], counter.next++, uid));
  const headName = textEl('mv-hname', item.g);
  const headPurpose = textEl('mv-hpurpose', item.g);
  return { ...item, box, model, featuresGroup, title, purpose, caption, headName, headPurpose, badge: badgeOf(item.g), mark: markOf(item.g), count: countOf(item.g), features };
}

function entryNodes(parent: Element, box: Box, model: ModelEntry, index: number, uid: string): EntryNodes {
  const item = itemOf(parent, box.key, 'foundation', box.id, box.rect, 'mv-entry', 8, index, uid);
  item.g.setAttribute('data-files', String(model.files));
  item.g.setAttribute('data-name', model.name);
  return { ...item, name: textEl('mv-ename', item.g), caption: textEl('mv-ecaption', item.g), badge: badgeOf(item.g), count: countOf(item.g) };
}

function bandNodes(parent: Element, rect: Rect, label: string, index: number, uid: string): LaneNodes & Item {
  const g = el('g', 'mv-lane mv-band', {}, parent);
  const shape = el('rect', 'mv-lane-shape', {}, g);
  setRect(shape, rect, BAND_RADIUS);
  const text = textEl('mv-lane-label', g);
  text.textContent = label;
  const lane = { g, shape, label: text, rect };
  lane.g.setAttribute('data-key', FOUNDATION_KEY);
  lane.g.setAttribute('data-kind', 'band');
  lane.g.setAttribute('id', `${uid}-${index}`);
  lane.g.setAttribute('role', 'button');
  lane.g.setAttribute('tabindex', '-1');
  lane.g.classList.add('mv-item');
  return { ...lane, key: FOUNDATION_KEY, kind: 'band', id: FOUNDATION_KEY };
}

function createScene(layout: MacroViewLayout, model: MacroViewModel, uid: string): Scene {
  const svg = el('svg', 'mv-svg', { width: '100%', height: '100%', focusable: 'false' });
  const world = el('g', 'mv-world', {}, svg);
  const links = el('g', 'mv-links', {}, world);
  const hot = el('g', 'mv-hot', {}, world);
  const counter = { next: 0 };
  const lanes = el('g', 'mv-lanes', {}, world);
  const band = layout.band ? bandNodes(lanes, layout.band.rect, 'Shared foundation', counter.next++, uid) : null;
  const entries = (layout.band?.boxes ?? []).map((box, at) => entryNodes(lanes, box, model.foundation[at], counter.next++, uid));
  const areas = layout.areas.map((box) => areaNodes(world, box, model.areaById.get(box.id) as ModelArea, counter.next++, uid, counter));
  const items = new Map<string, Item>();
  for (const item of [...(band ? [band] : []), ...entries, ...areas, ...areas.flatMap((area) => area.features)]) items.set(item.key, item);
  return { svg, world, links, hot, areas, entries, band, items, uid };
}

function addFileRows(feature: FeatureNodes, count: number, uid: string, counter: { next: number }) {
  while (feature.rows.length < count) {
    const g = el('g', 'mv-file mv-item', { role: 'button', tabindex: '-1', id: `${uid}-f${counter.next++}`, 'data-kind': 'file' }, feature.files);
    const bg = el('rect', 'mv-rowbg', { rx: 3 }, g);
    const icon = el('image', 'mv-rowicon', {}, g);
    const name = textEl('mv-rowname', g);
    const tag = textEl('mv-rowtag', g, 'end');
    feature.rows.push({ g, bg, icon, name, tag, path: '' });
  }
}

function bindFileRow(row: FileNodes, path: string) {
  if (row.path === path) return;
  row.path = path;
  row.g.setAttribute('data-key', `file:${path}`);
  row.g.setAttribute('data-path', path);
  row.icon.setAttribute('href', fileIconUrl(path));
}

export { addFileRows, bindFileRow, createScene };
export type { AreaNodes, EntryNodes, FeatureNodes, FileNodes, Item, ItemKind, Scene };
