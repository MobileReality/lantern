import type { Rect } from './camera';
import { unionOf } from './camera';
import type { ModelArea, MacroViewModel } from './model';
import { pairId } from './model';

const TILE = { w: 300, h: 214 };
const TILE_GAP = 14;
const AREA_PAD = 18;
const AREA_HEADER = 96;
const CELL_GAP = 56;
const LANE_GAP = 70;
const BAND_PAD = 14;
const ENTRY_MAX_W = 340;
const ENTRY_H = 64;
const LANE_H = ENTRY_H + BAND_PAD * 2;
const DEFAULT_ASPECT = 1.5;
const TILE_ASPECT = 1.3;

interface Box {
  key: string;
  id: string;
  rect: Rect;
}

interface FeatureBox extends Box {
  areaId: string;
}

interface AreaBox extends Box {
  pending: boolean;
  features: FeatureBox[];
}

interface LaneBox {
  rect: Rect;
  boxes: Box[];
}

interface MacroViewLayout {
  world: Rect;
  field: Rect;
  areas: AreaBox[];
  band: LaneBox | null;
}

function columnsOf(features: number) {
  return Math.max(1, Math.ceil(Math.sqrt(features * TILE_ASPECT * (TILE.h / TILE.w))));
}

function naturalSize(area: ModelArea) {
  const cols = columnsOf(area.features.length);
  const rows = Math.max(1, Math.ceil(area.features.length / cols));
  return { w: AREA_PAD * 2 + cols * TILE.w + (cols - 1) * TILE_GAP, h: AREA_HEADER + AREA_PAD + rows * TILE.h + (rows - 1) * TILE_GAP };
}

function orderAreas(model: MacroViewModel): ModelArea[] {
  const weight = new Map<string, number>();
  for (const link of model.areaLinks) weight.set(pairId(link.from, link.to), link.count);
  const between = (a: string, b: string) => weight.get(pairId(a, b)) ?? 0;
  const total = (area: ModelArea) => model.areas.reduce((sum, other) => sum + (other === area ? 0 : between(area.id, other.id)), 0);
  const gainOf = (area: ModelArea, placed: readonly ModelArea[]) => placed.reduce((sum, done) => sum + between(area.id, done.id), 0);
  const rest = model.areas.filter((area) => !area.pending).sort((a, b) => total(b) - total(a) || a.id.localeCompare(b.id));
  const placed: ModelArea[] = [];
  while (rest.length) {
    const next = placed.length ? rest.reduce((best, area) => (gainOf(area, placed) > gainOf(best, placed) ? area : best)) : rest[0];
    placed.push(next);
    rest.splice(rest.indexOf(next), 1);
  }
  return [...placed, ...model.areas.filter((area) => area.pending)];
}

function gridFor(areas: readonly ModelArea[], columns: number) {
  const sizes = areas.map(naturalSize);
  const rows = Math.ceil(areas.length / columns);
  const widths = Array.from({ length: columns }, (_, column) => Math.max(0, ...sizes.filter((_, index) => index % columns === column).map((size) => size.w)));
  const heights = Array.from({ length: rows }, (_, row) => Math.max(0, ...sizes.filter((_, index) => Math.floor(index / columns) === row).map((size) => size.h)));
  const total = { w: widths.reduce((a, b) => a + b, 0) + CELL_GAP * (columns - 1), h: heights.reduce((a, b) => a + b, 0) + CELL_GAP * (rows - 1) };
  return { columns, rows, widths, heights, total };
}

function bestGrid(areas: readonly ModelArea[], aspect: number) {
  const options = Array.from({ length: areas.length }, (_, index) => gridFor(areas, index + 1));
  return options.reduce((best, option) => (Math.abs(Math.log(option.total.w / option.total.h / aspect)) < Math.abs(Math.log(best.total.w / best.total.h / aspect)) ? option : best));
}

function placeTiles(area: ModelArea, rect: Rect): FeatureBox[] {
  const cols = columnsOf(area.features.length);
  const rows = Math.max(1, Math.ceil(area.features.length / cols));
  const w = (rect.w - AREA_PAD * 2 - (cols - 1) * TILE_GAP) / cols;
  const h = (rect.h - AREA_HEADER - AREA_PAD - (rows - 1) * TILE_GAP) / rows;
  return area.features.map((feature, index) => ({
    key: feature.key,
    id: feature.id,
    areaId: area.id,
    rect: { x: rect.x + AREA_PAD + (index % cols) * (w + TILE_GAP), y: rect.y + AREA_HEADER + Math.floor(index / cols) * (h + TILE_GAP), w, h },
  }));
}

function placeAreas(ordered: readonly ModelArea[], grid: ReturnType<typeof gridFor>): AreaBox[] {
  const lefts = grid.widths.map((_, column) => grid.widths.slice(0, column).reduce((a, b) => a + b, 0) + CELL_GAP * column);
  const tops = grid.heights.map((_, row) => grid.heights.slice(0, row).reduce((a, b) => a + b, 0) + CELL_GAP * row);
  return ordered.map((area, index) => {
    const [column, row] = [index % grid.columns, Math.floor(index / grid.columns)];
    const rect = { x: lefts[column], y: tops[row], w: grid.widths[column], h: grid.heights[row] };
    return { key: area.key, id: area.id, pending: area.pending, rect, features: placeTiles(area, rect) };
  });
}

function placeBand(model: MacroViewModel, rect: Rect): LaneBox | null {
  if (!model.foundation.length) return null;
  const count = model.foundation.length;
  const room = rect.w - BAND_PAD * 2 - (count - 1) * TILE_GAP;
  const w = Math.min(ENTRY_MAX_W, room / count);
  return { rect, boxes: model.foundation.map((entry, index) => ({ key: entry.key, id: entry.id, rect: { x: rect.x + BAND_PAD + index * (w + TILE_GAP), y: rect.y + BAND_PAD, w, h: ENTRY_H } })) };
}

function layoutMacroView(model: MacroViewModel, aspect = DEFAULT_ASPECT): MacroViewLayout {
  const ordered = orderAreas(model);
  const grid = bestGrid(ordered, aspect);
  const areas = placeAreas(ordered, grid);
  const field: Rect = { x: 0, y: 0, w: grid.total.w, h: grid.total.h };
  const band = placeBand(model, { x: 0, y: field.h + LANE_GAP, w: field.w, h: LANE_H });
  const world = unionOf([field, ...(band ? [band.rect] : [])]) as Rect;
  return { world, field, areas, band };
}

export { AREA_HEADER, AREA_PAD, DEFAULT_ASPECT, TILE, layoutMacroView, orderAreas };
export type { AreaBox, Box, FeatureBox, LaneBox, MacroViewLayout };
