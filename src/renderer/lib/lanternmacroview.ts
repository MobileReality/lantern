import type { MacroLoad } from '../../main/lantern-macro-load';
import type { LanternMap } from '../../main/lantern';
import { esc } from './lanternctx';
import { flowButtonHtml } from './lanternflow';
import type { FlowBar } from './lanternflow';
import { FOUNDATION_KEY, blockKey, macroAvailable } from './lanternmacro';
import type { MacroGraph } from './lanternmacro';
import { crumbsHtml } from './lanternmacrocrumbs';
import { foundationNear, foundationUsesNear } from './lanternmacrofoundation';
import { reconcileArea, sceneGraph } from './lanternmacrolevels';
import { areasSignature } from './lanternmacroareas';
import { layoutMacro } from './lanternmacrolayout';
import type { MacroLayout } from './lanternmacrolayout';
import { overviewButtonHtml } from './lanternmacrodrawer';
import { hasFoundation, realCards, systemLinksFor, withoutFoundation } from './lanternmacrorest';

const MACRO_TITLE = 'One block per feature, with the relations between blocks counted';
const MACRO_AREAS_TITLE = 'The areas of the product, with the relations between them counted. Open one to see its features';
const PR_MARK_ON_TITLE = 'Showing what the pull request touches. Hide it to see the plain Macro view.';
const PR_MARK_OFF_TITLE = 'Show the blocks, links and outside systems the pull request touches';

type ReadMacro = () => Promise<MacroLoad>;
type MacroLoaded = Extract<MacroLoad, { ok: true }>;

interface MacroFrame {
  shape: MacroLayout | null;
  rest: MacroLayout | null;
  loaded: Pick<MacroLoaded, 'view' | 'blockByPath' | 'areas'> | null;
  minStrongEdge: number;
  loading: boolean;
  error: string;
  warning: string;
  hint: boolean;
  payload: MacroLoaded | null;
}

interface BarOptions {
  files: number;
  marking: boolean | null;
  flow?: FlowBar | null;
  uid?: string;
  overview?: { open: boolean; id: string } | null;
}

interface MacroMode {
  available(data: LanternMap): boolean;
  isOn(): boolean;
  hasFoundation(): boolean;
  setFoundationHidden(hidden: boolean): boolean;
  set(on: boolean): void;
  invalidate(): void;
  select(key: string | null): void;
  enter(key: string): boolean;
  leave(): string | null;
  selected(): string | null;
  near(): Set<string>;
  nearWeak(): Set<string>;
  frame(): MacroFrame;
  barHtml(source: LanternMap, options: BarOptions): string;
}

function failure(error: unknown): MacroLoad {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function createMacroMode(read: ReadMacro | undefined, redraw: () => void): MacroMode {
  const available = (data: LanternMap) => !!read && macroAvailable(data);
  let on = false;
  let stale = true;
  let loading = false;
  let graph: MacroGraph | null = null;
  let rest: MacroLayout | null = null;
  let shape: MacroLayout | null = null;
  let shownLinks = '';
  let loaded: MacroFrame['loaded'] = null;
  let payload: MacroLoaded | null = null;
  let topCards = 0;
  let minStrongEdge = 0;
  let error = '';
  let warning = '';
  let hint = false;
  let selected: string | null = null;
  let areaId: string | null = null;
  let areasSeen = '';
  let ticket = 0;
  let foundationHidden = false;
  let foundationPresent = false;

  function rebuild() {
    const full = payload ? sceneGraph(payload, areaId) : null;
    foundationPresent = !!full && hasFoundation(full);
    graph = full && foundationHidden ? withoutFoundation(full) : full;
    rest = graph ? layoutMacro(graph) : null;
    shape = rest;
    shownLinks = '';
  }

  async function fetchNow() {
    if (!read) return;
    const mine = ++ticket;
    loading = true;
    const result = await read().catch(failure);
    if (mine !== ticket) return;
    loading = false;
    stale = false;
    payload = result.ok ? result : null;
    topCards = payload ? realCards(sceneGraph(payload, null).blocks).length : 0;
    if (result.ok) {
      const seen = areasSignature(result.areas ?? null);
      areaId = seen === areasSeen ? reconcileArea(areaId, result.areas) : null;
      areasSeen = seen;
    }
    rebuild();
    loaded = result.ok ? { view: result.view, blockByPath: result.blockByPath, areas: result.areas } : null;
    minStrongEdge = result.ok ? result.minStrongEdge : 0;
    error = result.ok ? '' : result.error;
    warning = result.ok ? (result.areasWarning ?? '') : '';
    hint = result.ok && result.areasHint === true;
    if (selected && !isKnown(selected)) selected = null;
    showLinksOfSelection();
    if (on) redraw();
  }

  function isKnown(key: string) {
    if (!graph || !rest) return false;
    if (key === FOUNDATION_KEY) return graph.blocks.some((block) => block.kind === 'core');
    return rest.layout.pos.has(key) || graph.systems.some((system) => system.key === key);
  }

  function showLinksOfSelection() {
    if (!graph) return;
    const links = systemLinksFor(graph, selected);
    const signature = [...links].sort().join(',');
    if (signature === shownLinks) return;
    shownLinks = signature;
    shape = links.size ? layoutMacro(graph, links) : rest;
  }

  function nearKeys() {
    const near = new Set<string>();
    if (!selected || !shape) return near;
    near.add(selected);
    for (const key of foundationNear(shape.graph, selected)) near.add(key);
    const core = new Set(shape.graph.blocks.filter((block) => block.kind === 'core').map((block) => block.key));
    const picked = (key: string) => key === selected || (selected === FOUNDATION_KEY && core.has(key));
    if (selected === FOUNDATION_KEY) for (const key of core) near.add(key);
    for (const edge of shape.graph.edges) {
      if (picked(edge.fromKey)) near.add(edge.toKey);
      if (picked(edge.toKey)) near.add(edge.fromKey);
    }
    for (const link of shape.links) {
      if (link.link.blockKey === selected) near.add(link.system.key);
      if (link.system.key === selected) near.add(link.link.blockKey);
    }
    return near;
  }

  return {
    available,
    isOn: () => on,
    hasFoundation: () => on && foundationPresent,
    setFoundationHidden(hidden) {
      if (hidden === foundationHidden) return false;
      foundationHidden = hidden;
      rebuild();
      if (selected && !isKnown(selected)) selected = null;
      showLinksOfSelection();
      return true;
    },
    set(next) {
      on = next;
      if (next && stale && !loading) void fetchNow();
    },
    invalidate() {
      stale = true;
      ticket += 1;
      loading = false;
      if (on) void fetchNow();
    },
    select: (key) => {
      selected = key;
      showLinksOfSelection();
    },
    enter(key) {
      const drawn = graph?.blocks.find((block) => block.key === key);
      const opens = drawn ? drawn.opens : Object.keys(payload?.areas?.details ?? {}).find((id) => blockKey(id) === key);
      if (!opens || !payload?.areas || !Object.hasOwn(payload.areas.details, opens)) return false;
      areaId = opens;
      selected = null;
      rebuild();
      return true;
    },
    leave() {
      const left = areaId;
      if (left === null) return null;
      areaId = null;
      selected = null;
      rebuild();
      return left;
    },
    selected: () => selected,
    near: nearKeys,
    nearWeak() {
      const strong = nearKeys();
      return new Set([...(shape ? foundationUsesNear(shape.graph, selected) : [])].filter((key) => !strong.has(key)));
    },
    frame: () => ({ shape, rest, loaded, minStrongEdge, loading, error, warning, hint, payload }),
    barHtml(source, { files, marking, flow = null, uid = '', overview = null }) {
      if (!available(source) && !flow) return '';
      const filesOn = !on && !flow?.on;
      const blocks = rest ? ` <em>${topCards}</em>` : '';
      const prControl = marking === null ? '' : `<button class="lt-plat lt-prmark" data-prmark aria-pressed="${marking}" data-tip="${marking ? PR_MARK_ON_TITLE : PR_MARK_OFF_TITLE}">PR changes</button>`;
      const macroControl = available(source) ? `<button class="lt-plat" data-view="macro" aria-pressed="${on}" data-tip="${esc(graph && graph.level !== 'flat' ? MACRO_AREAS_TITLE : MACRO_TITLE)}">Macro${blocks}</button>` : '';
      const overviewControl = on && overview ? overviewButtonHtml(overview.open, overview.id) : '';
      const flowControl = flow ? flowButtonHtml(flow, uid) : '';
      const crumbs = on && graph ? crumbsHtml(graph) : '';
      return `<div class="lt-tabs-strip" role="group" aria-label="Graph view"><b>View</b><button class="lt-plat" data-view="files" aria-pressed="${filesOn}" data-tip="One node per source file">Files <em>${files}</em></button>${macroControl}${overviewControl}${flowControl}${prControl}</div>${crumbs}`;
    },
  };
}

export { createMacroMode };
export type { MacroFrame, MacroMode, ReadMacro };
