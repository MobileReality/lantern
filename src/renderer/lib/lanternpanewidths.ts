import { regionKeyFor } from './lanternregions';

interface Widths {
  left: number;
  middle: number;
}

interface Shown {
  list: boolean;
  viewer: boolean;
  graph: boolean;
}

interface PaneStore {
  load(): Widths | null;
  save(widths: Widths): void;
  clear(): void;
}

const DIVIDER_PX = 6;
const RAIL_PX = 28;
const MIN_LEFT = 240;
const MIN_MIDDLE = 280;
const MIN_RIGHT = 300;
const DEFAULT_LEFT_SHARE = 0.26;
const DEFAULT_LEFT_RANGE = { min: 300, max: 360 };
const STORAGE_KEY = 'lantern.reviewPanes';
const ALL_SHOWN: Shown = { list: true, viewer: true, graph: true };

function between(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function fixedPx(shown: Shown) {
  const visible = [shown.list, shown.viewer, shown.graph].filter(Boolean).length;
  return Math.max(0, visible - 1) * DIVIDER_PX + (3 - visible) * RAIL_PX;
}

function maxLeft(total: number, shown: Shown = ALL_SHOWN) {
  return total - fixedPx(shown) - (shown.viewer ? MIN_MIDDLE : 0) - (shown.graph ? MIN_RIGHT : 0);
}

function maxMiddle(total: number, left: number, shown: Shown = ALL_SHOWN) {
  return total - fixedPx(shown) - (shown.list ? left : 0) - (shown.graph ? MIN_RIGHT : 0);
}

function clampWidths(widths: Widths, total: number, shown: Shown = ALL_SHOWN): Widths {
  if (total <= 0) return widths;
  const left = between(widths.left, MIN_LEFT, maxLeft(total, shown));
  return { left, middle: between(widths.middle, MIN_MIDDLE, maxMiddle(total, left, shown)) };
}

function defaultWidths(total: number): Widths {
  const left = between(Math.round(total * DEFAULT_LEFT_SHARE), DEFAULT_LEFT_RANGE.min, DEFAULT_LEFT_RANGE.max);
  return clampWidths({ left, middle: Math.round((total - left - 2 * DIVIDER_PX) / 2) }, total);
}

function parseWidths(raw: string | null): Widths | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Widths>;
    return Number.isFinite(value.left) && Number.isFinite(value.middle) ? { left: value.left as number, middle: value.middle as number } : null;
  } catch {
    return null;
  }
}

function browserStore(project?: string): PaneStore {
  const key = regionKeyFor(STORAGE_KEY, project);
  return {
    load() {
      try {
        return parseWidths(localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    save(widths) {
      try {
        localStorage.setItem(key, JSON.stringify(widths));
      } catch {
        return;
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        return;
      }
    },
  };
}

export { ALL_SHOWN, DIVIDER_PX, MIN_LEFT, MIN_MIDDLE, MIN_RIGHT, RAIL_PX, between, browserStore, clampWidths, defaultWidths, maxLeft, maxMiddle, parseWidths };
export type { PaneStore, Shown, Widths };
