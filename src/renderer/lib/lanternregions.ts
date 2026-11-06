type Region = 'list' | 'viewer' | 'foundation' | 'graph';
type RegionChange = (region: Region | null) => void;

interface RegionStore {
  load(): Region[];
  save(hidden: Region[]): void;
}

interface Regions {
  isHidden(region: Region): boolean;
  hidden(): Region[];
  canHide(region: Region): boolean;
  hide(region: Region): boolean;
  show(region: Region): boolean;
  toggle(region: Region): boolean;
  showAll(): boolean;
  onChange(listener: RegionChange): void;
}

const REGIONS: readonly Region[] = ['list', 'viewer', 'foundation', 'graph'];
const REGION_NAME: Record<Region, string> = { list: 'left column', viewer: 'file viewer', foundation: 'shared foundation', graph: 'graph' };
const REGION_STORE_KEY = 'lantern.reviewRegions';
const SHOW_ALL_SHORTCUT = 'Alt+0';

function shortcutOf(region: Region) {
  return `Alt+${REGIONS.indexOf(region) + 1}`;
}

function shortcutsHint() {
  return `${REGIONS.map((region) => `${shortcutOf(region)} ${REGION_NAME[region]}`).join(', ')}, ${SHOW_ALL_SHORTCUT} show everything`;
}

function keepsViewerOrGraph(hidden: ReadonlySet<Region>) {
  return !(hidden.has('viewer') && hidden.has('graph'));
}

function parseHidden(raw: string | null): Region[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const wanted = new Set(REGIONS.filter((region) => value.includes(region)));
    if (!keepsViewerOrGraph(wanted)) wanted.delete('viewer');
    return [...wanted];
  } catch {
    return [];
  }
}

function regionKeyFor(base: string, project?: string) {
  return project ? `${base}.${project}` : base;
}

function browserRegionStore(project?: string): RegionStore {
  const key = regionKeyFor(REGION_STORE_KEY, project);
  return {
    load() {
      try {
        return parseHidden(localStorage.getItem(key));
      } catch {
        return [];
      }
    },
    save(hidden) {
      try {
        if (hidden.length) localStorage.setItem(key, JSON.stringify(hidden));
        else localStorage.removeItem(key);
      } catch {
        return;
      }
    },
  };
}

function shortcutTarget(ev: KeyboardEvent): Region | 'all' | null {
  if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.repeat) return null;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(ev.code)?.[1];
  if (digit === undefined) return null;
  if (digit === '0') return 'all';
  return REGIONS[Number(digit) - 1] ?? null;
}

function createRegions(store: RegionStore): Regions {
  const hidden = new Set<Region>(store.load());
  const listeners: RegionChange[] = [];

  function commit(changed: Region | null) {
    store.save(REGIONS.filter((region) => hidden.has(region)));
    for (const listener of listeners) listener(changed);
    return true;
  }

  function canHide(region: Region) {
    return keepsViewerOrGraph(new Set([...hidden, region]));
  }

  function hide(region: Region) {
    if (hidden.has(region) || !canHide(region)) return false;
    hidden.add(region);
    return commit(region);
  }

  function show(region: Region) {
    if (!hidden.delete(region)) return false;
    return commit(region);
  }

  return {
    isHidden: (region) => hidden.has(region),
    hidden: () => REGIONS.filter((region) => hidden.has(region)),
    canHide,
    hide,
    show,
    toggle: (region) => (hidden.has(region) ? show(region) : hide(region)),
    showAll() {
      if (!hidden.size) return false;
      hidden.clear();
      return commit(null);
    },
    onChange: (listener) => void listeners.push(listener),
  };
}

export { REGIONS, REGION_NAME, SHOW_ALL_SHORTCUT, browserRegionStore, createRegions, keepsViewerOrGraph, parseHidden, regionKeyFor, shortcutOf, shortcutTarget, shortcutsHint };
export type { Region, RegionStore, Regions };
