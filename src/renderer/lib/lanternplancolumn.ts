import { DIVIDER_PX, MIN_RIGHT, between } from './lanternpanewidths';
import { VIEW, say } from '../../shared/lantern-plan-messages';

interface PlanColumn {
  setActive(on: boolean): void;
  dispose(): void;
}

const MIN_PLAN = 320;
const KEY_STEP_PX = 16;
const KEY_STEP_BIG_PX = 64;
const COLUMN_PROPERTY = '--lt-plan-col';
const remembered = new Map<string, number>();

function planColumnMax(total: number) {
  return total - DIVIDER_PX - MIN_RIGHT;
}

function clampPlanColumn(width: number, total: number) {
  if (total <= 0) return width;
  return between(width, MIN_PLAN, planColumnMax(total));
}

function mountPlanColumn(grid: HTMLElement, planPane: HTMLElement, project: string): PlanColumn {
  const handle = document.createElement('div');
  handle.className = 'lt-split lt-plansplit';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', say(VIEW.COLUMN_RESIZE));
  handle.tabIndex = 0;
  let active = false;
  let observer: ResizeObserver | undefined;

  function measure() {
    return remembered.get(project) ?? planPane.getBoundingClientRect().width;
  }

  function paintAria(now: number) {
    handle.setAttribute('aria-valuemin', String(MIN_PLAN));
    handle.setAttribute('aria-valuemax', String(Math.max(MIN_PLAN, Math.round(planColumnMax(grid.clientWidth)))));
    handle.setAttribute('aria-valuenow', String(Math.round(now)));
  }

  function paint(width: number) {
    const clamped = clampPlanColumn(width, grid.clientWidth);
    grid.style.setProperty(COLUMN_PROPERTY, `${clamped}px`);
    paintAria(clamped);
    return clamped;
  }

  function apply(width: number) {
    remembered.set(project, paint(width));
  }

  handle.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const start = measure();
    const from = ev.clientX;
    handle.setPointerCapture?.(ev.pointerId);
    handle.classList.add('dragging');
    const move = (e: PointerEvent) => apply(start + e.clientX - from);
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      handle.classList.remove('dragging');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });

  handle.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? KEY_STEP_BIG_PX : KEY_STEP_PX;
    const start = measure();
    let next: number;
    if (ev.key === 'ArrowLeft') next = start - step;
    else if (ev.key === 'ArrowRight') next = start + step;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = Number.MAX_SAFE_INTEGER;
    else return;
    ev.preventDefault();
    apply(next);
  });

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      const kept = remembered.get(project);
      if (active && kept !== undefined) paint(kept);
    });
    observer.observe(grid);
  }

  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      if (!on) {
        handle.remove();
        grid.style.removeProperty(COLUMN_PROPERTY);
        return;
      }
      planPane.after(handle);
      const kept = remembered.get(project);
      if (kept !== undefined) paint(kept);
      else paintAria(planPane.getBoundingClientRect().width);
    },
    dispose() {
      observer?.disconnect();
    },
  };
}

export { MIN_PLAN, clampPlanColumn, mountPlanColumn };
export type { PlanColumn };
