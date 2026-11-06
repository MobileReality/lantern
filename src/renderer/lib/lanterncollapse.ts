const ZOOM_THRESHOLD = 0.7;
const SMALL_MAP_FILES = 120;
const MIN_DIR_FILES = 2;
const TILE_FONT_MIN = 12;
const TILE_FONT_MAX = 24;
const TILE_READABLE_PX = 10;

interface CollapseGroup {
  id: string;
  keys: readonly string[];
}

interface CollapseInput {
  groups: readonly CollapseGroup[];
  scale: number;
  expanded: ReadonlySet<string>;
  pinned: ReadonlySet<string>;
}

function dirTileKey(layerId: string, dir: string) {
  return `dir:${layerId}:${dir}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function collapseActive(files: number, scale: number) {
  return files > SMALL_MAP_FILES && scale < ZOOM_THRESHOLD;
}

function collapsedGroups({ groups, scale, expanded, pinned }: CollapseInput) {
  const collapsed = new Set<string>();
  const files = groups.reduce((sum, group) => sum + group.keys.length, 0);
  if (!collapseActive(files, scale)) return collapsed;
  for (const group of groups) {
    if (group.keys.length < MIN_DIR_FILES || expanded.has(group.id) || group.keys.some((key) => pinned.has(key))) continue;
    collapsed.add(group.id);
  }
  return collapsed;
}

function tileFontSize(scale: number) {
  return clamp(TILE_READABLE_PX / scale, TILE_FONT_MIN, TILE_FONT_MAX);
}

export { ZOOM_THRESHOLD, SMALL_MAP_FILES, MIN_DIR_FILES, dirTileKey, collapseActive, collapsedGroups, tileFontSize };
export type { CollapseGroup, CollapseInput };
