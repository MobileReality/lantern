import { ALL_SHOWN, MIN_LEFT, MIN_MIDDLE, browserStore, clampWidths, defaultWidths, maxLeft, maxMiddle, parseWidths } from './lanternpanewidths';
import type { PaneStore, Shown, Widths } from './lanternpanewidths';
import { REGION_NAME, shortcutOf } from './lanternregions';
import type { Region, Regions } from './lanternregions';

interface Panes {
  setActive(on: boolean): void;
  reset(): void;
  dispose(): void;
}

interface PaneOptions {
  store?: PaneStore;
  regions: Regions;
  main: HTMLElement;
}

type Columnar = 'list' | 'viewer' | 'graph';

const KEY_STEP_PX = 16;
const KEY_STEP_BIG_PX = 64;
const OFF_CLASS = 'lt-region-off';
const COLUMNAR: readonly Columnar[] = ['list', 'viewer', 'graph'];
const RAIL_ARROW = '»';
const RAIL_ARROW_BACK = '«';

function divider(label: string) {
  const handle = document.createElement('div');
  handle.className = 'lt-split';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', label);
  handle.tabIndex = 0;
  return handle;
}

function railFor(region: Columnar) {
  const rail = document.createElement('button');
  rail.type = 'button';
  rail.className = `lt-rail ${OFF_CLASS}`;
  rail.dataset.rail = region;
  rail.setAttribute('aria-label', `Show the ${REGION_NAME[region]}`);
  rail.dataset.tip = `Show the ${REGION_NAME[region]} (${shortcutOf(region)})`;
  const arrow = document.createElement('span');
  arrow.className = 'lt-rail-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = region === 'graph' ? RAIL_ARROW_BACK : RAIL_ARROW;
  const label = document.createElement('span');
  label.className = 'lt-rail-label';
  label.textContent = REGION_NAME[region];
  rail.append(arrow, label);
  return rail;
}

function mountPanes(grid: HTMLElement, side: HTMLElement, middle: HTMLElement, options: PaneOptions): Panes {
  const { regions, main } = options;
  const store = options.store ?? browserStore();
  const leftHandle = divider('Resize the file list');
  const middleHandle = divider('Resize the file and diff pane');
  const rails: Record<Columnar, HTMLButtonElement> = { list: railFor('list'), viewer: railFor('viewer'), graph: railFor('graph') };
  const columns: Record<Columnar, HTMLElement> = { list: side, viewer: middle, graph: main };
  let widths = store.load();
  let active = false;
  let observer: ResizeObserver | undefined;

  function shownNow(): Shown {
    if (!active) return ALL_SHOWN;
    return { list: !regions.isHidden('list'), viewer: !regions.isHidden('viewer'), graph: !regions.isHidden('graph') };
  }

  function measure(): Widths {
    const shown = shownNow();
    const kept = widths ?? defaultWidths(grid.clientWidth);
    const left = shown.list ? side.getBoundingClientRect().width : 0;
    const middleWidth = shown.viewer && shown.graph ? middle.getBoundingClientRect().width : 0;
    return { left: left > 0 ? left : kept.left, middle: middleWidth > 0 ? middleWidth : kept.middle };
  }

  function paintAria(now: Widths, total: number, shown: Shown) {
    leftHandle.setAttribute('aria-valuemin', String(MIN_LEFT));
    leftHandle.setAttribute('aria-valuemax', String(Math.max(MIN_LEFT, Math.round(maxLeft(total, shown)))));
    leftHandle.setAttribute('aria-valuenow', String(Math.round(now.left)));
    middleHandle.setAttribute('aria-valuemin', String(MIN_MIDDLE));
    middleHandle.setAttribute('aria-valuemax', String(Math.max(MIN_MIDDLE, Math.round(maxMiddle(total, now.left, shown)))));
    middleHandle.setAttribute('aria-valuenow', String(Math.round(now.middle)));
  }

  function paint(next: Widths) {
    const total = grid.clientWidth;
    const shown = shownNow();
    const clamped = clampWidths(next, total, shown);
    grid.style.setProperty('--lt-pane-left', `${clamped.left}px`);
    grid.style.setProperty('--lt-pane-mid', `${clamped.middle}px`);
    paintAria(clamped, total, shown);
    return clamped;
  }

  function apply(next: Widths) {
    widths = paint(next);
  }

  function change(next: Widths) {
    apply(next);
    if (widths) store.save(widths);
  }

  function drag(handle: HTMLElement, resize: (start: Widths, dx: number) => Widths) {
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const start = measure();
      const from = ev.clientX;
      handle.setPointerCapture?.(ev.pointerId);
      handle.classList.add('dragging');
      const move = (e: PointerEvent) => apply(resize(start, e.clientX - from));
      const stop = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        handle.classList.remove('dragging');
        if (widths) store.save(widths);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    });
  }

  function keys(handle: HTMLElement, resize: (start: Widths, dx: number) => Widths, edge: (start: Widths, toMax: boolean) => Widths) {
    handle.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? KEY_STEP_BIG_PX : KEY_STEP_PX;
      const start = measure();
      let next: Widths;
      if (ev.key === 'ArrowLeft') next = resize(start, -step);
      else if (ev.key === 'ArrowRight') next = resize(start, step);
      else if (ev.key === 'Home') next = edge(start, false);
      else if (ev.key === 'End') next = edge(start, true);
      else return;
      ev.preventDefault();
      change(next);
    });
  }

  const resizeLeft = (start: Widths, dx: number): Widths => ({ ...start, left: start.left + dx });
  const resizeMiddle = (start: Widths, dx: number): Widths => ({ ...start, middle: start.middle + dx });
  drag(leftHandle, resizeLeft);
  drag(middleHandle, resizeMiddle);
  keys(leftHandle, resizeLeft, (start, toMax) => ({ ...start, left: toMax ? Number.MAX_SAFE_INTEGER : 0 }));
  keys(middleHandle, resizeMiddle, (start, toMax) => ({ ...start, middle: toMax ? Number.MAX_SAFE_INTEGER : 0 }));

  function paintRegions() {
    const shown = shownNow();
    for (const region of COLUMNAR) {
      grid.classList.toggle(`lt-hide-${region}`, active && !shown[region]);
      columns[region].classList.toggle(OFF_CLASS, active && !shown[region]);
      rails[region].classList.toggle(OFF_CLASS, !active || shown[region]);
    }
    leftHandle.classList.toggle(OFF_CLASS, !shown.list);
    middleHandle.classList.toggle(OFF_CLASS, !(shown.viewer && shown.graph));
    if (widths) paint(widths);
    else paintAria(measure(), grid.clientWidth, shown);
  }

  function handOverFocus(region: Region, held: Element | null) {
    if (region === 'foundation') return;
    const column = columns[region];
    if (regions.isHidden(region)) {
      if (held && column.contains(held)) rails[region].focus({ preventScroll: true });
      return;
    }
    focusColumn(region);
  }

  function focusColumn(region: Columnar) {
    if (region === 'list') side.tabIndex = -1;
    columns[region].focus({ preventScroll: true });
  }

  for (const region of COLUMNAR) rails[region].addEventListener('click', () => regions.show(region));

  regions.onChange((region) => {
    if (!active) return;
    const held = document.activeElement;
    paintRegions();
    if (region) return handOverFocus(region, held);
    for (const each of COLUMNAR) if (held === rails[each]) focusColumn(each);
  });

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      if (active && widths) paint(widths);
    });
    observer.observe(grid);
  }

  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      grid.classList.toggle('lt-review-on', on);
      if (!on) {
        for (const region of COLUMNAR) {
          grid.classList.remove(`lt-hide-${region}`);
          columns[region].classList.remove(OFF_CLASS);
          rails[region].remove();
        }
        leftHandle.remove();
        middle.remove();
        middleHandle.remove();
        return;
      }
      rails.list.classList.add(OFF_CLASS);
      side.before(rails.list);
      side.after(leftHandle);
      leftHandle.after(rails.viewer);
      rails.viewer.after(middle);
      middle.after(middleHandle);
      main.after(rails.graph);
      paintRegions();
    },
    reset() {
      widths = null;
      store.clear();
      grid.style.removeProperty('--lt-pane-left');
      grid.style.removeProperty('--lt-pane-mid');
      regions.showAll();
      if (active) paintRegions();
    },
    dispose() {
      observer?.disconnect();
    },
  };
}

export { clampWidths, defaultWidths, mountPanes, parseWidths };
export type { PaneStore, Panes, Widths };
