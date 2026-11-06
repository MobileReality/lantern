import type { MacroViewContext, MountedMacroView } from './types';
import { dive, pickKey, run, selectKey, zoomCentre } from './actions';
import { createScene } from './build';
import { createChrome, stopBubbling } from './chrome';
import { MOVES, SYSTEM_CHIP, dockView, neighbourOf, paintDock } from './dock';
import { createCameraDriver } from './driver';
import type { FileList } from './files';
import { topFiles } from './files';
import { areaCamera, fitAll, followHost, syncEntered } from './follow';
import { relatedTo } from './focus';
import type { Related } from './focus';
import { attachInput } from './input';
import { ZOOM_IN, ZOOM_OUT, actionOf } from './keys';
import { layoutMacroView } from './layout';
import { drawHot, drawLinks } from './links';
import { deriveMarks } from './marks';
import { buildModel } from './model';
import { FILE_PREFIX, levelAtCentre } from './navigation';
import { paintScene } from './paint';
import type { Session } from './session';
import { applyState } from './state';

const ASPECT_STEP = 0.25;
const ASPECT_RANGE = { low: 0.75, high: 2.5 };
const LEVEL_NAMES = { areas: 'Overview', features: 'Features', files: 'Files' } as const;

let sequence = 0;

function aspectOf(width: number, height: number) {
  const raw = height > 0 ? width / height : 1.5;
  return Math.min(ASPECT_RANGE.high, Math.max(ASPECT_RANGE.low, Math.round(raw / ASPECT_STEP) * ASPECT_STEP));
}

function sourceKey(ctx: MacroViewContext) {
  const { payload } = ctx;
  return [payload.areas, payload.view, payload.texts, payload.blockByPath, payload.systemsByPath];
}

function sameSource(a: unknown[], b: unknown[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function prefersCalm() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function createMacroView(host: HTMLElement, first: MacroViewContext): MountedMacroView {
  const uid = `mv${sequence++}`;
  const chrome = createChrome();
  stopBubbling(chrome.bar);
  host.appendChild(chrome.shell);
  let source = sourceKey(first);
  let aspect = aspectOf(chrome.root.clientWidth, chrome.root.clientHeight);
  const model = buildModel(first.payload);
  const layout = layoutMacroView(model, aspect);
  const entered = first.scene.level === 'area' ? (first.scene.area?.id ?? null) : null;
  const rowIds = { next: 0 };
  let lists = new Map<string, FileList>();
  let destroyed = false;
  let world = layout.world;
  let related: Related = relatedTo(model, null);

  const session: Session = {
    ctx: first,
    model,
    layout,
    scene: createScene(layout, model, uid),
    marks: deriveMarks(model, first),
    driver: createCameraDriver({
      world: () => world,
      onChange: (animating) => {
        paint();
        if (!animating && !destroyed) syncEntered(session);
      },
      onSettled: () => syncEntered(session),
      reducedMotion: prefersCalm,
    }),
    entered,
    lastFocus: entered,
    anchor: null,
    framing: entered ? 'free' : 'all',
    focusKey: null,
    pickedFile: null,
    showAll: false,
    repaint: () => repaintAll(),
  };
  chrome.root.prepend(session.scene.svg);

  const listOf = (featureId: string): FileList => {
    const known = lists.get(featureId);
    if (known) return known;
    const made = topFiles(session.model.filesOf.get(featureId) ?? [], session.marks);
    lists.set(featureId, made);
    return made;
  };

  function paint() {
    if (destroyed) return;
    const { driver, scene, model: current, marks, focusKey, pickedFile } = session;
    const camera = driver.camera();
    const viewport = driver.viewport();
    paintScene({ scene, model: current, camera, viewport, marks, listOf, counter: rowIds, focusKey, pickedFile, counts: related.counts });
    const ratio = camera.k / driver.fit().k;
    const level = levelAtCentre({ layout: session.layout, camera, viewport });
    chrome.root.dataset.level = level;
    chrome.root.dataset.zoom = ratio.toFixed(2);
    chrome.root.dataset.entered = session.entered ?? '';
    const text = `${LEVEL_NAMES[level]} · ${Math.round(ratio * 100)}%`;
    if (chrome.readout.textContent !== text) chrome.readout.textContent = text;
  }

  function activeId() {
    const { scene, focusKey } = session;
    if (!focusKey) return null;
    const item = scene.items.get(focusKey);
    if (item) return item.g.id;
    const rows = scene.areas.flatMap((area) => area.features).flatMap((feature) => feature.rows);
    return rows.find((row) => `${FILE_PREFIX}${row.path}` === focusKey)?.g.id ?? null;
  }

  function pickedFileOfSelection() {
    const { pickedFile, ctx, model: current } = session;
    const owner = pickedFile ? current.features.get(ctx.payload.blockByPath[pickedFile] ?? '') : undefined;
    return pickedFile && owner && owner.key === ctx.selection ? pickedFile : null;
  }

  function refreshState() {
    const { scene, model: current, marks, ctx, focusKey } = session;
    const file = pickedFileOfSelection();
    related = relatedTo(current, ctx.selection, ctx.foundation, file);
    const system = current.systems.find((candidate) => candidate.key === ctx.selection);
    applyState({ scene, model: current, marks, selection: ctx.selection, related, focusKey, systemName: system?.name ?? null });
    chrome.root.classList.toggle('is-dimmed', !!ctx.selection || !!marks.flow || !!marks.reading.file || !!marks.plan);
    drawLinks(scene, current, marks);
    drawHot(scene, current, ctx.selection);
    paintDock(chrome.dock, dockView({ model: current, marks, related, selection: ctx.selection, showAll: session.showAll, file }));
    const active = activeId();
    if (active) chrome.root.setAttribute('aria-activedescendant', active);
    else chrome.root.removeAttribute('aria-activedescendant');
  }

  function repaintAll() {
    refreshState();
    paint();
  }

  function rebuildScene() {
    session.scene.svg.remove();
    session.layout = layoutMacroView(session.model, aspect);
    world = session.layout.world;
    session.scene = createScene(session.layout, session.model, uid);
    chrome.root.prepend(session.scene.svg);
    lists = new Map();
    session.focusKey = null;
  }

  const onKey = (event: KeyboardEvent) => {
    if (destroyed || event.defaultPrevented || event.target !== chrome.root) return;
    const action = actionOf(event);
    if (!action) return;
    const sideways = action.type === 'move' && (action.direction === 'left' || action.direction === 'right');
    if (sideways && session.ctx.reading.file) return;
    chrome.root.classList.add('is-keyboard');
    if (!run(session, action)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const keyOf = (target: Element | null) => target?.getAttribute('data-key') ?? null;

  const detachInput = attachInput(chrome.root, {
    zoom: (factor, point) => {
      session.framing = 'free';
      session.anchor = point;
      session.driver.zoomBy(factor, point);
    },
    pan: (dx, dy) => {
      session.framing = 'free';
      session.driver.panBy(dx, dy);
    },
    press: () => chrome.root.classList.remove('is-keyboard'),
    click: (target) => {
      session.focusKey = keyOf(target);
      pickKey(session, session.focusKey);
      repaintAll();
    },
    doubleClick: (target) => {
      const key = keyOf(target);
      if (key) dive(session, key);
      else fitAll(session);
    },
  });

  chrome.dock.root.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('[data-dock-toggle]')) {
      session.showAll = !session.showAll;
      return repaintAll();
    }
    const key = keyOf(target.closest('[data-key]'));
    if (key) selectKey(session, key);
  });

  const onDockKey = (event: KeyboardEvent) => {
    if (destroyed || event.defaultPrevented || !(event.target instanceof HTMLElement) || !chrome.dock.root.contains(event.target)) return;
    if (event.key === 'Escape' && session.ctx.selection) {
      session.ctx.select(null);
    } else if (MOVES.includes(event.key) && chrome.dock.list.contains(event.target)) {
      neighbourOf([...chrome.dock.list.querySelectorAll<HTMLElement>(`.${SYSTEM_CHIP}`)], event.target, event.key)?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('keydown', onDockKey, true);

  chrome.bar.addEventListener('click', (event) => {
    const which = (event.target as Element).closest('[data-zoom]')?.getAttribute('data-zoom');
    if (which === 'fit') fitAll(session);
    else if (which) zoomCentre(session, which === 'in' ? ZOOM_IN : ZOOM_OUT);
  });

  window.addEventListener('keydown', onKey, true);

  function resize() {
    const width = chrome.root.clientWidth;
    const height = chrome.root.clientHeight;
    session.driver.setViewport({ w: width, h: height });
    const next = aspectOf(width, height);
    if (next !== aspect && width > 0) {
      aspect = next;
      rebuildScene();
      refreshState();
    }
    if (session.framing === 'all') session.driver.jump(session.driver.fit());
    else paint();
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(chrome.root);

  function update(next: MacroViewContext) {
    if (next.selection !== session.ctx.selection) session.showAll = false;
    session.ctx = next;
    const owner = session.pickedFile ? next.payload.blockByPath[session.pickedFile] : undefined;
    if (session.pickedFile && next.selection !== session.model.features.get(owner ?? '')?.key) session.pickedFile = null;
    const incoming = sourceKey(next);
    if (!sameSource(source, incoming)) {
      source = incoming;
      session.model = buildModel(next.payload);
      rebuildScene();
    }
    session.marks = deriveMarks(session.model, next);
    lists = new Map();
    followHost(session, next);
    repaintAll();
  }

  resize();
  const startCamera = entered ? areaCamera(session, entered) : null;
  if (startCamera) session.driver.jump(startCamera);
  repaintAll();

  return {
    update,
    destroy() {
      destroyed = true;
      detachInput();
      observer?.disconnect();
      session.driver.destroy();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keydown', onDockKey, true);
      chrome.shell.remove();
    },
  };
}

export { createMacroView };
