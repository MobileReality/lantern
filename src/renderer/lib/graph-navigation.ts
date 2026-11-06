const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const SCALE_STEP = 0.1;
const PAN_STEP = 48;
const MAX_OVERSCROLL = 20;
const OVERSCROLL_RESISTANCE = 3;
const DRAG_THRESHOLD = 3;
const READABLE_WIDTH = 1000;

interface GraphNavigationOptions {
  main: HTMLElement;
  overlayHost: HTMLElement;
  applyScale: (scale: number) => void;
  applyOverscroll?: (x: number, y: number) => void;
  isActive?: () => boolean;
  yieldsKey?: (event: KeyboardEvent) => boolean;
}

interface GraphNavigation {
  setContent(width: number): void;
  scale(): number;
  dispose(): void;
}

interface DeferredContextMenu {
  target: EventTarget;
  event: MouseEventInit;
}

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function fitScale(viewportWidth: number, contentWidth: number, wholeWidth = false) {
  if (!contentWidth) return 1;
  if (!wholeWidth) return Math.min(1, Math.max(viewportWidth, Math.min(contentWidth, READABLE_WIDTH)) / contentWidth);
  if (viewportWidth <= 0) return 1;
  return Math.min(1, viewportWidth / contentWidth);
}

let measuredScrollbar: number | null = null;

function scrollbarWidth() {
  if (measuredScrollbar !== null) return measuredScrollbar;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:100px;height:100px;overflow:scroll';
  document.body.appendChild(probe);
  measuredScrollbar = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return measuredScrollbar;
}

// A vertical scrollbar that appears or goes away narrows the pane, so fitting to the raw width would flip between two scales.
function stableWidth(main: HTMLElement) {
  const bar = scrollbarWidth();
  const barShown = bar > 0 && main.offsetWidth - main.clientWidth >= bar;
  return main.clientWidth - (barShown ? 0 : bar);
}

function anchoredScroll(scroll: number, anchor: number, previousScale: number, nextScale: number) {
  return (scroll + anchor) * nextScale / previousScale - anchor;
}

function resistOverscroll(current: number, delta: number) {
  const remaining = (MAX_OVERSCROLL - Math.abs(current)) * Math.exp(-Math.abs(delta) / (MAX_OVERSCROLL * OVERSCROLL_RESISTANCE));
  return Math.sign(delta) * (MAX_OVERSCROLL - remaining);
}

function exceedsDragThreshold(startX: number, startY: number, x: number, y: number) {
  return Math.abs(x - startX) + Math.abs(y - startY) > DRAG_THRESHOLD;
}

function mountGraphNavigation(options: GraphNavigationOptions): GraphNavigation {
  const { main, applyScale } = options;
  let width = 0;
  let currentScale = 1;
  let mode: 'fit' | 'manual' = 'fit';
  let fitsWholeWidth = false;
  let editingScale = currentScale;
  let editingMode: 'fit' | 'manual' = mode;
  let editingText = '';
  let canceledEdit = false;
  let lastInputWasTab = false;
  let spaceDown = false;
  let pan: { pointerId: number; button: number; x: number; y: number; startX: number; startY: number; moved: boolean; active: boolean; contextMenu: DeferredContextMenu | null } | null = null;
  let suppressClick = false;
  let completedRight: { dragged: boolean; delivered: boolean } | null = null;
  let replayingContextMenu = false;
  let overscroll = { x: 0, y: 0 };
  let settleFrame = 0;
  const applyOverscroll = () => {
    main.style.setProperty('--lt-pan-x', `${overscroll.x}px`);
    main.style.setProperty('--lt-pan-y', `${overscroll.y}px`);
    options.applyOverscroll?.(overscroll.x, overscroll.y);
  };
  const clearOverscroll = (animate = false) => {
    cancelAnimationFrame(settleFrame);
    settleFrame = 0;
    if (!overscroll.x && !overscroll.y) return;
    if (!animate || !options.applyOverscroll || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      overscroll = { x: 0, y: 0 };
      applyOverscroll();
      return;
    }
    const start = { ...overscroll };
    const started = performance.now();
    const settle = (now: number) => {
      const remaining = Math.pow(1 - Math.min(1, (now - started) / 180), 3);
      overscroll = { x: start.x * remaining, y: start.y * remaining };
      applyOverscroll();
      if (remaining) settleFrame = requestAnimationFrame(settle);
      else settleFrame = 0;
    };
    settleFrame = requestAnimationFrame(settle);
  };
  const panBy = (dx: number, dy: number) => {
    main.scrollLeft += dx;
    main.scrollTop += dy;
  };
  const dragAxis = (delta: number, axis: 'x' | 'y') => {
    let remainder = delta;
    const current = overscroll[axis];
    if (current && Math.sign(current) !== Math.sign(delta)) {
      const consumed = Math.min(Math.abs(current), Math.abs(delta));
      overscroll[axis] = current - Math.sign(current) * consumed;
      remainder += Math.sign(current) * consumed;
    }
    if (!remainder) return;
    const scrollKey = axis === 'x' ? 'scrollLeft' : 'scrollTop';
    const before = main[scrollKey];
    main[scrollKey] -= remainder;
    const unconsumed = remainder + main[scrollKey] - before;
    if (unconsumed) overscroll[axis] = resistOverscroll(overscroll[axis], unconsumed);
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'lt-zoom';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Graph zoom controls');
  toolbar.dataset.tip = 'Zoom the graph. Hold Space and drag, middle-drag, or right-drag to pan.';
  toolbar.innerHTML = `<button type="button" data-zoom-out aria-label="Zoom out" data-tip="Zoom out (−)">−</button><input data-zoom-value aria-label="Graph zoom percentage" inputmode="decimal" spellcheck="false"><button type="button" data-zoom-in aria-label="Zoom in" data-tip="Zoom in (+)">+</button><button type="button" data-zoom-natural data-tip="Actual size (Ctrl/⌘ 0)">100%</button><button type="button" data-zoom-fit data-tip="Fit width (Shift 1)">Fit</button>`;
  options.overlayHost.appendChild(toolbar);
  const input = toolbar.querySelector('[data-zoom-value]') as HTMLInputElement;

  const syncInput = () => {
    input.value = `${Math.round(currentScale * 100)}%`;
  };

  const setScale = (next: number, anchorX = main.clientWidth / 2, anchorY = main.clientHeight / 2) => {
    clearOverscroll();
    if (currentScale < MIN_SCALE && next < currentScale) return;
    const bounded = clampScale(next);
    const left = anchoredScroll(main.scrollLeft, anchorX, currentScale, bounded);
    const top = anchoredScroll(main.scrollTop, anchorY, currentScale, bounded);
    currentScale = bounded;
    mode = 'manual';
    applyScale(currentScale);
    main.scrollLeft = left;
    main.scrollTop = top;
    syncInput();
  };

  const applyFit = (wholeWidth = fitsWholeWidth) => {
    clearOverscroll();
    mode = 'fit';
    fitsWholeWidth = wholeWidth;
    currentScale = wholeWidth ? fitScale(stableWidth(main), width, true) : fitScale(main.clientWidth, width);
    applyScale(currentScale);
    syncInput();
  };

  const commitInput = () => {
    if (canceledEdit) { canceledEdit = false; return; }
    const value = input.value.trim();
    if (value === editingText) return syncInput();
    const match = value.match(/^(?:\d+(?:\.\d+)?|\.\d+)\s*%?$/);
    const parsed = match ? Number(match[0].replace('%', '').trim()) : Number.NaN;
    if (Number.isFinite(parsed)) setScale(parsed / 100);
    else syncInput();
  };

  const isEditable = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
  const isEnabled = () => (options.isActive?.() ?? true) && !main.closest('.hidden, [hidden]') && !document.querySelector('.modal:not(.hidden)');

  toolbar.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button');
    if (!button) return;
    if (button.hasAttribute('data-zoom-out')) setScale(currentScale - SCALE_STEP);
    else if (button.hasAttribute('data-zoom-in')) setScale(currentScale + SCALE_STEP);
    else if (button.hasAttribute('data-zoom-natural')) setScale(1);
    else applyFit(true);
  });
  input.addEventListener('focus', () => { editingScale = currentScale; editingMode = mode; editingText = input.value; canceledEdit = false; input.select(); });
  input.addEventListener('blur', commitInput);
  const cancelInput = () => {
    canceledEdit = true;
    currentScale = editingScale;
    mode = editingMode;
    applyScale(currentScale);
    syncInput();
    input.blur();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelInput();
    }
  });

  const onWheel = (event: WheelEvent) => {
    if (!isEnabled()) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = main.getBoundingClientRect();
      setScale(currentScale * Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top);
    } else if (event.shiftKey && event.deltaX === 0) {
      event.preventDefault();
      panBy(event.deltaY, 0);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    suppressClick = false;
    if (!isEnabled() || (event.target as Element).closest('.lt-zoom') || (![1, 2].includes(event.button) && !(event.button === 0 && spaceDown))) return;
    const active = event.button !== 2;
    if (active) {
      event.preventDefault();
      event.stopPropagation();
      main.focus({ preventScroll: true });
      clearOverscroll();
      main.classList.add('lt-panning');
      main.setPointerCapture(event.pointerId);
    }
    pan = { pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, active, contextMenu: null };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (pan.button === 2 && !(event.buttons & 2)) {
      finishPan(event);
      return;
    }
    if (exceedsDragThreshold(pan.startX, pan.startY, event.clientX, event.clientY)) pan.moved = true;
    if (!pan.active && !pan.moved) return;
    if (!pan.active) {
      pan.active = true;
      main.focus({ preventScroll: true });
      clearOverscroll();
      main.classList.add('lt-panning');
      main.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    dragAxis(dx, 'x');
    dragAxis(dy, 'y');
    applyOverscroll();
    pan.x = event.clientX;
    pan.y = event.clientY;
  };
  const finishPan = (event?: PointerEvent, shouldSuppressClick = false) => {
    if (!pan || (event && pan.pointerId !== event.pointerId)) return;
    const completed = pan;
    pan = null;
    if (completed.active) event?.stopPropagation();
    suppressClick = shouldSuppressClick && completed.moved;
    const rightReleased = completed.button === 2 && event?.type === 'pointerup';
    completedRight = rightReleased ? { dragged: completed.moved, delivered: false } : null;
    if (main.hasPointerCapture(completed.pointerId)) main.releasePointerCapture(completed.pointerId);
    if (completed.active) {
      main.classList.remove('lt-panning');
      clearOverscroll(true);
    }
    if (rightReleased && !completed.moved && completed.contextMenu) {
      const right = completedRight;
      if (right) right.delivered = true;
      replayingContextMenu = true;
      try {
        completed.contextMenu.target.dispatchEvent(new MouseEvent('contextmenu', completed.contextMenu.event));
      } finally {
        replayingContextMenu = false;
      }
    }
  };
  const onPointerUp = (event: PointerEvent) => finishPan(event, pan?.button === 0);
  const onClick = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const onContextMenu = (event: MouseEvent) => {
    if (replayingContextMenu) return;
    if (pan?.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      if (!pan.moved && !pan.contextMenu) {
        // Electron emits contextmenu on right-down, before movement reveals whether this is a click or drag.
        pan.contextMenu = {
          target: event.target ?? main,
          event: {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 2,
            buttons: 0,
            clientX: event.clientX,
            clientY: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
          },
        };
      }
      return;
    }
    if (!completedRight || event.button !== 2) {
      completedRight = null;
      return;
    }
    if (!completedRight.dragged && !completedRight.delivered) {
      completedRight.delivered = true;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    lastInputWasTab = event.key === 'Tab';
    const active = document.activeElement;
    if (!isEnabled()) return;
    if (event.key === ' ' && !isEditable(event.target)) {
      spaceDown = true;
      main.classList.add('lt-pan-ready');
      if (event.target === main || (main.matches(':hover') && !main.contains(active))) event.preventDefault();
      return;
    }
    if (!main.contains(active) && !toolbar.contains(active)) return;
    if (event.target === input && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelInput();
      return;
    }
    if (isEditable(event.target) || options.yieldsKey?.(event)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key === '0') setScale(1);
    else if (event.shiftKey && event.code === 'Digit1') applyFit(true);
    else if (['+', '='].includes(event.key)) setScale(currentScale + SCALE_STEP);
    else if (['-', '_'].includes(event.key)) setScale(currentScale - SCALE_STEP);
    else if (event.target === main && event.key.startsWith('Arrow')) {
      const amount = PAN_STEP * (event.shiftKey ? 4 : 1);
      if (event.key === 'ArrowLeft') panBy(-amount, 0);
      else if (event.key === 'ArrowRight') panBy(amount, 0);
      else if (event.key === 'ArrowUp') panBy(0, -amount);
      else panBy(0, amount);
    } else return;
    event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== ' ') return;
    spaceDown = false;
    main.classList.remove('lt-pan-ready');
    if (pan?.button === 0) finishPan(undefined, true);
  };
  const onBlur = () => { spaceDown = false; suppressClick = false; completedRight = null; main.classList.remove('lt-pan-ready'); finishPan(); clearOverscroll(); };
  const onSurfacePointerDown = (event: PointerEvent) => {
    lastInputWasTab = false;
    main.classList.remove('lt-tab-focus');
    if (event.button === 0 && !(event.target as Element).closest('button, input')) main.focus({ preventScroll: true });
    onPointerDown(event);
  };
  const onFocus = () => main.classList.toggle('lt-tab-focus', lastInputWasTab);
  const onFocusOut = () => main.classList.remove('lt-tab-focus');
  const onDocumentPointerDown = () => { completedRight = null; };

  main.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  main.addEventListener('pointerdown', onSurfacePointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', finishPan, true);
  main.addEventListener('lostpointercapture', finishPan);
  main.addEventListener('click', onClick, true);
  main.addEventListener('contextmenu', onContextMenu, true);
  main.addEventListener('focus', onFocus);
  main.addEventListener('blur', onFocusOut);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { clearOverscroll(); if (mode === 'fit') applyFit(); else applyScale(currentScale); });
  observer?.observe(main);
  main.tabIndex = 0;
  syncInput();

  return {
    setContent(nextWidth) {
      clearOverscroll();
      width = nextWidth;
      if (mode === 'fit') applyFit();
      else applyScale(currentScale);
    },
    scale: () => currentScale,
    dispose() {
      observer?.disconnect();
      finishPan();
      completedRight = null;
      clearOverscroll();
      main.classList.remove('lt-pan-ready');
      main.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      main.removeEventListener('pointerdown', onSurfacePointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', finishPan, true);
      main.removeEventListener('lostpointercapture', finishPan);
      main.removeEventListener('click', onClick, true);
      main.removeEventListener('contextmenu', onContextMenu, true);
      main.removeEventListener('focus', onFocus);
      main.removeEventListener('blur', onFocusOut);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      toolbar.remove();
      main.style.removeProperty('--lt-pan-x');
      main.style.removeProperty('--lt-pan-y');
      main.classList.remove('lt-tab-focus');
    },
  };
}

export { anchoredScroll, clampScale, exceedsDragThreshold, fitScale, mountGraphNavigation, resistOverscroll };
export type { GraphNavigation };
