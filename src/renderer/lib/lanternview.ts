import type { Arrow, LanternMap, LanternNode } from '../../main/lantern';
import { activeGroups, arrangeLayout, collapseLayout, dirGroups, emptyFilters, isVisible, layoutGraph, resetFilters } from './lanternlayout';
import { collapseActive, collapsedGroups } from './lanterncollapse';
import { createScroller, motionOn } from './lanternmove';
import { denseColumn, relationLayout } from './lanternrelview';
import type { RelationLayout } from './lanternrelview';
import { ARROWS } from './lanternctx';
import { clearAllHtml, sideHtml, statsHtml } from './lanternside';
import { detailHtml, relationBlockHtml } from './lanterndetail';
import { LOCK_ICON, LOCK_TITLE, UNLOCK_TITLE, isLockKey, lockBarHtml } from './lanternlock';
import { fileLabel } from './util';
import { PRONLY_ICON, PRONLY_OFF_TITLE, PRONLY_ON_TITLE, hiddenNeighbours, hiddenNote, planHiddenNote, planOnlyLabel, planOnlySet, planOnlyTitle, prOnlyLabel, prOnlySet } from './lanternpronly';
import { effectivePlatform, inPlatform, profileOf, scopeOf } from './lanternscope';
import { neighbour, tabsHtml } from './lanterntabs';
import type { CodeSource, SemanticHighlightResult } from '../../shared/code-highlighting';
import { overlayKey, withOverlay } from './lanternoverlay';
import type { LanternPr, LanternPrOverlay } from '../../main/lantern';
import { openCodeModal } from './codemodal';
import type { ReadFile } from './codemodal';
import type { ReadDiff } from './prdiffmodal';
import { prFileReader } from './prfilereader';
import type { ReadPrFile } from './prfilereader';
import { createExplainHub } from './prexplain';
import type { PrExplainClient } from './prexplain';
import { createReviewPane } from './lanternreview';
import { createDiffCache } from './prdiffcache';
import type { ReviewMode, ReviewTarget } from './lanternreview';
import type { LocalReasonsResult } from '../../main/local-reasons';
import { mountPanes } from './lanternpanes';
import { browserStore } from './lanternpanewidths';
import { browserRegionStore, createRegions } from './lanternregions';
import { mountRegionTools } from './lanternregiontools';
import { mountSections } from './lanternsections/controller';
import { isSelectable, mountPrStrip } from './lanternprs';
import { fillDescriptions } from './lanternprdescribe';
import { prMarks, prPanelHtml, reviewSequence } from './lanternprpanel';
import type { PrPanelContext } from './lanternprpanel';
import type { StepNav } from './modalsteps';
import type { Filters, Layout, Pos } from './lanternlayout';
import type { SideContext } from './lanternctx';
import { PixiGraph } from './lantern-pixi';
import { mountGraphNavigation } from './graph-navigation';
import { createMacroMode } from './lanternmacroview';
import type { ReadMacro } from './lanternmacroview';
import { mountOverviewDrawer } from './lanternmacrodrawer';
import { macroSideHtml } from './lanternmacroside';
import { foundationFocus } from './lanternmacrofoundation';
import { openFileBlock } from './lanternmacrocurrent';
import { blockKey } from './lanternmacro';
import { areaOfFeature } from './lanternmacroareas';
import { createMacroNav } from './lanternmacronav';
import { macroPrView, planMacroMarks } from './lanternmacromarks';
import type { MacroPrView } from './lanternmacromarks';
import type { MacroLayout } from './lanternmacrolayout';
import { flowBar, flowHtml, flowOf, pickedStep, syncPick, syncReading } from './lanternflow';
import type { OpenFileBlock } from './lanternmacrocurrent';
import { itemPick, planFileMarks, planFilePaths, planFocus, planPick, questionPick, samePick, stagePick } from './lanternplanfocus';
import { createPlanAsk } from './lanternplanask';
import { FIX_PHASE, createPlanFix } from './lanternplanfix';
import type { PlanFix } from './lanternplanfix';
import { PLAN_EXT } from '../../../skills/lantern-plan/scripts/plan-format.mjs';
import { withPlanFiles } from './lanternplanfiles';
import type { PlanPick } from './lanternplanfocus';
import { createCopyFeedback } from './lanternplancopy';
import { planPanelHtml } from './lanternplanpanel';
import { restoreSelection, saveSelection } from './lanternplanselection';
import { planText } from './lanternplantext';
import { mountPlanStrip } from './lanternplanstrip';
import { holdPlanWindow } from './lanternplanwindow';
import { mountPlanColumn } from './lanternplancolumn';
import { VIEW, say } from '../../shared/lantern-plan-messages';
import { createMacroViewStage } from './macroview/stage';
import type { MacroViewContext } from './macroview/types';
import { isSelectingWithin } from './textselection';

function toggle<T>(list: T[], v: T) {
  const i = list.indexOf(v);
  if (i === -1) list.push(v);
  else list.splice(i, 1);
}

interface LanternView {
  update(data: LanternMap): void;
  selectPr(id: string): void;
  setFoldFiles(on: boolean): void;
  dispose(): void;
}

interface ViewOptions {
  project?: string;
  platform?: string;
  onPlatform?: (id: string) => void;
  section?: string;
  onSection?: (id: string) => void;
  readFile?: ReadFile;
  readSemantic?: (path: string, source: CodeSource) => Promise<SemanticHighlightResult>;
  readPrDiff?: ReadDiff;
  readPrFile?: ReadPrFile;
  readPrOverlay?: ReadPrOverlay;
  readMacro?: ReadMacro;
  explain?: PrExplainClient;
  explainCollapsed?: boolean;
  explainEnabled?: boolean;
  onExplainCollapsed?(collapsed: boolean): void;
  pr?: string;
  onPr?: (id: string) => void;
  now?: () => number;
  dismissedPrs?: string[];
  onDismissPr?: (id: string) => void;
  onRestorePrs?: () => void;
  onCompare?: (select: (id: string) => void) => void;
  onRemoveLocal?: (id: string) => Promise<void>;
  onGenerateReasons?: (id: string) => Promise<LocalReasonsResult>;
  onRefreshPrs?: () => Promise<{ ok: boolean; error?: string }>;
  onEnterPr?: (id: string) => void;
  onMapMissing?: () => void;
  foldFiles?: boolean;
  copy?: (text: string) => Promise<void>;
  planFix?: PlanFix;
}

type ViewName = 'files' | 'macro' | 'flow';
type ListFilter = 'roles' | 'dirs' | 'kinds' | 'features';

type ReadPrOverlay = (pr: string, lang: string) => Promise<LanternPrOverlay>;

const SEARCH_DELAY_MS = 200;
const CENTRE_LEAD_PX = 120;
const CENTRE_SIDE_ROOM_PX = 40;
const NO_TILES: ReadonlySet<string> = new Set();
const planningShows = new Map<string, 'macro' | 'files'>();
const planFolds = new Map<string, Map<string, boolean>>();
const EMPTY_LAYOUT: Layout = { cols: [], pos: new Map(), edges: [], width: 0, height: 0, count: 0 };

let viewSeq = 0;

function mountLanternView(root: HTMLElement, initial: LanternMap, opts: ViewOptions = {}): LanternView {
  const uid = String(++viewSeq);
  let source = initial;
  let data = initial;
  let base = initial;
  let planFilesKey = '';
  let prOverlay: LanternPrOverlay | null = null;
  let overlayAt: string | null = null;
  const overlays = new Map<string, LanternPrOverlay>();
  const overlaying = new Set<string>();
  let byPath = new Map<string, LanternNode>();
  let incoming = new Map<string, LanternMap['relations']>();
  const filters: Filters = emptyFilters();
  let selected: string | null = null;
  let showUnmapped = false;
  let prId: string | null = opts.pr || null;
  let prOnly = false;
  let prMarking = true;
  let flowOn = false;
  let flowPick: string | null = null;
  let planSlug: string | null = null;
  let planPicked: PlanPick | null = null;
  let cameFrom: { macro: boolean; flow: boolean; pr: string | null } | null = null;
  let refreshes = 0;
  let macroPrCache: { pr: LanternPr; shape: MacroLayout; data: LanternMap; view: MacroPrView | null } | null = null;
  let shown = { nodes: 0, edges: 0 };
  let layoutEdges: Layout['edges'] = [];
  let positions: Layout['pos'] = new Map();
  let baseLayout: Layout | null = null;
  let shownLayout: Layout | null = null;
  let shownLive: string | null = null;
  let shownTiles: Layout | null = null;
  let tilesCache: { base: Layout; sig: string; layout: Layout } | null = null;
  const expandedDirs = new Set<string>();
  const describeOpen = new Set<string>();
  let foldFiles = opts.foldFiles ?? true;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let relationMode = false;
  let hintDismissed = false;
  let drawnRelation: RelationLayout | null = null;
  let locked = false;
  let inspected: string | null = null;
  let lockNote = '';
  let peeked: string | null = null;
  let disposed = false;

  root.classList.add('lt-root');
  root.innerHTML = `<div class="lt-prs" role="group" aria-label="Pull requests" hidden></div><div class="lt-plans" role="group" aria-label="${say(VIEW.STRIP_LABEL)}" hidden></div><div class="lt-planbar" hidden><span class="lt-planbar-label">${say(VIEW.WINDOW_LABEL)}</span><button class="lt-planbar-leave" data-plan-leave data-tip="${say(VIEW.WINDOW_LEAVE_TITLE)}">${say(VIEW.WINDOW_LEAVE)}</button></div><div class="lt-toolbar"><div class="lt-viewbar" hidden></div><nav class="lt-tabs"></nav><nav class="lt-secs"></nav></div><div class="lt-grid"><aside class="lt-side"></aside><main class="lt-main" tabindex="0"><div class="lt-flow" hidden></div><div class="lt-macroview-host" hidden></div><div class="lt-graph-crumbs" hidden></div><div class="lt-pixi-host"></div><div class="lt-rvbar" hidden><div class="lt-rvbtns"><button class="lt-lock" data-lock aria-pressed="false" data-tip="${LOCK_TITLE}">${LOCK_ICON}<span>Lock</span></button><button class="lt-rvtoggle" data-relview aria-pressed="false" data-tip="Show only this file and its relations (Esc to leave)"><i aria-hidden="true"></i>Relation view</button><button class="lt-pronly" data-pronly aria-pressed="false" data-tip="${PRONLY_OFF_TITLE}" hidden>${PRONLY_ICON}<span>${prOnlyLabel(false, 0)}</span></button></div><p class="lt-prnote" role="status" hidden></p><p class="lt-prnote lt-mapnote" role="status" hidden></p></div></main><section class="lt-overlay" tabindex="-1" aria-label="Project section" hidden></section><section class="lt-planpane" hidden></section></div><p class="lt-sr" aria-live="polite"></p>`;
  const tabs = root.querySelector('.lt-tabs') as HTMLElement;
  const viewBar = root.querySelector('.lt-viewbar') as HTMLElement;
  const grid = root.querySelector('.lt-grid') as HTMLElement;
  const side = root.querySelector('.lt-side') as HTMLElement;
  const planPane = root.querySelector('.lt-planpane') as HTMLElement;
  const planBar = root.querySelector('.lt-planbar') as HTMLElement;
  const planColumn = mountPlanColumn(grid, planPane, opts.project ?? '');
  const writeClipboard = opts.copy ?? ((text: string) => navigator.clipboard.writeText(text));
  const planAsk = createPlanAsk({
    host: root,
    project: opts.project ?? '',
    copy: writeClipboard,
    plan: currentPlan,
    onChange: () => {
      if (!disposed) redrawSide();
    },
    onShow: showQuestion,
    onClose: (id) => {
      if (disposed) return;
      redrawSide();
      restoreFocusTo('data-plan-question', id);
    },
  });
  const planTextCopy = createCopyFeedback(writeClipboard, () => {
    if (!disposed && currentPlan()) redrawSide();
  });
  let planPaneHtml = '';
  const planFix = opts.planFix ?? createPlanFix({ copy: writeClipboard });
  const stopFixWatch = planFix.onChange(() => {
    if (!disposed && currentPlan()) redrawSide();
  });
  const drawer = mountOverviewDrawer(grid, uid, (open, hadFocus) => {
    drawTabs();
    const adrift = !document.activeElement || document.activeElement === document.body;
    if (!open && (hadFocus || adrift)) (viewBar.querySelector('[data-overview]') as HTMLElement | null)?.focus({ preventScroll: true });
  });
  const main = root.querySelector('.lt-main') as HTMLElement;
  const overlay = root.querySelector('.lt-overlay') as HTMLElement;
  const pixiHost = root.querySelector('.lt-pixi-host') as HTMLElement;
  const macroViewHost = root.querySelector('.lt-macroview-host') as HTMLElement;
  const graphCrumbs = root.querySelector('.lt-graph-crumbs') as HTMLElement;
  const stage = createMacroViewStage({ canvasHost: pixiHost, ownHost: macroViewHost });
  const live = root.querySelector('.lt-sr') as HTMLElement;
  const flowHost = root.querySelector('.lt-flow') as HTMLElement;
  const rvBar = root.querySelector('.lt-rvbar') as HTMLElement;
  const rvToggle = rvBar.querySelector('.lt-rvtoggle') as HTMLButtonElement;
  const lockToggle = rvBar.querySelector('.lt-lock') as HTMLButtonElement;
  const lockLabel = lockToggle.querySelector('span') as HTMLElement;
  const prOnlyToggle = rvBar.querySelector('.lt-pronly') as HTMLButtonElement;
  const prOnlyLabelEl = prOnlyToggle.querySelector('span') as HTMLElement;
  const prNote = rvBar.querySelector('.lt-prnote') as HTMLElement;
  const mapNote = rvBar.querySelector('.lt-mapnote') as HTMLElement;
  const scrollMain = createScroller(main);
  const macro = createMacroMode(opts.readMacro, () => {
    paintMacro();
    redrawSide();
    drawTabs();
  });
  const pixi = new PixiGraph({ host: pixiHost, scroll: main, onActivate: (key) => {
    if (macro.isOn()) return pickBlock(macro.selected() === key ? null : key);
    if (relationOn() && key === selected) return;
    select(selected === key ? null : key);
  }, onEnter: (key, byKeyboard) => nav.enter(key, byKeyboard), onBoundary: (path) => goTo(path), onExpand: expandDir, onBackground: () => {
    if (macro.isOn()) pickBlock(null);
    else if (locked) inspect(null);
    else if (selected && !relationOn()) select(null);
  }, onOpenCode: opts.readFile || opts.readPrFile ? openFileCode : undefined, onOpenDiff: opts.readPrDiff ? openPrDiff : undefined });
  const nav = createMacroNav({ macro, main, live, focus: (key) => pixi.focusNode(key), repaint: () => {
    paintMacro();
    redrawSide();
    drawTabs();
  } });
  const navigation = mountGraphNavigation({
    main,
    overlayHost: grid,
    isActive: () => overlay.hidden === true && !flowOn,
    yieldsKey: stepsFileOnMacro,
    applyOverscroll: (x, y) => {
      const layout = drawnRelation ?? shownLayout ?? baseLayout;
      if (!layout) return;
      pixi.setViewportOffset(x, y);
    },
    applyScale: (scale) => {
      const layout = drawnRelation ?? shownLayout ?? baseLayout;
      pixi.setViewportScale(scale);
      retile();
    },
  });
  const explainHub = opts.explain ? createExplainHub(opts.explain, { enabled: opts.explainEnabled, collapsed: opts.explainCollapsed, onCollapsed: opts.onExplainCollapsed }) : undefined;
  const diffCache = opts.readPrDiff ? createDiffCache(opts.readPrDiff, (id) => {
    const pick = data.prs.find((p) => p.id === id);
    return pick ? [pick.revision ?? pick.head ?? '', pick.base, pick.hostBase ?? ''].join('\0') : '';
  }) : undefined;
  const review = createReviewPane({
    readFile: opts.readFile || opts.readPrFile ? readForReview : undefined,
    readDiff: diffCache?.read,
    readSemantic: opts.readSemantic,
    explain: explainHub,
    comments: { project: opts.project, language: () => source.language.code, openFile: (path) => reveal(path, review.mode()) },
    onStep: stepTo,
  });
  const regions = createRegions(browserRegionStore(opts.project));
  const panes = mountPanes(grid, side, review.el, { regions, main, store: browserStore(opts.project) });
  const regionTools = mountRegionTools({ grid, side, viewer: review.el, main, regions, foundationPresent: () => macro.hasFoundation(), reset: () => panes.reset(), say: (text) => { live.textContent = text; } });
  regions.onChange(applyFoundationHidden);
  const prStrip = mountPrStrip({ el: root.querySelector('.lt-prs') as HTMLElement, onSelect: (id) => setPr(id === prId ? null : id),
    dismissed: opts.dismissedPrs,
    onDismiss: (id) => {
      opts.onDismissPr?.(id);
      if (prId === id) setPr(null);
    },
    onRestore: () => opts.onRestorePrs?.(),
    onCompare: opts.onCompare ? () => opts.onCompare?.((id) => setPr(id)) : undefined,
    onRemoveLocal: (id) => {
      if (prId === id) setPr(null);
      void opts.onRemoveLocal?.(id);
    },
    now: opts.now,
  });
  const planStrip = mountPlanStrip(root.querySelector('.lt-plans') as HTMLElement, (slug) => openPlan(slug === planSlug ? null : slug));
  const sections = mountSections(
    { root, bar: root.querySelector('.lt-secs') as HTMLElement, grid: root.querySelector('.lt-grid') as HTMLElement, side, main, overlay: root.querySelector('.lt-overlay') as HTMLElement, onCite: (path) => goTo(path, true), onOpenCode: opts.readFile ? openCode : undefined, onChange: (id) => opts.onSection?.(id) },
    opts.section ?? '',
  );

  function openCode(path: string, symbol: string) {
    if (opts.readFile) openCodeModal(root, opts.readFile, path, symbol, undefined, undefined, opts.readSemantic);
  }

  function reasonOf(path: string) {
    return currentPr()?.files.find((f) => f.path === path)?.reason;
  }

  function stepsFor(path: string): StepNav | undefined {
    const pr = currentPr();
    if (!pr) return undefined;
    const files = reviewSequence(pr);
    const index = files.findIndex((f) => f.path === path);
    return index < 0 ? undefined : { files: files.map((f) => ({ path: f.path, ...(f.reason ? { reason: f.reason } : {}) })), index };
  }

  function readForReview(path: string) {
    const pr = currentPr();
    const changed = !!pr && pr.files.some((f) => f.path === path);
    const fromPr = pr && opts.readPrFile ? prFileReader(opts.readPrFile, pr.id) : undefined;
    const read = fromPr && (changed || !opts.readFile) ? fromPr : opts.readFile;
    return read ? read(path) : Promise.reject(new Error('no file reader'));
  }

  function graphless() {
    return macro.isOn() || flowOn;
  }

  function reviewPath() {
    return peeked ?? (locked && inspected ? inspected : selected);
  }

  function reviewTarget(): ReviewTarget | null {
    const pr = currentPr();
    const path = reviewPath();
    if (!pr || !path) return null;
    return { pr: pr.id, path, title: pr.title, branch: pr.branch, order: reviewSequence(pr).map((f) => f.path), reason: reasonOf(path), head: pr.head, version: pr.revision ?? pr.head, nav: stepsFor(path) };
  }

  function applyFoundationHidden() {
    const hidden = !!currentPr() && regions.isHidden('foundation');
    if (macro.setFoundationHidden(hidden) && macro.isOn()) {
      paintMacro();
      redrawSide();
      drawTabs();
    }
    regionTools.paint();
  }

  function syncReview() {
    const pr = currentPr();
    panes.setActive(!!pr);
    regionTools.setActive(!!pr);
    applyFoundationHidden();
    const off = pr && peeked && !byPath.has(peeked) ? peeked : null;
    mapNote.textContent = off ? `${off.split('/').pop()} is not in the map, so there are no connections to show.` : '';
    mapNote.hidden = !off;
    const target = pr ? reviewTarget() : null;
    review.show(target);
    if (target && diffCache) diffCache.preload(target.pr, target.order ?? [], target.path);
    else diffCache?.stop();
  }

  function reveal(path: string, mode: ReviewMode, takeFocus = true) {
    review.prefer(mode);
    peeked = null;
    if (!byPath.has(path)) {
      if (!locked && selected) select(null);
      peeked = path;
      redrawSide();
    } else if (graphless() && !locked) {
      selected = path;
      redrawSide();
    } else if (locked && inspected === path) redrawSide();
    else goTo(path, true);
    if (macro.isOn()) paintMacro();
    if (takeFocus) review.focus();
  }

  function stepTo(path: string) {
    const held = document.activeElement as HTMLElement | null;
    reveal(path, review.mode(), false);
    if (held && review.el.contains(held)) held.focus({ preventScroll: true });
    else review.focus();
  }

  function openFileCode(path: string) {
    if (currentPr()) reveal(path, 'file');
    else openCode(path, '');
  }

  function openPrDiff(path: string) {
    if (opts.readPrDiff && currentPr()) reveal(path, 'diff');
  }

  function composeData() {
    base = withOverlay(source, prOverlay);
    const fresh = viewFocus()?.fresh ?? new Map<string, string>();
    planFilesKey = [...fresh].join('\0');
    data = withPlanFiles(base, fresh);
  }

  function syncPlanFiles() {
    const key = [...(viewFocus()?.fresh ?? [])].join('\0');
    if (key === planFilesKey) return false;
    composeData();
    index();
    return true;
  }

  function wantedOverlay() {
    return overlayKey(currentPr(), source.language.code);
  }

  function applyOverlay() {
    const key = opts.readPrOverlay ? wantedOverlay() : null;
    if (key === overlayAt && (!key || prOverlay)) return false;
    overlayAt = key;
    prOverlay = key ? (overlays.get(key) ?? null) : null;
    composeData();
    if (key && !prOverlay) void fetchOverlay(key);
    return true;
  }

  async function fetchOverlay(key: string) {
    const read = opts.readPrOverlay;
    const pr = currentPr();
    if (!read || !pr || overlaying.has(key)) return;
    overlaying.add(key);
    let got: LanternPrOverlay;
    try {
      got = await read(pr.id, source.language.code);
    } catch {
      overlaying.delete(key);
      return;
    }
    overlaying.delete(key);
    if (disposed) return;
    overlays.set(key, got);
    if (wantedOverlay() !== key || !got.nodes.length) return;
    prOverlay = got;
    composeData();
    index();
    refresh();
  }

  function index() {
    byPath = new Map(data.nodes.map((n) => [n.path, n]));
    incoming = new Map();
    for (const r of data.relations) if (r.to) incoming.set(r.to, [...(incoming.get(r.to) ?? []), r]);
    if (selected && !byPath.has(selected)) selected = null;
    if (inspected && !byPath.has(inspected)) inspected = null;
    if (!selected) {
      relationMode = false;
      if (locked) dropLock('The locked file is no longer in the map, so it is unlocked.');
    }
    if (prId && !currentPr()) setPr(null, false);
    if (planSlug && !currentPlan()) closePlan();
    if (planPicked && !planFocus(currentPlan(), planPicked)) planPicked = null;
  }

  function currentPr() {
    const pick = prId ? data.prs.find((p) => p.id === prId) : undefined;
    return pick && isSelectable(pick, opts.now?.() ?? Date.now()) ? pick : undefined;
  }

  function currentPlan() {
    return planSlug ? base.plans.find((p) => p.slug === planSlug) : undefined;
  }

  function closePlan() {
    planAsk.close();
    if (planSlug) prOnly = false;
    holdPlanWindow(uid, null);
    planSlug = null;
    planPicked = null;
    cameFrom = null;
  }

  function planningKey() {
    return opts.project ?? '';
  }

  function foldsOf(slug: string) {
    const key = `${planningKey()}\u0000${slug}`;
    const known = planFolds.get(key);
    if (known) return known;
    const fresh = new Map<string, boolean>();
    planFolds.set(key, fresh);
    return fresh;
  }

  function foldPlan(key: string) {
    const plan = currentPlan();
    if (!plan) return;
    const folds = foldsOf(plan.slug);
    const button = [...planPane.querySelectorAll<HTMLElement>('[data-plan-fold]')].find((el) => el.getAttribute('data-plan-fold') === key);
    const shown = button?.getAttribute('aria-expanded') === 'true';
    folds.set(key, !shown);
    redrawSide();
    restoreFocusTo('data-plan-fold', key);
  }

  function showView(view: ViewName) {
    const before = refreshes;
    setView(view);
    if (refreshes === before) refresh();
  }

  function openPlan(slug: string | null) {
    if (slug === planSlug) return;
    if (!slug) return leavePlan();
    if (!planSlug) cameFrom = { macro: macro.isOn(), flow: flowOn, pr: prId };
    planPicked = null;
    planSlug = slug;
    if (prId) setPr(null, false);
    const wanted = planningShows.get(planningKey()) ?? 'macro';
    showView(wanted === 'macro' && macro.available(source) ? 'macro' : 'files');
  }

  function leavePlan() {
    const back = cameFrom;
    closePlan();
    if (back?.pr) setPr(back.pr, false);
    const view: ViewName = back?.flow && flowOf(currentPr()) ? 'flow' : back?.macro && macro.available(source) ? 'macro' : 'files';
    showView(view);
  }

  function restoreFocusTo(attr: string, value: string) {
    [...planPane.querySelectorAll<HTMLElement>(`[${attr}]`)].find((el) => el.getAttribute(attr) === value)?.focus({ preventScroll: true });
  }

  function pickPlan(next: PlanPick | null, attr = '', value = '') {
    planPicked = samePick(planPicked, next) ? null : next;
    const regrouped = syncPlanFiles();
    if (macro.isOn()) paintMacro();
    else if (regrouped || prOnly) refresh();
    else {
      applyMarks();
      retile();
    }
    redrawSide();
    if (attr) restoreFocusTo(attr, value);
  }

  function planPanel(plan: NonNullable<ReturnType<typeof currentPlan>>) {
    const now = opts.now?.() ?? Date.now();
    const selectablePrs = new Set(data.prs.filter((p) => isSelectable(p, now)).map((p) => p.id));
    return planPanelHtml(plan, { pick: planPicked, selectablePrs, shown: macro.isOn() ? 'macro' : 'files', macroAvailable: macro.available(source), folds: foldsOf(plan.slug), map: base, notes: planAsk.notes(plan.slug).all(), copied: planAsk.copied(), textCopied: planTextCopy.copied(), fix: planFix });
  }

  function copyPlanText() {
    const plan = currentPlan();
    if (plan) void planTextCopy.copy(planText(plan)).then(() => !disposed && redrawSide());
  }

  function copyFix() {
    const plan = currentPlan();
    if (plan) void planFix.copy({ file: `${plan.slug}${PLAN_EXT}`, problems: plan.problems, error: null });
  }

  function runFix(file: string) {
    if (planFix.state(file).phase === FIX_PHASE.RUNNING) planFix.cancel(file);
    else planFix.run(file);
  }

  function settleFixes() {
    const sick = source.plans.filter((plan) => plan.problems.length).map((plan) => `${plan.slug}${PLAN_EXT}`);
    planFix.settle(new Set([...sick, ...source.brokenPlans.map((broken) => broken.file)]));
  }

  function showQuestion(id: string) {
    if (!planSlug) return;
    const next = questionPick(planSlug, id);
    if (!samePick(planPicked, next)) pickPlan(next, 'data-plan-question', id);
  }

  function planFocusNow() {
    return planFocus(currentPlan(), planPicked, base);
  }

  function viewFocus() {
    const plan = currentPlan();
    return planFocusNow() ?? (prOnly && plan ? planFocus(plan, planPick(plan.slug), base) : null);
  }

  function macroPlanFocus() {
    const focus = planFocusNow();
    return focus && (focus.paths.size || focus.ids.size) ? focus : null;
  }

  function planFlatMarks() {
    const focus = macroPlanFocus();
    const frame = macro.frame();
    return focus && frame.shape && frame.loaded ? planMacroMarks(frame.shape.graph, focus, frame.loaded.blockByPath) : undefined;
  }

  function planFilesMarks() {
    return planFileMarks(viewFocus());
  }

  function setPr(id: string | null, redraw = true) {
    if (id === prId) return;
    if (id) closePlan();
    prId = id;
    peeked = null;
    flowPick = null;
    if (!id) prOnly = false;
    opts.onPr?.(id ?? '');
    if (id && data.prs.find((p) => p.id === id)?.source !== 'local') opts.onEnterPr?.(id);
    if (applyOverlay()) {
      filters.platform = effectivePlatform(data, filters.platform);
      index();
    }
    if (redraw) refresh();
  }

  filters.platform = effectivePlatform(data, opts.platform ?? '');

  function showHost(flow: boolean) {
    if (flow || !macro.isOn()) stage.drop();
    pixiHost.hidden = flow;
    flowHost.hidden = !flow;
    main.classList.toggle('lt-flow-on', flow);
  }

  function paintFlow() {
    const pr = currentPr();
    main.querySelector('.lt-none')?.remove();
    rvBar.hidden = true;
    flowHost.innerHTML = pr ? flowHtml(pr, uid, flowPick) : '';
    syncFlowReading();
    navigation.setContent(0);
  }

  function syncFlowReading() {
    const pr = currentPr();
    syncReading(flowHost, viewBar, pr, flowOn && pr ? reviewPath() : null);
  }

  function pickedNow() {
    return pickedStep(currentPr(), flowPick);
  }

  function pickFlowStep(key: string | null) {
    flowPick = key === flowPick ? null : key;
    syncPick(flowHost, flowPick);
    redrawSide();
  }

  function clearFlowPick() {
    if (!flowPick) return;
    flowPick = null;
    syncPick(flowHost, null);
    if (macro.isOn()) paintMacro();
    else applyMarks();
    redrawSide();
  }

  function dropFlowWithoutPr() {
    if (flowOn && !flowOf(currentPr())) flowOn = false;
  }

  function drawGraph() {
    dropFlowWithoutPr();
    showHost(flowOn);
    if (flowOn) return paintFlow();
    if (macro.isOn()) return paintMacro();
    filters.only = onlyPaths();
    if (filters.only && inspected && !filters.only.has(inspected)) inspected = null;
    const L: Layout = layoutGraph(data, filters);
    shown = { nodes: L.count, edges: L.edges.length };
    layoutEdges = L.edges;
    baseLayout = L;
    paintGraph(false);
  }

  function paintMacro() {
    const frame = macro.frame();
    main.querySelector('.lt-none')?.remove();
    rvBar.hidden = true;
    if (!frame.shape) {
      const msg = document.createElement('div');
      msg.className = 'lt-none';
      msg.textContent = frame.error ? `The macro view could not be loaded: ${frame.error}` : 'Loading the macro view…';
      main.insertBefore(msg, pixiHost);
      navigation.setContent(0);
      stage.drop();
      pixi.render({ layout: EMPTY_LAYOUT, selected: null, locked: false, inspected: null, marks: null, near: NO_TILES, profile: profileOf(data, ''), animate: false });
      return;
    }
    nav.announce();
    const ctx = macroViewContext(frame);
    if (!ctx) {
      stage.drop();
      return paintFlat();
    }
    stage.paint(ctx);
    navigation.setContent(0);
  }

  function paintFlat() {
    const frame = macro.frame();
    if (!frame.shape) return;
    navigation.setContent(frame.shape.layout.width);
    const open = openFileNow();
    pixi.render({ layout: frame.shape.layout, macro: frame.shape, macroMarks: macroPrNow()?.marks ?? planFlatMarks(), macroCurrent: readingBlocks(open), macroCalm: !!open || !!pickedNow(), selected: macro.selected(), locked: false, inspected: null, marks: null, near: macro.near(), nearWeak: macro.nearWeak(), profile: profileOf(data, ''), animate: false });
  }

  function macroViewContext(frame: ReturnType<typeof macro.frame>): MacroViewContext | null {
    const { payload } = frame;
    if (!payload?.areas || !frame.shape) return null;
    const open = openFileNow();
    return {
      payload: { view: payload.view, texts: payload.texts, blockByPath: payload.blockByPath, systemsByPath: payload.systemsByPath, minStrongEdge: payload.minStrongEdge, areas: payload.areas },
      scene: frame.shape.graph,
      prMarks: macroPrNow(),
      plan: macroPlanFocus(),
      reading: { file: open, blocks: readingBlocks(open) },
      flowStep: pickedNow(),
      selection: macro.selected(),
      foundation: foundationFocus(frame.shape.graph, payload.areas, macro.selected()),
      openFile: (path) => reveal(path, review.mode(), false),
      select: pickBlock,
      enter: (key) => nav.enter(key, true),
      leave: () => nav.leave(),
    };
  }

  function macroPrNow(): MacroPrView | null {
    const pr = prMarking && macro.isOn() ? currentPr() : undefined;
    const frame = macro.frame();
    if (!pr || !frame.shape) return null;
    if (macroPrCache?.pr !== pr || macroPrCache.shape !== frame.shape || macroPrCache.data !== data) macroPrCache = { pr, shape: frame.shape, data, view: macroPrView(frame, pr, source, data) };
    return macroPrCache.view;
  }

  function openFileNow() {
    if (!macro.isOn() || !currentPr()) return null;
    const path = reviewPath();
    return openFileBlock(macro.frame(), path, path ? byPath.get(path) : undefined);
  }

  function readingBlocks(open: OpenFileBlock | null): ReadonlySet<string> {
    const keys = new Set<string>();
    if (open?.blockKey) keys.add(open.blockKey);
    for (const path of pickedNow()?.files ?? []) {
      const block = openFileBlock(macro.frame(), path, byPath.get(path))?.blockKey;
      if (block) keys.add(block);
    }
    return keys;
  }

  function setPrMarking(on: boolean) {
    if (on === prMarking) return;
    prMarking = on;
    paintMacro();
    redrawSide();
    drawTabs();
  }

  function pickBlock(key: string | null) {
    macro.select(key);
    paintMacro();
    redrawSide();
  }

  function pickArea(key: string) {
    if (macro.frame().shape?.graph.level === 'area') nav.leave();
    pickBlock(key);
  }

  function pickFeature(id: string) {
    const frame = macro.frame();
    const area = areaOfFeature(frame.payload?.areas, id);
    const inside = frame.shape?.graph.level === 'area' ? frame.shape.graph.area?.id : null;
    if (area && area.id !== inside) nav.enter(blockKey(area.id));
    pickBlock(blockKey(id));
  }

  function setView(view: ViewName) {
    const wantMacro = view === 'macro';
    const wantFlow = view === 'flow';
    if (wantMacro === macro.isOn() && wantFlow === flowOn) return;
    if ((wantMacro && !macro.available(source)) || (wantFlow && !flowOf(currentPr()))) return;
    macro.set(wantMacro);
    if (!wantMacro) nav.silence();
    flowOn = wantFlow;
    main.scrollTop = 0;
    main.scrollLeft = 0;
    refresh();
  }

  function paintGraph(animate: boolean) {
    if (flowOn) return paintFlow();
    if (macro.isOn()) return paintMacro();
    const L = baseLayout as Layout;
    const live = selected && L.pos.has(selected) ? selected : null;
    if (!live) relationMode = false;
    if (!live && locked) dropLock(`${fileLabel(selected as string)} is hidden by the filters, so it is unlocked.`);
    main.querySelector('.lt-none')?.remove();
    syncBar(!!live, relationMode);
    if (!L.count) {
      const msg = document.createElement('div');
      msg.className = 'lt-none';
      msg.textContent = emptyMessage();
      main.insertBefore(msg, pixiHost);
      navigation.setContent(0);
      renderPixi(null, { tiles: L, layout: L }, undefined, animate);
    } else if (relationMode && live) {
      const relation = relationLayout(L, live);
      drawnRelation = relation;
      const layout = relationAsLayout(L, relation);
      navigation.setContent(layout.width);
      renderPixi(live, { tiles: layout, layout }, relation, animate);
    } else {
      drawnRelation = null;
      navigation.setContent(L.width);
      renderPixi(live, undefined, undefined, animate);
    }
  }

  function relationAsLayout(base: Layout, relation: RelationLayout): Layout {
    const pos = new Map<string, Pos>();
    for (const [key, placed] of relation.pos) {
      const original = base.pos.get(key);
      if (original) pos.set(key, { ...placed, col: original.col });
    }
    return { ...base, pos, cols: [], edges: [], width: relation.width, height: relation.height, count: relation.count };
  }

  function emptyMessage() {
    if (!filters.only) return 'No file matches these filters. Clear a role or directory to bring files back.';
    if (!filters.only.size && !currentPr()) return say(VIEW.PLANONLY_EMPTY);
    if (!filters.only.size) return 'None of this pull request’s files are in the map, so there is nothing to show. Turn off “Show only PR files” to bring the graph back.';
    if (!currentPr()) return say(VIEW.PLANONLY_NO_MATCH);
    return 'No file of this pull request matches these filters. Turn off “Show only PR files” or clear a filter to bring files back.';
  }


  function centreInView(from: number, animate: boolean) {
    const p = drawnRelation?.pos.get(drawnRelation.centre);
    const scale = navigation.scale();
    const high = !p || !main.clientHeight || (p.y + p.h) * scale + CENTRE_LEAD_PX / 2 <= main.clientHeight;
    const near = !p || !main.clientWidth || (p.x + p.w) * scale + CENTRE_SIDE_ROOM_PX <= main.clientWidth;
    scrollMain(from, high || !p ? 0 : p.y * scale - CENTRE_LEAD_PX, animate);
    main.scrollLeft = near || !p ? 0 : Math.max(0, p.x * scale - (main.clientWidth - p.w * scale) / 2);
  }

  function onlyPaths() {
    if (!prOnly) return null;
    const pr = currentPr();
    if (pr) return prOnlySet(pr, byPath);
    const focus = viewFocus();
    return focus ? planOnlySet(focus, byPath) : null;
  }

  function syncPrOnly() {
    const planning = !currentPr() && !!currentPlan();
    const available = !!currentPr() || planning;
    prOnlyToggle.hidden = !available;
    prOnlyToggle.setAttribute('aria-pressed', String(prOnly));
    prOnlyToggle.dataset.tip = planning ? planOnlyTitle(prOnly) : prOnly ? PRONLY_ON_TITLE : PRONLY_OFF_TITLE;
    prOnlyLabelEl.textContent = planning ? planOnlyLabel(prOnly, shown.nodes) : prOnlyLabel(prOnly, shown.nodes);
    const hidden = prOnly && selected && filters.only && baseLayout?.pos.has(selected) ? hiddenNeighbours(data.relations, byPath, filters.only, selected) : 0;
    prNote.textContent = planning ? planHiddenNote(hidden) : hiddenNote(hidden);
    prNote.hidden = !hidden;
    return available;
  }

  function setPrOnly(on: boolean) {
    if (on === prOnly || (on && !currentPr() && !currentPlan())) return;
    prOnly = on;
    syncPlanFiles();
    refresh();
  }

  function syncBar(available: boolean, active: boolean) {
    const prOpen = syncPrOnly();
    rvBar.hidden = macro.isOn() || flowOn || (!available && !prOpen);
    rvToggle.hidden = !available;
    lockToggle.hidden = !available;
    rvToggle.setAttribute('aria-pressed', String(active));
    lockToggle.setAttribute('aria-pressed', String(locked));
    lockToggle.dataset.tip = locked ? UNLOCK_TITLE : LOCK_TITLE;
    lockLabel.textContent = locked ? 'Locked' : 'Lock';
  }

  function applyMarks() {
    if (shownLayout && !macro.isOn() && !flowOn) renderPixi(liveOf(selected), { tiles: shownTiles ?? shownLayout, layout: shownLayout }, drawnRelation ?? undefined);
  }

  function dropLock(note: string) {
    locked = false;
    inspected = null;
    lockNote = note;
  }

  function setLock(on: boolean) {
    if (on === locked || (on && !canRelate())) return;
    locked = on;
    inspected = null;
    lockNote = '';
    applyMarks();
    syncBar(canRelate(), relationOn());
    redrawDetail();
  }

  function inspect(key: string | null) {
    peeked = null;
    inspected = key && key !== selected && key !== inspected && byPath.has(key) ? key : null;
    lockNote = '';
    applyMarks();
    retile();
    redrawDetail();
    (side.querySelector('.lt-lockbar') as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }

  function moveLock() {
    if (!locked || !inspected || !baseLayout?.pos.has(inspected)) return;
    selected = inspected;
    inspected = null;
    lockNote = '';
    refresh(false);
  }

  function pinnedFiles(live: string | null) {
    const pinned = new Set<string>();
    if (live) pinned.add(live);
    if (inspected) pinned.add(inspected);
    for (const file of currentPr()?.files ?? []) pinned.add(file.path);
    const focus = viewFocus();
    for (const path of focus ? planFilePaths(focus) : []) pinned.add(path);
    if (filters.q.trim() && baseLayout) for (const [key, p] of baseLayout.pos) if (p.item.node) pinned.add(key);
    return pinned;
  }

  function tilesFor(live: string | null) {
    const base = baseLayout as Layout;
    const groups = dirGroups(base);
    const scale = navigation.scale();
    const active = foldFiles && collapseActive(groups.reduce((sum, g) => sum + g.keys.length, 0), scale);
    if (!active) expandedDirs.clear();
    const collapsed = active ? collapsedGroups({ groups, scale, expanded: expandedDirs, pinned: pinnedFiles(live) }) : NO_TILES;
    const sig = [...collapsed].sort().join('\n');
    if (tilesCache?.base === base && tilesCache.sig === sig) return tilesCache.layout;
    const layout = collapseLayout(base, collapsed);
    tilesCache = { base, sig, layout };
    return layout;
  }

  function pixiArrangement(live: string | null) {
    const tiles = tilesFor(live);
    return { tiles, layout: live ? arrangeLayout(tiles, nearOf(live, tiles.edges)) : tiles };
  }

  function renderPixi(live: string | null, arranged = pixiArrangement(live), relation?: RelationLayout, animate = false) {
    const { tiles, layout } = arranged;
    shownTiles = tiles;
    shownLayout = layout;
    shownLive = live;
    positions = layout.pos;
    const active = currentPr();
    pixi.render({ layout, relation, selected: live, locked, inspected, marks: active ? prMarks(active, pickedNow()?.files) : planFilesMarks(), near: live ? nearOf(live, layout.edges) : new Set(), profile: profileOf(data, filters.platform), animate });
  }

  function liveOf(key: string | null) {
    return key && baseLayout?.pos.has(key) ? key : null;
  }

  function expandDir(id: string) {
    if (!baseLayout || macro.isOn() || flowOn) return;
    expandedDirs.add(id);
    renderPixi(liveOf(selected));
  }

  function retile() {
    if (!baseLayout || disposed || drawnRelation || macro.isOn() || flowOn) return;
    const live = liveOf(selected);
    if (tilesFor(live) !== shownTiles) renderPixi(live);
  }

  function nearOf(live: string, edges = layoutEdges) {
    const near = new Set<string>([live]);
    for (const e of edges) {
      if (e.fromKey === live) near.add(e.toKey);
      else if (e.toKey === live) near.add(e.fromKey);
    }
    return near;
  }

  function scrollTarget(prev: string | null, live: string | null, base = baseLayout) {
    if (!base || !main.clientHeight) return null;
    if (live) return 0;
    const home = prev ? (base.pos.get(prev) ?? base.pos.get(base.tileOf?.get(prev) ?? '')) : undefined;
    if (!home) return null;
    const y = home.y * scaleOf();
    const fits = y >= main.scrollTop && y + home.h <= main.scrollTop + main.clientHeight;
    return fits ? null : y - main.clientHeight / 2;
  }

  function scaleOf() {
    return navigation.scale();
  }

  function sidewaysTarget(p: Pos | undefined, scale: number) {
    if (!p || !main.clientWidth) return null;
    const x = p.x * scale;
    const w = p.w * scale;
    const fits = x >= main.scrollLeft && x + w <= main.scrollLeft + main.clientWidth;
    return fits ? null : Math.max(0, x - (main.clientWidth - w) / 2);
  }

  function focusOn(key: string | null, animate: boolean) {
    if (!baseLayout || flowOn) return;
    const live = liveOf(key);
    const arranged = pixiArrangement(live);
    const target = scrollTarget(shownLive, live, arranged.layout);
    const scale = pixi.viewportScale();
    const top0 = main.scrollTop;
    const left = live ? sidewaysTarget(arranged.layout.pos.get(live), scale) : null;
    const moved = live !== shownLive && animate && motionOn();
    renderPixi(live, arranged, undefined, moved);
    if (target !== null) scrollMain(top0, target, moved);
    if (left !== null) main.scrollLeft = left;
  }

  function sideContext(): SideContext {
    const relation = relationOn();
    const dense = selected && baseLayout && !relation && !hintDismissed ? denseColumn(baseLayout, selected) : null;
    return { uid, data, byPath, incoming, filters, selected, showUnmapped, shown, scope: scopeOf(data, filters.platform), profile: profileOf(data, filters.platform), canOpenCode: !!opts.readFile, relationView: relation, canRelate: canRelate(), dense, locked, inspected: locked ? inspected : null, lockNote, canMoveLock: !!inspected && !!baseLayout?.pos.has(inspected) };
  }

  let reasons: { id: string; busy: boolean; note: string } | null = null;

  function prRowsContext(pr: LanternPr, activeFilters: number): PrPanelContext {
    return { pr, byPath, selected: reviewPath(), canOpenCode: !!opts.readFile, canOpenDiff: !!opts.readPrDiff, canOpenPrCode: !!opts.readPrFile, activeFilters, flowStep: pickedNow(), canGenerateReasons: !!opts.onGenerateReasons, canMapMissing: !!opts.onMapMissing, unmapped: new Set(data.unmapped), reasonsBusy: !!reasons?.busy, reasonsRunning: reasons?.id === pr.id && reasons.busy, reasonsNote: reasons?.id === pr.id ? reasons.note : '', canRefresh: !!opts.onRefreshPrs, refreshBusy: !!refreshing?.busy, refreshNote: refreshing?.id === pr.id ? refreshing.note : '' };
  }

  let refreshing: { id: string; busy: boolean; note: string } | null = null;

  async function refreshPr() {
    const id = prId;
    if (!id || !opts.onRefreshPrs || refreshing?.busy) return;
    refreshing = { id, busy: true, note: '' };
    redrawSide();
    focusRefreshRow();
    let note = '';
    try {
      const result = await opts.onRefreshPrs();
      note = result.ok ? '' : `Could not refresh: ${result.error ?? 'unknown error'}`;
    } catch (e) {
      note = `Could not refresh: ${(e as Error).message}`;
    } finally {
      refreshing = { id, busy: false, note };
      live.textContent = note || 'Pull request refreshed.';
      if (prId === id) {
        redrawSide();
        focusRefreshRow();
      }
    }
  }

  function focusRefreshRow() {
    (side.querySelector('.pr-refresh-row') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  async function generateReasons() {
    const id = prId;
    if (!id || !opts.onGenerateReasons || reasons?.busy) return;
    reasons = { id, busy: true, note: '' };
    redrawSide();
    focusReasonsRow();
    let note = '';
    try {
      const result = await opts.onGenerateReasons(id);
      note = result.ok ? [result.left ? `${result.left} more to write: click again.` : '', result.skipped ? `${result.skipped} with nothing in the diff to read.` : ''].filter(Boolean).join(' ') : result.error;
    } catch (e) {
      note = (e as Error).message;
    } finally {
      reasons = { id, busy: false, note };
      live.textContent = note || 'Reasons written.';
      if (prId === id) {
        redrawSide();
        focusReasonsRow();
      }
    }
  }

  function focusReasonsRow() {
    (side.querySelector('.pr-reasons-row') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function drawDescription(pr: LanternPr) {
    fillDescriptions(
      side,
      pr,
      () => describeOpen.has(pr.id),
      () => {
        if (!describeOpen.delete(pr.id)) describeOpen.add(pr.id);
      },
    );
  }

  function paintPlanPane(html: string) {
    if (html === planPaneHtml && planPane.firstChild) return;
    const selected = saveSelection(planPane);
    planPane.innerHTML = html;
    planPaneHtml = html;
    if (selected) restoreSelection(planPane, selected);
  }

  function drawSide() {
    const pr = currentPr();
    const plan = pr ? undefined : currentPlan();
    grid.classList.toggle('lt-planning', !!plan);
    planPane.hidden = !plan;
    planBar.hidden = !plan;
    holdPlanWindow(uid, plan ? root : null);
    planColumn.setActive(!!plan);
    if (plan) paintPlanPane(planPanel(plan));
    else {
      planPane.textContent = '';
      planPaneHtml = '';
    }
    const top = pr ? `<div class="lt-side-list">${prPanelHtml(prRowsContext(pr, activeGroups(filters, showUnmapped)))}</div>` : '';
    const overviewOnly = macro.isOn() && !top && !plan;
    grid.classList.toggle('lt-side-none', overviewOnly);
    if (!macro.isOn()) drawer.set(false, true);
    if (macro.isOn()) {
      const prView = macroPrNow();
      const rows = prView ? prRowsContext(prView.pr, 0) : null;
      drawer.fill(macroSideHtml(data, macro.frame(), macro.selected(), prView && rows ? { view: prView, rows } : null, openFileNow()));
      side.innerHTML = top;
      if (pr) drawDescription(pr);
      regionTools.attachList();
      return;
    }
    if (plan) {
      side.innerHTML = '';
      return;
    }
    side.innerHTML = pr ? prPanelHtml(prRowsContext(pr, activeGroups(filters, showUnmapped))) : sideHtml(sideContext());
    if (pr) drawDescription(pr);
    if (pr && filters.only) {
      const template = document.createElement('template');
      template.innerHTML = statsHtml(sideContext());
      (side.querySelector('.clear-all') ?? side.querySelector('.pr-head'))?.after(template.content);
    }
    regionTools.attachList();
  }

  function redrawDetail() {
    const anchor = side.querySelector('.coverage');
    if (!anchor || currentPr() || currentPlan()) return redrawSide();
    const template = document.createElement('template');
    template.innerHTML = detailHtml(sideContext());
    side.querySelector('.lt-lockbar')?.remove();
    side.querySelector('.lt-detail')?.remove();
    anchor.after(template.content);
  }

  function swapBlock(selector: string, html: string, anchor?: string) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const old = side.querySelector(selector);
    if (old) old.replaceWith(template.content);
    else if (anchor) side.querySelector(anchor)?.after(template.content);
  }

  function applySearch() {
    searchTimer = undefined;
    const wasLocked = locked;
    drawGraph();
    const ctx = sideContext();
    swapBlock('.stats', statsHtml(ctx));
    if (wasLocked !== locked) redrawDetail();
    else {
      swapBlock('.lt-lockbar', lockBarHtml(ctx), '.coverage');
      swapBlock('.rv-block', relationBlockHtml(ctx), '.lt-detail .state');
    }
    swapBlock('.clear-all', clearAllHtml(activeGroups(filters, showUnmapped)), '.search');
  }

  function drawTabs() {
    tabs.innerHTML = tabsHtml(data, filters.platform);
    dropFlowWithoutPr();
    tabs.hidden = macro.isOn() || flowOn;
    viewBar.innerHTML = macro.barHtml(source, { files: data.nodes.length, marking: macro.isOn() && currentPr() ? prMarking : null, flow: flowBar(currentPr(), flowOn), uid, overview: { open: drawer.isOpen(), id: drawer.id } });
    const crumbs = viewBar.querySelector('.lt-crumbs');
    graphCrumbs.replaceChildren(...(crumbs ? [crumbs] : []));
    graphCrumbs.hidden = !crumbs;
    viewBar.hidden = !viewBar.innerHTML.trim();
    syncFlowReading();
  }

  function pruneFilters() {
    const scope = scopeOf(data, filters.platform).nodes;
    filters.dirs = [];
    filters.roles = filters.roles.filter((r) => scope.some((n) => n.role === r));
    filters.features = filters.features.filter((f) => scope.some((n) => (n.feature ?? '-') === f));
  }

  function setPlatform(id: string) {
    filters.platform = effectivePlatform(data, id);
    pruneFilters();
    const n = selected ? byPath.get(selected) : undefined;
    if (n && !inPlatform(n, filters.platform)) {
      if (locked) dropLock(`${fileLabel(n.path)} is on another platform, so it is unlocked.`);
      selected = null;
    }
    opts.onPlatform?.(filters.platform);
    refresh();
  }

  function goTo(path: string, stay = false) {
    const n = byPath.get(path);
    if (!n) return;
    peeked = null;
    if (prOnly && !filters.only?.has(path)) {
      prOnly = false;
      filters.only = null;
      if (locked) refresh();
    }
    if (locked) {
      inspect(path);
      pixi.focusNode(path);
      return;
    }
    if (!(stay && inPlatform(n, filters.platform))) filters.platform = effectivePlatform(data, n.platform ?? '');
    pruneFilters();
    if (stay && !isVisible(n, filters)) resetFilters(filters);
    selected = path;
    opts.onPlatform?.(filters.platform);
    refresh();
    pixi.focusNode(path);
  }

  function select(key: string | null) {
    peeked = null;
    if (locked) return inspect(key);
    lockNote = '';
    const target = key ? byPath.get(key) : undefined;
    if (target && !inPlatform(target, filters.platform)) return goTo(target.path);
    selected = key;
    if (!key) relationMode = false;
    refresh(false);
  }

  function relationOn() {
    return relationMode && canRelate();
  }

  function canRelate() {
    return !!selected && !!baseLayout?.pos.has(selected);
  }

  function setRelationMode(on: boolean) {
    if (on === relationMode || (on && !canRelate())) return;
    relationMode = on;
    paintGraph(false);
    if (on) centreInView(main.scrollTop, false);
    else {
      main.scrollTop = 0;
      main.scrollLeft = 0;
      const left = selected ? sidewaysTarget(positions.get(selected), scaleOf()) : null;
      if (left !== null) main.scrollLeft = left;
    }
    redrawSide();
  }

  function actFromSide(change: () => void) {
    change();
    (side.querySelector('.rv-open') as HTMLElement | null)?.focus();
  }

  function actFromLock(change: () => void) {
    change();
    (side.querySelector('[data-lock]') as HTMLElement | null)?.focus();
  }

  function redrawSide() {
    const keep = side.scrollTop;
    const planKeep = planPane.scrollTop;
    const parts = [...side.querySelectorAll<HTMLElement>('.lt-side-list')].map((part) => part.scrollTop);
    drawSide();
    side.scrollTop = keep;
    planPane.scrollTop = planKeep;
    side.querySelectorAll<HTMLElement>('.lt-side-list').forEach((part, i) => {
      part.scrollTop = parts[i] ?? 0;
    });
    syncReview();
    syncFlowReading();
  }

  function refresh(redrawGraph = true) {
    refreshes++;
    if (redrawGraph) {
      syncPlanFiles();
      clearTimeout(searchTimer);
      searchTimer = undefined;
      drawTabs();
      sections.sync(data, filters.platform);
      prStrip.sync(data.prs, prId);
      planStrip.sync(data.plans, planSlug);
      drawGraph();
    } else if (relationOn() || drawnRelation) {
      const top = main.scrollTop;
      paintGraph(true);
      if (relationOn()) {
        centreInView(top, motionOn());
        pixi.focusNode(selected as string);
      }
      else {
        scrollMain(top, 0, motionOn());
        main.scrollLeft = 0;
      }
    } else focusOn(selected, true);
    syncBar(canRelate(), relationOn());
    redrawSide();
  }

  rvBar.addEventListener('click', (ev) => {
    const t = (ev.target as Element).closest('button');
    if (!t) return;
    if (t.hasAttribute('data-pronly')) setPrOnly(!prOnly);
    else if (t.hasAttribute('data-lock')) setLock(!locked);
    else setRelationMode(!relationOn());
  });

  function stepsFileOnMacro(ev: KeyboardEvent) {
    const sideways = ev.key === 'ArrowLeft' || ev.key === 'ArrowRight';
    return sideways && macro.isOn() && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && review.canStep();
  }

  function onKey(ev: KeyboardEvent) {
    if (!root.isConnected) return document.removeEventListener('keydown', onKey, true);
    if (ev.defaultPrevented || root.closest('.hidden, [hidden]') || !overlay.hidden || document.querySelector('.modal:not(.hidden)')) return;
    if (regionTools.handleKey(ev)) return;
    if (ev.key === 'Escape' && (ev.target as Element | null)?.closest?.('.lt-cm-box, .lt-cm-pop, .lt-cm-add')) return;
    if (ev.key === 'Escape' && drawer.isOpen()) {
      ev.preventDefault();
      return drawer.set(false);
    }
    if (graphless()) {
      if (review.stepKey(ev) || nav.backspace(ev)) return;
      if (ev.key !== 'Escape') return;
      if (flowPick) clearFlowPick();
      else if (macro.isOn() && macro.selected()) pickBlock(null);
      else if (planPicked) pickPlan(null);
      else if (planSlug) openPlan(null);
      else nav.leave();
      return;
    }
    if (ev.key === 'Escape') {
      if (locked && inspected) inspect(null);
      else if (relationOn()) setRelationMode(false);
      else if (planPicked) pickPlan(null);
      else if (planSlug) openPlan(null);
    } else if (isLockKey(ev)) setLock(!locked);
  }

  document.addEventListener('keydown', onKey, true);

  function onSideClick(ev: MouseEvent) {
    const t = (ev.target as Element).closest('button');
    if (!t || isSelectingWithin(t)) return;
    if (t.hasAttribute('data-overview')) return drawer.set(false);
    if (t.hasAttribute('data-macro-go')) return pickBlock(t.getAttribute('data-macro-go') || null);
    if (t.hasAttribute('data-macro-area')) return pickArea(t.getAttribute('data-macro-area') ?? '');
    if (t.hasAttribute('data-macro-feature')) return pickFeature(t.getAttribute('data-macro-feature') ?? '');
    if (t.hasAttribute('data-macro-up')) return void nav.leave();
    if (t.hasAttribute('data-macro-enter')) return void nav.enter(t.getAttribute('data-macro-enter') ?? '', true);
    if (t.hasAttribute('data-flow-clear')) return clearFlowPick();
    if (t.hasAttribute('data-plan-close')) return openPlan(null);
    if (t.hasAttribute('data-plan-clear')) return pickPlan(null);
    if (t.hasAttribute('data-plan-fold')) return foldPlan(t.getAttribute('data-plan-fold') ?? '');
    if (t.hasAttribute('data-plan-question')) return planAsk.open(t.getAttribute('data-plan-question') ?? '');
    if (t.hasAttribute('data-plan-copy')) return void planAsk.copy().then(redrawSide);
    if (t.hasAttribute('data-plan-copy-text')) return copyPlanText();
    if (t.hasAttribute('data-plan-fix-copy')) return copyFix();
    if (t.hasAttribute('data-plan-fix-run')) return runFix(t.getAttribute('data-plan-fix-run') ?? '');
    if (planSlug && t.hasAttribute('data-plan-stage')) return pickPlan(stagePick(planSlug, t.getAttribute('data-plan-stage') ?? ''), 'data-plan-stage', t.getAttribute('data-plan-stage') ?? '');
    if (planSlug && t.hasAttribute('data-plan-item')) return pickPlan(itemPick(planSlug, t.getAttribute('data-plan-item') ?? ''), 'data-plan-item', t.getAttribute('data-plan-item') ?? '');
    if (planSlug && t.hasAttribute('data-plan-impact')) return pickPlan(planPick(planSlug), 'data-plan-impact');
    if (t.hasAttribute('data-plan-pr')) return setPr(t.getAttribute('data-plan-pr'));
    let focusSearch = false;
    if (t.hasAttribute('data-role')) toggle(filters.roles, t.getAttribute('data-role') as string);
    else if (t.hasAttribute('data-kind')) toggle(filters.kinds, t.getAttribute('data-kind') as Arrow);
    else if (t.hasAttribute('data-dir')) toggle(filters.dirs, t.getAttribute('data-dir') as string);
    else if (t.hasAttribute('data-feature')) toggle(filters.features, t.getAttribute('data-feature') as string);
    else if (t.hasAttribute('data-wip')) filters.wip = !filters.wip;
    else if (t.hasAttribute('data-missing')) filters.missing = !filters.missing;
    else if (t.hasAttribute('data-unmapped')) showUnmapped = !showUnmapped;
    else if (t.hasAttribute('data-clear-all')) {
      resetFilters(filters);
      showUnmapped = false;
      setPr(null, false);
      focusSearch = true;
    } else if (t.hasAttribute('data-pr-map')) return opts.onMapMissing?.();
    else if (t.hasAttribute('data-pr-reasons')) return generateReasons();
    else if (t.hasAttribute('data-pr-refresh')) return refreshPr();
    else if (t.hasAttribute('data-pr-back')) setPr(null, false);
    else if (t.hasAttribute('data-pr-diff')) return openPrDiff(t.getAttribute('data-pr-diff') ?? '');
    else if (t.hasAttribute('data-pr-code')) return reveal(t.getAttribute('data-pr-code') ?? '', 'file');
    else if (t.hasAttribute('data-pr-go')) {
      const path = t.getAttribute('data-pr-go') ?? '';
      if (!byPath.has(path) || (graphless() && currentPr())) return reveal(path, review.mode(), false);
      setView('files');
      return goTo(path, true);
    }
    else if (t.hasAttribute('data-relview')) return actFromSide(() => setRelationMode(!relationOn()));
    else if (t.hasAttribute('data-lock')) return actFromLock(() => setLock(!locked));
    else if (t.hasAttribute('data-lock-move')) return actFromLock(moveLock);
    else if (t.hasAttribute('data-rv-dismiss')) {
      return actFromSide(() => {
        hintDismissed = true;
        redrawSide();
      });
    } else if (t.hasAttribute('data-clear')) filters[t.getAttribute('data-clear') as ListFilter] = [];
    else if (t.hasAttribute('data-code')) return currentPr() && t.closest('.pr-file') ? reveal(t.getAttribute('data-code') ?? '', 'file') : openCode(t.getAttribute('data-code') ?? '', t.getAttribute('data-symbol') ?? '');
    else if (t.hasAttribute('data-go')) return select(t.getAttribute('data-go') || null);
    else return;
    refresh();
    if (focusSearch) (side.querySelector('.search') as HTMLInputElement | null)?.focus();
  }

  side.addEventListener('click', onSideClick);
  planPane.addEventListener('click', onSideClick);
  drawer.el.addEventListener('click', onSideClick);

  flowHost.addEventListener('click', (ev) => {
    const target = ev.target as Element;
    const chip = target.closest('[data-flow-open]');
    if (chip) return isSelectingWithin(chip) ? undefined : reveal(chip.getAttribute('data-flow-open') ?? '', review.mode(), false);
    const block = target.closest('[data-flow-step]');
    if (block && !isSelectingWithin(block)) pickFlowStep(block.getAttribute('data-flow-step'));
  });

  flowHost.addEventListener('keydown', (ev) => {
    const block = (ev.target as Element).closest('[data-flow-step]');
    if (!block || (ev.key !== 'Enter' && ev.key !== ' ') || isSelectingWithin(block)) return;
    ev.preventDefault();
    pickFlowStep(block.getAttribute('data-flow-step'));
  });

  planBar.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('button[data-plan-leave]')) openPlan(null);
  });

  graphCrumbs.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('button[data-macro-up]')) void nav.leave();
  });

  viewBar.addEventListener('click', (ev) => {
    const marking = (ev.target as Element).closest('button[data-prmark]');
    if (marking) return setPrMarking(!prMarking);
    if ((ev.target as Element).closest('button[data-macro-up]')) return void nav.leave();
    if ((ev.target as Element).closest('button[data-overview]')) return drawer.set(!drawer.isOpen());
    const t = (ev.target as Element).closest('button[data-view]');
    if (!t) return;
    const view = t.getAttribute('data-view') as ViewName;
    if (planSlug && view !== 'flow') planningShows.set(planningKey(), view);
    setView(view);
    (viewBar.querySelector(`[data-view="${view}"]`) as HTMLElement | null)?.focus();
  });

  tabs.addEventListener('click', (ev) => {
    const t = (ev.target as Element).closest('button[data-plat]');
    if (t) setPlatform(t.getAttribute('data-plat') ?? '');
  });

  tabs.addEventListener('keydown', (ev) => {
    const key = (ev as KeyboardEvent).key;
    const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    setPlatform(neighbour(data, filters.platform, step));
    (tabs.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
  });

  side.addEventListener('input', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (!input.classList.contains('search') || input.value === filters.q) return;
    filters.q = input.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, SEARCH_DELAY_MS);
  });

  applyOverlay();
  index();
  refresh();

  return {
    update(next) {
      source = next;
      settleFixes();
      prOverlay = null;
      overlayAt = null;
      composeData();
      applyOverlay();
      filters.platform = effectivePlatform(data, filters.platform);
      index();
      if (!pickedNow()) flowPick = null;
      macro.invalidate();
      if (macro.isOn() && !macro.available(source)) macro.set(false);
      if (planSlug && !currentPlan()) return leavePlan();
      refresh();
    },
    selectPr(id) {
      setPr(id);
    },
    setFoldFiles(on) {
      if (on === foldFiles) return;
      foldFiles = on;
      tilesCache = null;
      retile();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      holdPlanWindow(uid, null);
      planAsk.dispose();
      planTextCopy.dispose();
      stopFixWatch();
      if (!opts.planFix) planFix.dispose();
      drawer.dispose();
      panes.dispose();
      planColumn.dispose();
      regionTools.dispose();
      explainHub?.dispose();
      review.dispose();
      diffCache?.stop();
      clearTimeout(searchTimer);
      scrollMain.cancel();
      document.removeEventListener('keydown', onKey, true);
      stage.drop();
      pixi.dispose();
      navigation.dispose();
    },
  };
}

export { mountLanternView };
export type { LanternView, ViewOptions };
