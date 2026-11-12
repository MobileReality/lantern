import 'pixi.js/unsafe-eval';
import { Application, BitmapFont, Container, Graphics, Text } from 'pixi.js';
import { edgeCurve, isWip, GROUP_CHAR_W, RELATED_DIR } from '../lanternlayout';
import type { Layout, Pos } from '../lanternlayout';
import type { Profile } from '../lanternprofile';
import { drawEdge, edgeKind } from './edge-graphics';
import { edgeColor, paletteOf } from './palette';
import type { PixiPalette } from './palette';
import { createText, nodeDisplay } from './node-graphics';
import type { PixiFonts } from './node-graphics';
import { VIEW, say } from '@shared/lantern-plan-messages';
import { MOVE_MS, motionOn } from '../lanternmove';
import { DeferredTextQuality, textResolution } from './text-quality';
import { innerSize, outerSize } from './viewport-size';
import type { RelationLayout } from '../lanternrelview';
import type { FileMark } from '../lanternprpanel';
import { relationGraphics } from './relation-graphics';
import { macroGraphics, macroTitles, syncMacroAccess } from './macro-graphics';
import type { ArcView } from './macro-graphics';
import type { MacroLayout } from '../lanternmacrolayout';
import type { LanternRelation } from '@main/lantern';
import { blockKindText, captionOf } from '../lanternmacro';
import { OPEN_FILE_LABEL } from '../lanternmacrocurrent';
import { calmedAlpha, isMarked, markNote, markedAlpha, systemsOfBlocks, weakNearAlpha } from '../lanternmacromarks';
import type { MacroMarks } from '../lanternmacromarks';
import { isPrimaryTap, syncOpenButtons } from './open-actions';
import type { FileActions } from './open-actions';

const CULL_MARGIN = 0;
const DOUBLE_TAP_MS = 450;
const NO_KEYS: ReadonlySet<string> = new Set();

function macroArcView(state: PixiRenderState): ArcView {
  return { selected: state.selected, marks: state.macroMarks, reading: state.macroCalm ? (state.macroCurrent ?? NO_KEYS) : undefined };
}
let fontSetId = 0;

interface PixiGraphOptions {
  host: HTMLElement;
  scroll: HTMLElement;
  onActivate: (key: string) => void;
  onEnter?: (key: string, byKeyboard: boolean) => boolean;
  onBoundary: (path: string) => void;
  onExpand: (key: string) => void;
  onBackground: () => void;
  onOpenCode?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}

interface PixiRenderState {
  layout: Layout;
  relation?: RelationLayout;
  macro?: MacroLayout;
  macroMarks?: MacroMarks;
  macroCurrent?: ReadonlySet<string>;
  macroCalm?: boolean;
  selected: string | null;
  locked: boolean;
  inspected: string | null;
  marks: ReadonlyMap<string, FileMark> | null;
  near: ReadonlySet<string>;
  nearWeak?: ReadonlySet<string>;
  profile: Profile;
  animate: boolean;
}

interface RetainedNode {
  key: string;
  position: Pos;
  display: Container | null;
  signature: string;
}

interface NodeMove {
  display: Container;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface RetainedGroup {
  x: number;
  y: number;
  width: number;
  dir: string;
  display: Container | null;
}

const markStatus = (mark: FileMark) => (mark === 'related' ? say(VIEW.NODE_PLAN_RELATED) : `pull request ${mark}`);

function truncateLeft(value: string, room: number) {
  return value.length > room ? `…${value.slice(value.length - room + 1)}` : value;
}

class PixiGraph {
  readonly ready: Promise<void>;
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly columns = new Container();
  private readonly edges = new Container();
  private readonly nodes = new Container();
  private relationDisplay: Container | null = null;
  private readonly accessibility = document.createElement('div');
  private retained = new Map<string, RetainedNode>();
  private groups = new Map<string, RetainedGroup>();
  private buttons = new Map<string, HTMLButtonElement>();
  private layout: Layout | null = null;
  private state: PixiRenderState | null = null;
  private palette: PixiPalette | null = null;
  private disposed = false;
  private frame = 0;
  private animationFrame = 0;
  private activeMoves: NodeMove[] = [];
  private scale = 1;
  private viewportOffset = { x: 0, y: 0 };
  private presented = false;
  private pendingIcons = 0;
  private fonts: PixiFonts | null = null;
  private fontResolution = textResolution(1, devicePixelRatio);
  private readonly deferredTextQuality = new DeferredTextQuality(this.fontResolution, (resolution) => this.refreshTextQuality(resolution));
  private viewportWidth = 0;
  private viewportHeight = 0;
  private paneWidth = 0;
  private paneHeight = 0;
  private paneResized = false;
  private pointer: { x: number; y: number } | null = null;
  private hoveredKey: string | null = null;
  private readonly pinnedAreas = new Set<string>();
  private hoveredArea: string | null = null;
  private failed = false;
  private paintedLayout: Layout | null = null;
  private focusedKey: string | null = null;
  private relationCentre: string | null = null;
  private movingFocus = false;
  private macroFonts = false;
  private lastTap: { key: string; at: number } | null = null;
  private readonly scrollResize: ResizeObserver | null;

  constructor(private readonly options: PixiGraphOptions) {
    this.accessibility.className = 'lt-pixi-a11y';
    options.host.appendChild(this.accessibility);
    options.scroll.addEventListener('scroll', this.scheduleViewport);
    window.addEventListener('blur', this.clearPointer);
    window.addEventListener('pointermove', this.trackPointer);
    window.addEventListener('pointerout', this.leaveWindow);
    window.addEventListener('resize', this.scheduleViewport);
    this.scrollResize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.onPaneResize);
    this.scrollResize?.observe(options.scroll);
    this.ready = this.init().catch(() => this.showFailure());
  }

  private async init() {
    await Promise.all([
      document.fonts.ready,
      this.app.init({ preference: 'webgl', antialias: true, backgroundAlpha: 0, resolution: devicePixelRatio, autoDensity: true, autoStart: false, sharedTicker: false, width: this.options.scroll.clientWidth, height: this.options.scroll.clientHeight }),
    ]);
    if (this.disposed) return this.app.destroy(true);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.columns, this.edges, this.nodes);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', (event) => {
      if (event.target === this.app.stage && isPrimaryTap(event)) this.options.onBackground();
    });
    this.options.host.prepend(this.app.canvas);
    this.app.canvas.className = 'lt-pixi-canvas';
    this.app.canvas.dataset.tipAt = 'pointer';
    this.app.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.showFailure();
    });
    const renderer = this.app.renderer as typeof this.app.renderer & { gl?: WebGLRenderingContext };
    const debug = renderer.gl?.getExtension('WEBGL_debug_renderer_info');
    const vendor = debug && renderer.gl ? renderer.gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : 'unknown';
    const device = debug && renderer.gl ? renderer.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
    document.documentElement.dataset.graphGpu = `${vendor} · ${device}`;
    if (this.state) this.paint(this.state);
    this.scheduleViewport();
  }

  rendererName() {
    return this.app.renderer.type === 1 ? 'webgl' : String(this.app.renderer.type);
  }

  private showFailure() {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.deferredTextQuality.cancel();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('blur', this.clearPointer);
    window.removeEventListener('pointermove', this.trackPointer);
    window.removeEventListener('pointerout', this.leaveWindow);
    this.options.host.classList.add('lt-pixi-failed');
    this.accessibility.hidden = true;
    if (this.app.renderer) this.app.canvas.hidden = true;
    const error = document.createElement('p');
    error.className = 'lt-pixi-error';
    error.setAttribute('role', 'status');
    error.textContent = 'The visual graph could not start because WebGL is unavailable.';
    this.options.host.prepend(error);
    document.documentElement.dataset.graphRenderer = 'unavailable';
    document.documentElement.dataset.graphSettled = 'true';
  }

  viewportScale() {
    return this.scale;
  }

  setViewportScale(scale: number) {
    const scaleChanged = scale !== this.scale;
    this.scale = scale;
    const resolution = textResolution(scale, devicePixelRatio);
    if (!this.fonts) {
      this.fontResolution = resolution;
      this.deferredTextQuality.setCurrent(resolution);
    }
    if (!this.layout || this.disposed || this.failed) return;
    this.options.host.style.width = `${this.layout.width * this.scale}px`;
    this.options.host.style.height = `${this.layout.height * this.scale}px`;
    if (scaleChanged && this.state) {
      this.drawAccessibility(this.state);
      for (const retained of this.retained.values()) {
        if (!retained.position.item.tile || !retained.display) continue;
        retained.display.removeFromParent();
        retained.display.destroy({ children: true });
        retained.display = null;
      }
    }
    this.scheduleViewport();
    if (scaleChanged) this.deferredTextQuality.schedule(resolution);
  }

  setViewportOffset(x: number, y: number) {
    this.viewportOffset = { x, y };
    if (this.failed) return;
    this.updateViewport();
  }

  render(state: PixiRenderState) {
    if (this.disposed) return;
    const nextCentre = state.relation?.centre ?? null;
    if (nextCentre !== this.relationCentre) {
      this.pinnedAreas.clear();
      this.hoveredArea = null;
      this.relationCentre = nextCentre;
    }
    this.layout = state.layout;
    this.state = state;
    this.options.host.style.width = `${this.layout.width * this.scale}px`;
    this.options.host.style.height = `${this.layout.height * this.scale}px`;
    this.drawAccessibility(state);
    if (!this.app.renderer || this.failed) return;
    this.paint(state);
  }

  private paint(state: PixiRenderState) {
    this.settleAnimation();
    const timings: Record<string, number> = {};
    let phaseAt = performance.now();
    const phase = (name: string) => {
      const now = performance.now();
      timings[name] = now - phaseAt;
      phaseAt = now;
    };
    const structuralChange = !this.paintedLayout || this.paintedLayout.cols.length !== state.layout.cols.length || this.paintedLayout.cols.some((column, index) => {
      const next = state.layout.cols[index];
      return !next || column.x !== next.x || column.w !== next.w || column.bottom !== next.bottom || (column.top ?? 0) !== (next.top ?? 0) || column.layer.id !== next.layer.id || column.layer.name !== next.layer.name || column.layer.cap !== next.layer.cap;
    });
    this.layout = state.layout;
    this.paintedLayout = state.layout;
    this.palette = paletteOf(this.options.host);
    phase('palette');
    if (this.fonts && !!state.macro !== this.macroFonts) this.refreshTextQuality(this.fontResolution);
    this.macroFonts = !!state.macro;
    this.fonts ??= this.installFonts(state);
    document.documentElement.dataset.graphTextResolution = String(this.fontResolution);
    phase('fonts');
    if (state.relation) {
      this.columns.visible = false;
      this.edges.visible = false;
      this.relationDisplay?.destroy({ children: true });
      this.relationDisplay = relationGraphics({ layout: state.relation, palette: this.palette, profile: state.profile, resolution: this.fontResolution, pinnedAreas: this.pinnedAreas, hoveredArea: this.hoveredArea, onArea: (key) => this.toggleArea(key), onAreaHover: (key) => this.setHoveredArea(key) });
      this.world.addChildAt(this.relationDisplay, 0);
    } else {
      this.columns.visible = true;
      this.edges.visible = true;
      this.relationDisplay?.destroy({ children: true });
      this.relationDisplay = null;
      if (structuralChange) this.drawColumns(state);
    }
    phase('columns');
    this.updateGroups(state);
    this.drawNodes(state);
    phase('nodes');
    if (!state.relation) this.drawEdges(state);
    phase('edges');
    this.updateViewport();
    phase('render');
    phase('accessibility');
    document.documentElement.dataset.graphRenderTimings = JSON.stringify(timings);
    document.documentElement.dataset.graphRenderer = this.rendererName();
    if (!this.presented) this.presented = true;
    this.scheduleSettled();
  }

  private drawColumns(state: PixiRenderState) {
    for (const retained of this.groups.values()) retained.display?.removeFromParent();
    this.columns.removeChildren().forEach((child) => { child.destroy({ children: true }); });
    for (const column of state.layout.cols) {
      const layerColor = this.palette!.layers[column.layer.id] ?? this.palette!.layers.support;
      const top = column.top ?? 0;
      const band = new Graphics().roundRect(column.x - 10, 10 + top, column.w + 20, column.bottom - top - 4, 8).fill({ color: layerColor, alpha: 0.09 });
      const name = new Text({ text: column.layer.name, resolution: this.fontResolution, style: { fontFamily: this.palette!.ui, fontSize: 18, fontWeight: '700', fill: this.palette!.ink } });
      name.position.set(column.x, 17 + top);
      const cap = new Text({ text: column.layer.cap, resolution: this.fontResolution, style: { fontFamily: this.palette!.ui, fontSize: 11.5, fontWeight: '400', fill: this.palette!.ink3 } });
      cap.position.set(column.x, 42 + top);
      this.columns.addChild(band, name, cap);
    }
  }

  private updateGroups(state: PixiRenderState) {
    const wanted = new Set<string>();
    for (const column of state.layout.cols) {
      column.groups.forEach((group, index) => {
        const key = `${column.layer.id}:${index}`;
        wanted.add(key);
        const retained = this.groups.get(key) ?? { x: column.x, y: group.y, width: column.w, dir: group.dir, display: null };
        const changed = retained.x !== column.x || retained.y !== group.y || retained.width !== column.w || retained.dir !== group.dir;
        Object.assign(retained, { x: column.x, y: group.y, width: column.w, dir: group.dir });
        if (changed && retained.display) {
          retained.display.removeFromParent();
          retained.display.destroy({ children: true });
          retained.display = null;
        }
        this.groups.set(key, retained);
      });
    }
    for (const [key, retained] of this.groups) {
      if (wanted.has(key)) continue;
      retained.display?.removeFromParent();
      retained.display?.destroy({ children: true });
      this.groups.delete(key);
    }
  }

  private drawNodes(state: PixiRenderState) {
    const moves: NodeMove[] = [];
    const wanted = new Set(state.layout.pos.keys());
    for (const [key, retained] of this.retained) {
      if (wanted.has(key)) continue;
      retained.display?.removeFromParent();
      retained.display?.destroy({ children: true });
      this.retained.delete(key);
    }
    for (const [key, position] of state.layout.pos) {
      let retained = this.retained.get(key);
      if (!retained) {
        retained = { key, position, display: null, signature: '' };
        this.retained.set(key, retained);
      }
      const areaActive = !!state.relation?.zones.some((zone) => zone.areas.some((area) => area.keys.includes(key) && (this.pinnedAreas.has(area.key) || this.hoveredArea === area.key)));
      const actions = this.fileActions(position, state);
      const signature = `${state.marks?.get(key) ?? ''}:${markNote(state.macroMarks, key)}:${!!state.macroCurrent?.has(key)}:${!!state.macroCalm}:${state.locked && key === state.selected}:${state.inspected === key}:${this.focusedKey === key}:${areaActive}:${actions ? (actions.diff ? 'code+diff' : 'code') : ''}`;
      if (retained.signature !== signature && retained.display) {
        retained.display.removeFromParent();
        retained.display.destroy({ children: true });
        retained.display = null;
      }
      retained.signature = signature;
      if (retained.display && (retained.position.w !== position.w || retained.position.h !== position.h || retained.position.item !== position.item)) {
        retained.display.removeFromParent();
        retained.display.destroy({ children: true });
        retained.display = null;
      }
      if (state.relation && !retained.display) {
        retained.display = this.createRetainedDisplay(retained);
        this.nodes.addChild(retained.display);
      }
      const moved = !!retained.display && (retained.position.x !== position.x || retained.position.y !== position.y);
      if (moved && retained.display) {
        moves.push({ display: retained.display, from: { x: retained.position.x, y: retained.position.y }, to: { x: position.x, y: position.y } });
      }
      retained.position = position;
      const display = retained.display;
      if (!display) continue;
      if (!moved) display.position.set(position.x, position.y);
      display.alpha = this.nodeAlpha(key, position, this.hoveredKey === key);
      display.getChildByName('hover')?.destroy();
      display.getChildByName('selection')?.destroy();
      display.getChildByName('centre')?.destroy();
      if (key === state.selected) {
        const outline = new Graphics().roundRect(-1, -1, position.w + 2, position.h + 2, 4).stroke({ color: this.palette!.ink, width: 2 });
        outline.label = 'selection';
        display.addChildAt(outline, 0);
      }
      if (state.relation?.centre === key) {
        const centre = new Graphics().roundRect(-1, -1, position.w + 2, position.h + 2, 4).stroke({ color: this.palette!.ink, width: 2 });
        centre.label = 'centre';
        display.addChildAt(centre, 0);
      }
    }
    this.animateMoves(moves, state.animate);
  }

  private animateMoves(moves: NodeMove[], animate: boolean) {
    if (!moves.length || !animate || !motionOn()) {
      for (const move of moves) move.display.position.set(move.to.x, move.to.y);
      this.edges.alpha = 1;
      document.documentElement.dataset.graphTransition = 'settled';
      return;
    }
    this.activeMoves = moves;
    this.edges.alpha = 0;
    document.documentElement.dataset.graphTransition = 'running';
    const startedAt = performance.now();
    const step = (now: number) => {
      if (this.failed || this.disposed) return;
      const progress = Math.min(1, (now - startedAt) / MOVE_MS);
      const eased = 1 - (1 - progress) ** 3;
      for (const move of moves) move.display.position.set(move.from.x + (move.to.x - move.from.x) * eased, move.from.y + (move.to.y - move.from.y) * eased);
      this.edges.alpha = Math.max(0, Math.min(1, (now - startedAt - (MOVE_MS - 140)) / 140));
      this.reconcileHover();
      this.app.renderer.render(this.app.stage);
      if (progress < 1) this.animationFrame = requestAnimationFrame(step);
      else {
        this.activeMoves = [];
        document.documentElement.dataset.graphTransition = 'settled';
        this.updateViewport();
      }
    };
    this.animationFrame = requestAnimationFrame(step);
  }

  private settleAnimation() {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    for (const move of this.activeMoves) move.display.position.set(move.to.x, move.to.y);
    this.activeMoves = [];
    this.edges.alpha = 1;
    document.documentElement.dataset.graphTransition = 'settled';
  }

  private drawEdges(state: PixiRenderState) {
    this.edges.removeChildren().forEach((child) => { child.destroy({ children: true }); });
    if (state.macro) {
      this.edges.addChild(macroGraphics({ shape: state.macro, palette: this.palette as PixiPalette, selected: state.selected, resolution: this.fontResolution, marks: state.macroMarks, current: state.macroCalm ? { keys: state.macroCurrent ?? NO_KEYS } : undefined }));
      return;
    }
    if (!state.selected) return;
    for (const edge of state.layout.edges) {
      if (edge.fromKey !== state.selected && edge.toKey !== state.selected) continue;
      const from = state.layout.pos.get(edge.fromKey);
      const to = state.layout.pos.get(edge.toKey);
      if (!from || !to) continue;
      const curve = edgeCurve(from, to);
      const kind = edgeKind(edge.r.arrow, edge.toKey === state.selected && edge.fromKey !== state.selected);
      const stroke = edgeColor(this.palette!, kind);
      this.edges.addChild(drawEdge(curve, kind, edge.r.arrow, stroke));
    }
  }

  private fileActions(position: Pos, state: PixiRenderState): FileActions | null {
    const path = position.item.node?.path;
    const { onOpenCode, onOpenDiff } = this.options;
    if (!state.relation || !path || !onOpenCode || position.item.node?.planNew) return null;
    const diffable = !!onOpenDiff && !!state.marks?.has(position.item.key);
    return { path, code: () => onOpenCode(path), ...(diffable ? { diff: () => onOpenDiff(path) } : {}) };
  }

  private drawAccessibility(state: PixiRenderState) {
    const related = new Set<string>();
    if (state.selected) {
      related.add(state.selected);
      if (state.relation) for (const key of state.relation.pos.keys()) related.add(key);
      if (state.macro) for (const key of [...state.near, ...(state.nearWeak ?? NO_KEYS)]) related.add(key);
      for (const edge of state.layout.edges) {
        if (edge.fromKey === state.selected) related.add(edge.toKey);
        if (edge.toKey === state.selected) related.add(edge.fromKey);
      }
    }
    const wanted = new Set(state.layout.pos.keys());
    this.movingFocus = true;
    for (const [key, button] of this.buttons) {
      if (wanted.has(key)) continue;
      button.remove();
      this.buttons.delete(key);
    }
    this.movingFocus = false;
    if (this.focusedKey !== null && !wanted.has(this.focusedKey)) this.focusedKey = null;
    for (const [key, position] of state.layout.pos) {
      let button = this.buttons.get(key);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'lt-pixi-node-access';
        button.addEventListener('click', () => {
          const current = this.layout?.pos.get(key);
          if (current?.item.node || this.state?.macro) this.options.onActivate(key);
          else if (current?.item.boundary) this.options.onBoundary(current.item.boundary.path);
          else if (current?.item.tile) this.options.onExpand(key);
        });
        button.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && this.state?.macro && this.options.onEnter?.(key, true)) event.preventDefault();
        });
        button.addEventListener('focus', () => {
          const current = this.layout?.pos.get(key);
          if (current) this.scrollIntoView(current);
          if (this.movingFocus) return;
          this.focusedKey = key;
          if (this.state) this.render(this.state);
        });
        button.addEventListener('blur', () => {
          if (this.movingFocus) return;
          if (this.focusedKey === key) this.focusedKey = null;
          if (this.state) this.render(this.state);
        });
        this.buttons.set(key, button);
      }
      const block = position.item.block;
      const label = block ? `${position.item.label}, ${captionOf(block)}` : (position.item.node?.path ?? position.item.label);
      const text = position.item.label;
      const pressed = String(key === state.selected);
      const x = String(position.x * this.scale);
      const y = String(position.y * this.scale);
      const width = String(position.w * this.scale);
      const height = String(position.h * this.scale);
      if (button.textContent !== text) button.textContent = text;
      button.tabIndex = state.relation?.centre === key ? -1 : 0;
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      button.setAttribute('aria-label', label);
      const node = position.item.node;
      const status = node?.prNew ? 'new in pull request' : node?.planNew ? say(VIEW.NODE_PLAN_NEW) : node?.freshness === 'gone' ? 'file is gone' : node && state.marks?.has(key) ? markStatus(state.marks.get(key) as FileMark) : '';
      button.dataset.tip = node ? [node.path, node.role, node.purpose, status].filter(Boolean).join(' — ') : [label, block?.purpose].filter(Boolean).join(' — ');
      const kind = position.item.boundary ? 'boundary to another platform' : position.item.tile ? 'directory group' : block ? blockKindText(block) : `${position.item.node?.role ?? 'external'} in ${position.col.layer.name}`;
      button.setAttribute('aria-description', [kind, key === state.selected ? 'selected' : related.has(key) ? 'related' : '', key === state.inspected ? 'inspected' : '', state.locked && key === state.selected ? 'locked' : '', state.macroCurrent?.has(key) ? OPEN_FILE_LABEL.toLowerCase() : '', markNote(state.macroMarks, key)].filter(Boolean).join(', '));
      button.classList.toggle('locked', state.locked && key === state.selected);
      button.classList.toggle('insp', key === state.inspected);
      button.classList.toggle('open-file', !!state.macroCurrent?.has(key));
      button.classList.toggle('gone', position.item.node?.freshness === 'gone');
      button.classList.toggle('pr-new', !!position.item.node?.prNew || !!position.item.node?.planNew || state.marks?.get(key) === '+');
      const hit = !!state.marks?.has(key) || isMarked(state.macroMarks, key);
      button.classList.toggle('pr-hit', hit && !state.macroCalm);
      button.classList.toggle('pr-calm', hit && !!state.macroCalm);
      button.classList.toggle('pr-off', (!!state.marks && !state.marks.has(key)) || (!!state.macroMarks && !hit));
      if (button.dataset.graphX !== x) button.dataset.graphX = x;
      if (button.dataset.graphY !== y) button.dataset.graphY = y;
      if (button.dataset.graphWidth !== width) button.dataset.graphWidth = width;
      if (button.dataset.graphHeight !== height) button.dataset.graphHeight = height;
      if (!button.parentNode) this.accessibility.appendChild(button);
    }
    const openable = new Map<string, FileActions>();
    for (const [key, position] of state.layout.pos) {
      const actions = this.fileActions(position, state);
      if (actions) openable.set(key, actions);
    }
    syncOpenButtons(this.accessibility, openable);
    syncMacroAccess(this.accessibility, state.macro, macroArcView(state), !!state.macroCalm);
    const areas = state.relation?.zones.flatMap((zone) => zone.areas) ?? [];
    const areaKeys = new Set(areas.map((area) => area.key));
    for (const button of this.accessibility.querySelectorAll<HTMLButtonElement>('.lt-pixi-area-access')) if (!areaKeys.has(button.dataset.area ?? '')) button.remove();
    for (const area of areas) {
      let button = [...this.accessibility.querySelectorAll<HTMLButtonElement>('.lt-pixi-area-access')].find((candidate) => candidate.dataset.area === area.key);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'lt-pixi-area-access';
        button.dataset.area = area.key;
        button.addEventListener('click', () => this.toggleArea(area.key));
        this.accessibility.appendChild(button);
      }
      button.textContent = `${area.dir || '(root)'}, ${area.keys.length} files`;
      button.setAttribute('aria-pressed', String(this.pinnedAreas.has(area.key)));
      button.dataset.graphX = String(area.x * this.scale);
      button.dataset.graphY = String(area.y * this.scale);
      button.dataset.graphWidth = String(area.w * this.scale);
      button.dataset.graphHeight = String(area.h * this.scale);
      const edge = state.relation?.edges.find((candidate) => candidate.key === area.key);
      button.dataset.tip = edge ? edge.relations.map((relation) => `${relation.from} ${relation.arrow} ${relation.to || `ext:${relation.ext}`}${relation.symbol ? `#${relation.symbol}` : ''}${relation.label ? ` | ${relation.label}` : ''}`).join('\n') : '';
      button.onfocus = () => this.setHoveredArea(area.key);
      button.onblur = () => this.setHoveredArea(null);
    }
  }

  private toggleArea(key: string) {
    if (this.pinnedAreas.has(key)) this.pinnedAreas.delete(key);
    else this.pinnedAreas.add(key);
    if (this.state) this.render(this.state);
  }

  private setHoveredArea(key: string | null) {
    if (this.hoveredArea === key) return;
    this.hoveredArea = key;
    if (this.state) this.render(this.state);
  }

  private scrollIntoView(position: Pos) {
    const scroll = this.options.scroll;
    const x = position.x * this.scale;
    const y = position.y * this.scale;
    const width = position.w * this.scale;
    const height = position.h * this.scale;
    if (y < scroll.scrollTop || y + height > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = Math.max(0, y - scroll.clientHeight / 2);
    if (x < scroll.scrollLeft || x + width > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
    this.updateViewport();
  }

  focusNode(key: string) {
    if (this.failed || this.disposed) return;
    const position = this.layout?.pos.get(key);
    if (position) this.scrollIntoView(position);
    this.retained.get(this.focusedKey ?? '')?.display?.getChildByName('focus')?.destroy();
    this.focusedKey = key;
    this.movingFocus = true;
    this.buttons.get(key)?.focus({ preventScroll: true });
    this.movingFocus = false;
    const retained = this.retained.get(key);
    if (retained?.display && !retained.display.getChildByName('focus')) {
      const focus = new Graphics().roundRect(-3, -3, retained.position.w + 6, retained.position.h + 6, 6).stroke({ color: this.palette!.glow, width: 2 });
      focus.label = 'focus';
      retained.display.addChildAt(focus, 0);
      this.app.renderer?.render(this.app.stage);
    }
  }

  private readonly onPaneResize = () => {
    const pane = outerSize(this.options.scroll);
    if (pane.width === this.paneWidth && pane.height === this.paneHeight) return;
    const first = this.paneWidth === 0 && this.paneHeight === 0;
    this.paneWidth = pane.width;
    this.paneHeight = pane.height;
    if (first) return;
    this.paneResized = true;
    this.scheduleViewport();
  };

  private readonly scheduleViewport = () => {
    if (this.failed || this.disposed) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.updateViewport();
    });
  };

  private readonly trackIcon = (load: Promise<void>) => {
    this.pendingIcons += 1;
    document.documentElement.dataset.graphSettled = 'false';
    void load.finally(() => {
      this.pendingIcons -= 1;
      this.scheduleSettled();
    });
  };

  private scheduleSettled() {
    if (!this.presented || this.pendingIcons || this.failed) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.disposed || this.pendingIcons || this.failed) return;
      document.documentElement.dataset.graphReadyAt = String(performance.now());
      document.documentElement.dataset.graphSettled = 'true';
    }));
  }

  private updateViewport() {
    if (!this.layout || this.disposed || this.failed || !this.app.renderer) return;
    const scroll = this.options.scroll;
    this.world.scale.set(this.scale);
    this.world.position.set(-scroll.scrollLeft + this.viewportOffset.x, -scroll.scrollTop + this.viewportOffset.y);
    const left = (scroll.scrollLeft - this.viewportOffset.x - CULL_MARGIN) / this.scale;
    const top = (scroll.scrollTop - this.viewportOffset.y - CULL_MARGIN) / this.scale;
    const right = (scroll.scrollLeft - this.viewportOffset.x + scroll.clientWidth + CULL_MARGIN) / this.scale;
    const bottom = (scroll.scrollTop - this.viewportOffset.y + scroll.clientHeight + CULL_MARGIN) / this.scale;
    for (const retained of this.retained.values()) {
      const { position, display } = retained;
      const currentX = display?.position.x ?? position.x;
      const currentY = display?.position.y ?? position.y;
      const atCurrent = currentX + position.w >= left && currentX <= right && currentY + position.h >= top && currentY <= bottom;
      const atFinal = position.x + position.w >= left && position.x <= right && position.y + position.h >= top && position.y <= bottom;
      const visible = atCurrent || atFinal;
      if (visible) {
        if (!retained.display) retained.display = this.createRetainedDisplay(retained);
        if (!retained.display.parent) this.nodes.addChild(retained.display);
      } else if (display?.parent) {
        display.getChildByName('hover')?.destroy();
        this.nodes.removeChild(display);
      }
    }
    for (const retained of this.groups.values()) {
      const visible = retained.y + 24 >= top && retained.y <= bottom;
      if (visible) {
        if (!retained.display) {
          const display = new Container();
          const related = retained.dir === RELATED_DIR;
          const tint = related ? (this.palette as PixiPalette).glow : (this.palette as PixiPalette).ink3;
          const line = new Graphics().moveTo(retained.x, retained.y + 6).lineTo(retained.x + retained.width, retained.y + 6).stroke({ color: related ? tint : (this.palette as PixiPalette).rule, width: 1 });
          const label = createText(truncateLeft(retained.dir, Math.floor(retained.width / GROUP_CHAR_W)), 9.5, tint, this.fonts!.monoGroup);
          label.style.letterSpacing = 0.38;
          label.position.set(retained.x, retained.y + 8);
          display.addChild(line, label);
          retained.display = display;
        }
        if (!retained.display.parent) this.columns.addChild(retained.display);
      } else if (retained.display?.parent) this.columns.removeChild(retained.display);
    }
    const size = this.paneResized ? innerSize(scroll) : { width: scroll.clientWidth, height: scroll.clientHeight };
    if (size.width !== this.viewportWidth || size.height !== this.viewportHeight) {
      this.viewportWidth = size.width;
      this.viewportHeight = size.height;
      this.app.renderer.resize(this.viewportWidth, this.viewportHeight);
    }
    this.reconcileHover();
    this.app.renderer.render(this.app.stage);
    document.documentElement.dataset.graphVisibleNodes = String(this.nodes.children.length);
  }

  private tapMacroCard(key: string) {
    const now = performance.now();
    const again = this.lastTap?.key === key && now - this.lastTap.at <= DOUBLE_TAP_MS;
    this.lastTap = again ? null : { key, at: now };
    if (again && this.options.onEnter?.(key, false)) return;
    this.options.onActivate(key);
  }

  private createRetainedDisplay(retained: RetainedNode) {
    const state = this.state as PixiRenderState;
    const { key, position } = retained;
    const activate = state.macro ? () => this.tapMacroCard(key) : position.item.node ? () => this.options.onActivate(key) : position.item.boundary ? () => this.options.onBoundary(position.item.boundary!.path) : position.item.tile ? () => this.options.onExpand(key) : () => undefined;
    const tint = state.marks ? (state.marks.get(key) ?? 'off') : state.macroMarks?.systems.has(key) && !state.macroCalm ? '~' : undefined;
    const display = nodeDisplay(position, state.profile, this.palette as PixiPalette, this.fonts as PixiFonts, this.scale, activate, tint, this.scheduleViewport, this.trackIcon, this.fileActions(position, state), state.macroMarks?.blocks.get(key), !!state.macroCurrent?.has(key), !!state.macroCalm);
    display.label = key;
    if (state.macro) display.cursor = 'pointer';
    display.alpha = this.nodeAlpha(key, position, this.hoveredKey === key);
    if (key === state.selected) {
      const outline = new Graphics().roundRect(-1, -1, position.w + 2, position.h + 2, 4).stroke({ color: (this.palette as PixiPalette).ink, width: 2 });
      outline.label = 'selection';
      display.addChildAt(outline, 0);
    }
    if (key === state.inspected) {
      const outline = new Graphics();
      for (let x = 1; x < position.w; x += 8) {
        outline.moveTo(x, -2).lineTo(Math.min(x + 5, position.w), -2);
        outline.moveTo(x, position.h + 2).lineTo(Math.min(x + 5, position.w), position.h + 2);
      }
      outline.stroke({ color: (this.palette as PixiPalette).ink, width: 2, alpha: 0.9 });
      outline.label = 'inspection';
      display.addChildAt(outline, 0);
    }
    if (state.locked && key === state.selected) {
      const pin = new Graphics().circle(position.w, 0, 10).fill((this.palette as PixiPalette).ink).stroke({ color: (this.palette as PixiPalette).background, width: 1.5 });
      pin.roundRect(position.w - 4.5, -1, 9, 7, 1.5).fill((this.palette as PixiPalette).background);
      pin.moveTo(position.w - 3.5, -1).lineTo(position.w - 3.5, -4).quadraticCurveTo(position.w, -7, position.w + 3.5, -4).lineTo(position.w + 3.5, -1).stroke({ color: (this.palette as PixiPalette).background, width: 1.8 });
      pin.label = 'lock';
      display.addChild(pin);
    }
    if (state.relation && key === state.relation.centre) {
      const centre = new Graphics().roundRect(-1, -1, position.w + 2, position.h + 2, 4).stroke({ color: (this.palette as PixiPalette).ink, width: 2 });
      centre.label = 'centre';
      display.addChildAt(centre, 0);
    }
    if (this.focusedKey === key) {
      const focus = new Graphics().roundRect(-3, -3, position.w + 6, position.h + 6, 6).stroke({ color: (this.palette as PixiPalette).glow, width: 2 });
      focus.label = 'focus';
      display.addChildAt(focus, 0);
    }
    const areaActive = !!state.relation?.zones.some((zone) => zone.areas.some((area) => area.keys.includes(key) && (this.pinnedAreas.has(area.key) || this.hoveredArea === area.key)));
    if (areaActive) {
      const highlight = new Graphics().roundRect(-2, -2, position.w + 4, position.h + 4, 5).stroke({ color: (this.palette as PixiPalette).glow, width: 2 });
      highlight.label = 'area-highlight';
      display.addChildAt(highlight, 0);
    }
    return display;
  }

  private nodeAlpha(key: string, position: Pos, hovered: boolean) {
    const state = this.state as PixiRenderState;
    if (state.macroCurrent?.has(key)) return 1;
    const weak = !!state.nearWeak?.has(key) && !state.near.has(key);
    return weakNearAlpha(this.dimmedAlpha(key, position, hovered, !!state.selected && !state.near.has(key) && !weak), weak);
  }

  private dimmedAlpha(key: string, position: Pos, hovered: boolean, far: boolean) {
    const state = this.state as PixiRenderState;
    if (state.macroCalm) return calmedAlpha(key, state.macroCurrent ?? NO_KEYS, systemsOfBlocks(state.macro, state.macroCurrent ?? NO_KEYS), far);
    if (state.macroMarks) return markedAlpha(state.macroMarks, key, far);
    if (state.marks) {
      if (!state.marks.has(key)) return hovered || this.focusedKey === key ? 0.8 : 0.24;
      return far ? 0.6 : 1;
    }
    return far ? (position.item.node && isWip(position.item.node) ? 0.65 : 0.22) : 1;
  }

  private readonly trackPointer = (event: PointerEvent) => {
    if (this.failed || this.disposed) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    if (!this.app.renderer) return;
    if (this.reconcileHover()) this.app.renderer.render(this.app.stage);
  };

  private readonly clearPointer = () => {
    if (this.failed || this.disposed) return;
    this.pointer = null;
    if (this.app.renderer && this.reconcileHover()) this.app.renderer.render(this.app.stage);
  };

  private readonly leaveWindow = (event: PointerEvent) => {
    if (!event.relatedTarget) this.clearPointer();
  };

  private reconcileHover() {
    if (this.failed || this.disposed) return false;
    const canvas = this.app.canvas;
    const pointer = this.pointer;
    let next: RetainedNode | undefined;
    if (pointer && canvas) {
      const rect = canvas.getBoundingClientRect();
      const x = (pointer.x - rect.left) * (this.viewportWidth / rect.width);
      const y = (pointer.y - rect.top) * (this.viewportHeight / rect.height);
      if (x >= 0 && y >= 0 && x <= this.viewportWidth && y <= this.viewportHeight) {
        for (let index = this.nodes.children.length - 1; index >= 0; index -= 1) {
          const display = this.nodes.children[index];
          const retained = this.retained.get(display.label);
          if (!retained) continue;
          const left = display.position.x * this.scale - this.options.scroll.scrollLeft + this.viewportOffset.x;
          const top = display.position.y * this.scale - this.options.scroll.scrollTop + this.viewportOffset.y;
          if (x >= left && x <= left + retained.position.w * this.scale && y >= top && y <= top + retained.position.h * this.scale) {
            next = retained;
            break;
          }
        }
      }
    }
    const key = next?.key ?? null;
    const shouldOutline = !!next && this.state?.selected !== key && (!next.position.item.node || !isWip(next.position.item.node));
    this.app.canvas.dataset.tip = key ? this.buttons.get(key)?.dataset.tip ?? '' : pointer ? this.edgeTitleAt(pointer.x, pointer.y) : '';
    if (key === this.hoveredKey && !!next?.display?.getChildByName('hover') === shouldOutline) return false;
    if (this.hoveredKey) {
      const previous = this.retained.get(this.hoveredKey);
      previous?.display?.getChildByName('hover')?.destroy();
      if (previous?.display) previous.display.alpha = this.nodeAlpha(previous.key, previous.position, false);
    }
    this.hoveredKey = key;
    document.documentElement.dataset.graphHovered = key ?? '';
    if (next?.display) next.display.alpha = this.nodeAlpha(next.key, next.position, true);
    if (!next?.display || !shouldOutline) return true;
    const layer = next.position.item.tile || next.position.item.block ? next.position.col.layer.id : this.state!.profile.layerOf(next.position.item.node?.role ?? 'other').id;
    const color = next.position.item.boundary ? this.palette!.ink : (this.palette!.layers[layer] ?? this.palette!.layers.support);
    const outline = new Graphics().roundRect(0, 0, next.position.w, next.position.h, 3).stroke({ color, width: 1 });
    outline.label = 'hover';
    next.display.addChildAt(outline, 1);
    return true;
  }

  private edgeTitleAt(clientX: number, clientY: number) {
    const rect = this.app.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.viewportOffset.x + this.options.scroll.scrollLeft) / this.scale;
    const y = (clientY - rect.top - this.viewportOffset.y + this.options.scroll.scrollTop) / this.scale;
    const titleOf = (relations: LanternRelation[]) => relations.map((relation) => `${relation.from} ${relation.arrow} ${relation.to ?? `ext:${relation.ext}`}${relation.symbol ? `#${relation.symbol}` : ''}${relation.label ? ` | ${relation.label}` : ''}`).join('\n');
    const candidates = this.state?.macro
      ? macroTitles(this.state.macro, macroArcView(this.state)).flatMap(({ path, title }) => path.map((curve) => ({ curve, title })))
      : this.state?.relation
        ? this.state.relation.edges.map((edge) => ({ curve: edge.curve, title: titleOf(edge.relations) }))
        : (this.state?.layout.edges ?? []).filter((edge) => edge.fromKey === this.state?.selected || edge.toKey === this.state?.selected).flatMap((edge) => {
          const from = this.state?.layout.pos.get(edge.fromKey);
          const to = this.state?.layout.pos.get(edge.toKey);
          return from && to ? [{ curve: edgeCurve(from, to), title: titleOf([edge.r]) }] : [];
        });
    let closest: { distance: number; title: string } | null = null;
    for (const candidate of candidates) {
      for (let step = 0; step <= 32; step += 1) {
        const t = step / 32;
        const mt = 1 - t;
        const pointX = mt ** 3 * candidate.curve.from.x + 3 * mt ** 2 * t * candidate.curve.control1.x + 3 * mt * t ** 2 * candidate.curve.control2.x + t ** 3 * candidate.curve.to.x;
        const pointY = mt ** 3 * candidate.curve.from.y + 3 * mt ** 2 * t * candidate.curve.control1.y + 3 * mt * t ** 2 * candidate.curve.control2.y + t ** 3 * candidate.curve.to.y;
        const distance = Math.hypot(pointX - x, pointY - y);
        if (distance > 7 / this.scale || closest && distance >= closest.distance) continue;
        closest = { distance, title: candidate.title };
      }
    }
    return closest?.title ?? '';
  }

  dispose() {
    this.disposed = true;
    this.deferredTextQuality.cancel();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.animationFrame);
    this.activeMoves = [];
    this.options.scroll.removeEventListener('scroll', this.scheduleViewport);
    window.removeEventListener('blur', this.clearPointer);
    window.removeEventListener('pointermove', this.trackPointer);
    window.removeEventListener('pointerout', this.leaveWindow);
    window.removeEventListener('resize', this.scheduleViewport);
    this.scrollResize?.disconnect();
    this.accessibility.remove();
    this.buttons.clear();
    for (const retained of this.retained.values()) {
      retained.display?.removeFromParent();
      retained.display?.destroy({ children: true });
    }
    for (const retained of this.groups.values()) {
      retained.display?.removeFromParent();
      retained.display?.destroy({ children: true });
    }
    this.groups.clear();
    this.relationDisplay?.destroy({ children: true });
    this.retained.clear();
    if (this.fonts) Object.values(this.fonts).forEach((name) => { BitmapFont.uninstall(name); });
    if (this.app.renderer) this.app.destroy(true, { children: true });
  }

  private refreshTextQuality(resolution: number) {
    if (this.failed || this.disposed || !this.state || !this.app.renderer) return;
    this.settleAnimation();
    const oldFonts = this.fonts;
    this.fontResolution = resolution;
    document.documentElement.dataset.graphTextResolution = String(resolution);
    for (const retained of this.retained.values()) {
      retained.display?.removeFromParent();
      retained.display?.destroy({ children: true });
      retained.display = null;
    }
    for (const retained of this.groups.values()) {
      retained.display?.removeFromParent();
      retained.display?.destroy({ children: true });
      retained.display = null;
    }
    if (oldFonts) Object.values(oldFonts).forEach((name) => { BitmapFont.uninstall(name); });
    this.fonts = this.installFonts(this.state);
    this.drawColumns(this.state);
    if (this.state.relation) {
      this.relationDisplay?.destroy({ children: true });
      this.relationDisplay = relationGraphics({ layout: this.state.relation, palette: this.palette!, profile: this.state.profile, resolution: this.fontResolution, pinnedAreas: this.pinnedAreas, hoveredArea: this.hoveredArea, onArea: (key) => this.toggleArea(key), onAreaHover: (key) => this.setHoveredArea(key) });
      this.world.addChildAt(this.relationDisplay, 0);
    }
    this.updateViewport();
  }

  private installFonts(state: PixiRenderState): PixiFonts {
    const suffix = String(++fontSetId);
    const fonts = { mono: `lantern-mono-${suffix}`, monoGroup: `lantern-mono-group-${suffix}`, monoBold: `lantern-mono-bold-${suffix}`, monoTile: `lantern-mono-tile-${suffix}` };
    const unique = (values: string[]) => Array.from(new Set(values.join(''))).join('');
    const positions = Array.from(state.layout.pos.values());
    const install = (name: string, family: string, size: number, weight: '400' | '600' | '700', chars: string) => BitmapFont.install({
      name,
      chars,
      resolution: this.fontResolution,
      dynamicFill: true,
      skipKerning: family === this.palette!.mono,
      style: { fontFamily: family, fontSize: size, fontWeight: weight, fill: 0xffffff },
    });
    install(fonts.mono, this.palette!.mono, 11.5, '400', unique([' …', ...positions.map((position) => position.item.label), ...positions.flatMap((position) => position.item.block?.lines ?? [])]));
    install(fonts.monoGroup, this.palette!.mono, 9.5, '600', unique([' … of0123456789',...state.layout.cols.flatMap((column) => column.groups.map((group) => group.dir)), ...positions.map((position) => position.item.block ? captionOf(position.item.block) : '')]));
    install(fonts.monoBold, this.palette!.mono, 9.5, '700', unique([' ↑@~+-', ...positions.map((position) => `${position.item.node?.marker ?? ''}${position.item.node?.owner ?? ''}`)]));
    install(fonts.monoTile, this.palette!.mono, 22, '700', unique([' …·0123456789', ...positions.map((position) => position.item.tile || position.item.block ? position.item.label : '')]));
    return fonts;
  }
}

export { PixiGraph };
