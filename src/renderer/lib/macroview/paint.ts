import { VIEW, say } from '../../../shared/lantern-plan-messages';
import { plural } from '../lanternmacro';
import { MACRO_STYLE_CLASSES } from '../lanternmacrostyles';
import type { AreaNodes, EntryNodes, FeatureNodes, Scene } from './build';
import { addFileRows, bindFileRow } from './build';
import type { Camera, Rect, Size } from './camera';
import { clamp, inflate, intersects, worldRect } from './camera';
import type { FileList } from './files';
import { relationRows } from './files';
import { AREA_HEADER } from './layout';
import { featuresWeight, filesWeight, fitLabel, isShown, wrapLines } from './lod';
import type { MacroViewMarks } from './marks';
import { tallyText } from './marks';
import type { Tally } from './marks';
import type { MacroViewModel } from './model';
import { placeText, setAttr, setFlag, setRect, showAt } from './svg';

const CULL_MARGIN = 60;
const ROW_PX = 18;
const BADGE_H = 18;
const BADGE_PAD = 12;
const BADGE_FONT = 11;
const CHAR_PX = 0.56;
const BADGE_CHAR_PX = 0.66;
const PURPOSE_FROM_HEIGHT = 120;
const HEADER_PURPOSE_FROM = 46;
const PILL_MIN_ROOM = 56;
const COUNT_MIN_ROOM = 100;
const MARK_READING = 'READING';
const MARK_STEP = 'STEP';
const OVERVIEW_PAD = 8;
const OVERVIEW_GAP = 8;
const CAPTION_H = 16;
const OVERVIEW_FADE = 2.4;
const DETAIL_LAG = 0.15;
const HEADER_GROWS_AT = 650;
const MAX_HEADER_UNIT = 2.1;
const TEXT_GROWS_AT = 420;
const MAX_TEXT_UNIT = 1.6;

interface PaintInput {
  scene: Scene;
  model: MacroViewModel;
  camera: Camera;
  viewport: Size;
  marks: MacroViewMarks;
  listOf(featureId: string): FileList;
  counter: { next: number };
  focusKey: string | null;
  pickedFile: string | null;
  counts: ReadonlyMap<string, number>;
}

function unitOf(tileWidth: number) {
  return clamp(tileWidth / TEXT_GROWS_AT, 1, MAX_TEXT_UNIT);
}

function at(rect: Rect, k: number, dx: number, dy: number) {
  return { x: rect.x + dx / k, y: rect.y + dy / k };
}

function badgeWidth(text: string) {
  return text.length * BADGE_FONT * BADGE_CHAR_PX + BADGE_PAD;
}

function paintPill(badge: AreaNodes['badge'], rect: Rect, k: number, text: string | null, taken: number, top = 6, room = PILL_MIN_ROOM) {
  const sw = rect.w * k;
  const width = text ? badgeWidth(text) : 0;
  if (!text || sw < width + taken + room) {
    showAt(badge.g, false);
    return 0;
  }
  showAt(badge.g, true);
  const origin = at(rect, k, sw - 6 - taken - width, top);
  setRect(badge.bg, { x: origin.x, y: origin.y, w: width / k, h: BADGE_H / k }, BADGE_H / 2 / k);
  placeText(badge.text, text, origin.x + width / 2 / k, origin.y + BADGE_H * 0.72 / k, BADGE_FONT / k);
  return width + 4;
}

function paintBadge(badge: AreaNodes['badge'], rect: Rect, k: number, tally: Tally | undefined, top = 6, taken = 0) {
  return paintPill(badge, rect, k, tally ? `${tallyText(tally)} files` : null, taken, top);
}

function paintCount(badge: AreaNodes['badge'], rect: Rect, k: number, count: number | undefined, top = 6, room = PILL_MIN_ROOM) {
  if (!count) return paintPill(badge, rect, k, null, 0, top);
  return paintPill(badge, rect, k, plural(count, 'relation'), 0, top, room) || paintPill(badge, rect, k, `${count}×`, 0, top, room);
}

function markText(reading: boolean, flow: boolean, plan = false) {
  return reading ? MARK_READING : flow ? MARK_STEP : plan ? say(VIEW.MARK_PLAN) : null;
}

function paintOverview(area: AreaNodes, k: number, weight: number) {
  const { rect } = area;
  const sw = rect.w * k;
  const sh = rect.h * k;
  const nameSize = clamp(sw * 0.085, 14, 28);
  const title = fitLabel(area.model.name, sw * 0.86, nameSize, 11);
  const purposeSize = clamp(sw * 0.048, 11, 14);
  const lineH = purposeSize * 1.4;
  const titleH = title ? title.size * 1.3 : 0;
  const caption = `${plural(area.model.features.length, 'feature')} · ${plural(area.model.files, 'file')}`;
  const room = sh - OVERVIEW_PAD * 2 - titleH;
  const showCaption = room >= CAPTION_H;
  const linesRoom = Math.floor((room - (showCaption ? CAPTION_H : 0) - OVERVIEW_GAP) / lineH);
  const wanted = Math.min(area.purpose.length, linesRoom);
  const lines = weight > 0.02 && area.model.purpose && wanted > 0 ? wrapLines(area.model.purpose, sw * 0.8, purposeSize, wanted) : [];
  const block = titleH + (lines.length ? OVERVIEW_GAP + lines.length * lineH : 0) + (showCaption ? CAPTION_H : 0);
  const top = (sh - block) / 2;
  const centre = rect.x + rect.w / 2;
  const y = (px: number) => rect.y + px / k;
  const titleBase = top + (title?.size ?? 0);
  placeText(area.title, title ? title.text : null, centre, y(titleBase), (title?.size ?? 0) / k, weight);
  area.purpose.forEach((node, index) => { placeText(node, lines[index] ?? null, centre, y(titleBase + OVERVIEW_GAP + lineH * (index + 1) - 4), purposeSize / k, weight * 0.85); });
  placeText(area.caption, showCaption ? caption : null, centre, y(top + block - 4), 11 / k, weight * 0.7);
}

function paintHeader(area: AreaNodes, k: number, weight: number) {
  const { rect } = area;
  const sw = rect.w * k;
  const headerPx = AREA_HEADER * k;
  const s = clamp(sw / HEADER_GROWS_AT, 1, MAX_HEADER_UNIT);
  const name = fitLabel(area.model.name, sw - 150, 15 * s, 12);
  const base = at(rect, k, 14, 8 + (name?.size ?? 15));
  placeText(area.headName, name ? name.text : null, base.x, base.y, (name?.size ?? 15) / k, weight);
  const purpose = headerPx >= HEADER_PURPOSE_FROM ? fitLabel(area.model.purpose, sw - 28, 11.5 * s, 10.5) : null;
  const sub = at(rect, k, 14, 8 + (name?.size ?? 15) + 15 * s);
  placeText(area.headPurpose, purpose ? purpose.text : null, sub.x, sub.y, (purpose?.size ?? 11) / k, weight * 0.8);
}

function paintRow(feature: FeatureNodes, index: number, input: PaintInput, rowTop: number) {
  const row = feature.rows[index];
  const entry = input.listOf(feature.id).rows[index];
  bindFileRow(row, entry.path);
  const { rect } = feature;
  const k = input.camera.k;
  const tw = rect.w * k;
  const s = unitOf(tw);
  const origin = at(rect, k, 6, rowTop + index * ROW_PX * s);
  setRect(row.bg, { x: origin.x, y: origin.y, w: (tw - 12) / k, h: (ROW_PX - 2) * s / k }, 3 / k);
  setAttr(row.icon, 'x', origin.x + 4 / k);
  setAttr(row.icon, 'y', origin.y + 2 * s / k);
  setAttr(row.icon, 'width', 12 * s / k);
  setAttr(row.icon, 'height', 12 * s / k);
  const tag = entry.reading ? 'READING' : entry.changed ? 'changed' : entry.plan ? say(VIEW.ROW_TAG_PLAN) : entry.flow ? 'step' : entry.related ? say(VIEW.ROW_TAG_RELATED) : '';
  const room = tw - 12 - 24 * s - (tag ? tag.length * 9 * s * CHAR_PX + 12 : 0);
  const label = fitLabel(entry.name, room, 11.5 * s, 10);
  placeText(row.name, label ? label.text : null, origin.x + 22 * s / k, origin.y + 12 * s / k, (label?.size ?? 11) / k);
  placeText(row.tag, tag || null, origin.x + (tw - 12 - 6) / k, origin.y + 11.5 * s / k, 8.5 * s / k);
  setFlag(row.g, MACRO_STYLE_CLASSES.changed, entry.changed || entry.plan);
  setFlag(row.g, MACRO_STYLE_CLASSES.reading, entry.reading);
  setFlag(row.g, MACRO_STYLE_CLASSES.flow, entry.flow);
  setFlag(row.g, MACRO_STYLE_CLASSES.picked, entry.path === input.pickedFile);
  setFlag(row.g, MACRO_STYLE_CLASSES.focus, `file:${entry.path}` === input.focusKey);
  setAttr(row.g, 'aria-label', `${entry.name}${entry.reading ? ', being read' : ''}${entry.changed ? ', changed in the pull request' : ''}${entry.plan ? say(VIEW.ROW_ARIA_PLAN) : ''}${entry.flow ? ', in the picked step' : ''}${entry.related ? say(VIEW.ROW_ARIA_RELATED) : ''}. Press Enter to open it in the review pane`);
}

function paintFiles(feature: FeatureNodes, input: PaintInput, weight: number, top: number) {
  const { rect } = feature;
  const k = input.camera.k;
  const th = rect.h * k;
  const s = unitOf(rect.w * k);
  const list = input.listOf(feature.id);
  addFileRows(feature, list.rows.length, input.scene.uid, input.counter);
  const rowTop = top + 8;
  const pitch = ROW_PX * s;
  const room = Math.max(0, Math.floor((th - 8 - rowTop) / pitch));
  const shown = Math.min(list.rows.length, room);
  const titleAt = at(rect, k, 10, top);
  placeText(feature.filesTitle, shown ? 'Top files' : null, titleAt.x, titleAt.y, 9.5 * s / k, weight * 0.7);
  feature.rows.forEach((row, index) => {
    const live = index < shown;
    showAt(row.g, live);
    if (live) paintRow(feature, index, input, rowTop);
  });
  const afterRows = rowTop + shown * pitch;
  const moreAt = at(rect, k, 12, afterRows + 12 * s);
  const hasMore = shown === list.rows.length && list.more > 0 && afterRows + pitch < th - 4;
  placeText(feature.more, hasMore ? `+${list.more} more files` : null, moreAt.x, moreAt.y, 10 * s / k, weight * 0.6);
  paintRelations(feature, input, weight, hasMore ? afterRows + pitch + 6 : afterRows + 6, th);
}

function paintRelations(feature: FeatureNodes, input: PaintInput, weight: number, top: number, th: number) {
  const { rect } = feature;
  const k = input.camera.k;
  const s = unitOf(rect.w * k);
  const rows = relationRows(input.model, feature.id);
  const pitch = 15 * s;
  const fits = Math.max(0, Math.floor((th - 8 - top - 14 * s) / pitch));
  const count = Math.min(rows.length, fits);
  const titleAt = at(rect, k, 10, top + 10 * s);
  placeText(feature.relTitle, count ? 'Relations' : null, titleAt.x, titleAt.y, 9.5 * s / k, weight * 0.7);
  feature.relations.forEach((node, index) => {
    const row = rows[index];
    const label = row && index < count ? fitLabel(`${row.name} · ${row.count}`, rect.w * k - 28, 11 * s, 10) : null;
    const place = at(rect, k, 12, top + 10 * s + 14 * s + index * pitch);
    placeText(node, label ? label.text : null, place.x, place.y, (label?.size ?? 11) / k, weight * 0.85);
  });
}

function paintTileText(feature: FeatureNodes, k: number, weight: number, filesWeightNow: number, tallied: boolean) {
  const { rect } = feature;
  const tw = rect.w * k;
  const th = rect.h * k;
  const s = unitOf(tw);
  const name = fitLabel(feature.model.name, tw - 20, 13 * s, 10.5);
  const nameAt = at(rect, k, 10, 8 + (name?.size ?? 13));
  placeText(feature.name, name ? name.text : null, nameAt.x, nameAt.y, (name?.size ?? 13) / k, weight);
  const showCaption = th >= 54 && !!name && !tallied;
  const captionAt = at(rect, k, 10, 8 + (name?.size ?? 13) + 14 * s);
  placeText(feature.caption, showCaption ? plural(feature.model.files, 'file') : null, captionAt.x, captionAt.y, 10.5 * s / k, weight * 0.7);
  const purposeSize = 11 * s;
  const lines = th >= PURPOSE_FROM_HEIGHT && feature.model.purpose ? wrapLines(feature.model.purpose, tw - 20, purposeSize, feature.purpose.length) : [];
  const purposeTop = 8 + (name?.size ?? 13) + 14 * s + 8;
  feature.purpose.forEach((node, index) => {
    const place = at(rect, k, 10, purposeTop + purposeSize * 1.35 * (index + 1));
    placeText(node, lines[index] ?? null, place.x, place.y, purposeSize / k, weight * 0.8 * (1 - filesWeightNow * 0.15));
  });
  return purposeTop + lines.length * purposeSize * 1.35 + 14 * s;
}

function paintFeature(feature: FeatureNodes, input: PaintInput, areaWeight: number) {
  const k = input.camera.k;
  const tw = feature.rect.w * k;
  const weight = filesWeight(tw, areaWeight);
  const tally = input.marks.features.get(feature.id);
  const uses = input.counts.get(feature.key);
  const top = paintTileText(feature, k, 1, weight, !!tally || !!uses);
  const showFiles = isShown(weight);
  showAt(feature.files, showFiles);
  feature.files.style.pointerEvents = weight >= 0.5 ? '' : 'none';
  if (showFiles) paintFiles(feature, input, weight, top);
  const rowTop = 8 + 13 * unitOf(tw) + 1;
  const counted = paintCount(feature.count, feature.rect, k, uses, rowTop);
  const tallied = paintBadge(feature.badge, feature.rect, k, tally, rowTop, counted);
  const { marks } = input;
  paintPill(feature.mark, feature.rect, k, markText(marks.home.features.has(feature.id), !!marks.flow?.features.has(feature.id), !!marks.plan?.features.has(feature.id)), counted + tallied, rowTop);
}

function paintArea(area: AreaNodes, input: PaintInput) {
  const k = input.camera.k;
  const weight = featuresWeight(area.rect.w * k);
  const detail = clamp((weight - DETAIL_LAG) / (1 - DETAIL_LAG), 0, 1);
  paintOverview(area, k, clamp(1 - weight * OVERVIEW_FADE, 0, 1));
  paintHeader(area, k, detail);
  const counted = paintCount(area.count, area.rect, k, input.counts.get(area.key), 6, COUNT_MIN_ROOM);
  const tallied = paintBadge(area.badge, area.rect, k, input.marks.areas.get(area.id), 6, counted);
  paintPill(area.mark, area.rect, k, markText(input.marks.home.areas.has(area.id), !!input.marks.flow?.areas.has(area.id), !!input.marks.plan?.areas.has(area.id)), counted + tallied);
  const showFeatures = isShown(weight);
  showAt(area.featuresGroup, showFeatures);
  area.featuresGroup.style.pointerEvents = weight >= 0.5 ? '' : 'none';
  setAttr(area.featuresGroup, 'opacity', Math.round(detail * 100) / 100);
  if (showFeatures) for (const feature of area.features) paintFeature(feature, input, weight);
  return weight;
}

function paintEntry(entry: EntryNodes, k: number, tally: Tally | undefined, uses: number | undefined) {
  const { rect } = entry;
  const tw = rect.w * k;
  const th = rect.h * k;
  const name = fitLabel(entry.g.getAttribute('data-name') ?? '', tw - 12, 12, 9.5);
  const nameAt = at(rect, k, 8, 6 + (name?.size ?? 11));
  placeText(entry.name, name ? name.text : null, nameAt.x, nameAt.y, (name?.size ?? 11) / k);
  const files = entry.g.getAttribute('data-files');
  const captionAt = at(rect, k, 8, 6 + (name?.size ?? 11) + 13);
  placeText(entry.caption, files && th >= 32 && name ? plural(Number(files), 'file') : null, captionAt.x, captionAt.y, 10 / k, 0.7);
  const counted = paintCount(entry.count, rect, k, uses);
  paintBadge(entry.badge, rect, k, tally, 6, counted);
}

function paintLanes(input: PaintInput) {
  const { scene, camera } = input;
  const k = camera.k;
  const labelOf = (rect: Rect) => at(rect, k, 4, -8);
  if (scene.band) {
    const place = labelOf(scene.band.rect);
    placeText(scene.band.label, scene.band.label.textContent, place.x, place.y, 11 / k, 0.85);
  }
  for (const entry of scene.entries) paintEntry(entry, k, input.marks.foundation.get(entry.id), input.counts.get(entry.key));
}

function paintScene(input: PaintInput) {
  const { scene, camera, viewport } = input;
  setAttr(scene.world, 'transform', `translate(${camera.x.toFixed(2)} ${camera.y.toFixed(2)}) scale(${camera.k.toFixed(5)})`);
  const view = inflate(worldRect(camera, viewport), CULL_MARGIN / camera.k);
  let strongest = 0;
  for (const area of scene.areas) {
    const inView = intersects(area.rect, view);
    showAt(area.g, inView);
    if (inView) strongest = Math.max(strongest, paintArea(area, input));
  }
  paintLanes(input);
  setAttr(scene.links.querySelector('.mv-alinks') ?? scene.links, 'opacity', (1 - strongest * 0.75).toFixed(2));
  setAttr(scene.links.querySelector('.mv-flinks') ?? scene.links, 'opacity', strongest.toFixed(2));
  return strongest;
}

export { paintScene };
export type { PaintInput };
