import type { Point } from './camera';
import { PINCH_SENSITIVITY, WHEEL_SENSITIVITY } from './camera';

const DRAG_THRESHOLD = 4;
const LINE_HEIGHT = 16;
const PAGE_HEIGHT = 120;
const MAX_WHEEL_STEP = 0.5;

interface InputHandlers {
  zoom(factor: number, anchor: Point): void;
  pan(dx: number, dy: number): void;
  press(): void;
  click(target: Element | null): void;
  doubleClick(target: Element | null): void;
}

interface Pointer {
  start: Point;
  last: Point;
}

function relative(root: HTMLElement, event: { clientX: number; clientY: number }): Point {
  const box = root.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

function wheelFactor(event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>) {
  const unit = event.deltaMode === 1 ? LINE_HEIGHT : event.deltaMode === 2 ? PAGE_HEIGHT : 1;
  const sensitivity = event.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY;
  const step = Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, -event.deltaY * unit * sensitivity));
  return Math.exp(step);
}

function targetOf(event: Event): Element | null {
  return event.target instanceof Element ? event.target.closest('[data-key]') : null;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function attachInput(root: HTMLElement, handlers: InputHandlers): () => void {
  const pointers = new Map<number, Pointer>();
  let dragged = false;
  let captured: number | null = null;

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const anchor = relative(root, event);
    if (!event.ctrlKey && event.deltaX && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return handlers.pan(-event.deltaX, 0);
    handlers.zoom(wheelFactor(event), anchor);
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    root.focus({ preventScroll: true });
    handlers.press();
    const point = relative(root, event);
    pointers.set(event.pointerId, { start: point, last: point });
    if (pointers.size === 1) dragged = false;
  };

  const capture = (event: PointerEvent) => {
    if (captured !== null) return;
    captured = event.pointerId;
    root.setPointerCapture(event.pointerId);
    root.classList.add('is-panning');
  };

  const onMove = (event: PointerEvent) => {
    const known = pointers.get(event.pointerId);
    if (!known) return;
    const point = relative(root, event);
    if (pointers.size === 2) return pinch(event.pointerId, point, known);
    if (!dragged && distance(point, known.start) < DRAG_THRESHOLD) return;
    dragged = true;
    capture(event);
    handlers.pan(point.x - known.last.x, point.y - known.last.y);
    known.last = point;
  };

  const pinch = (id: number, point: Point, known: Pointer) => {
    const other = [...pointers].find(([key]) => key !== id)?.[1];
    if (!other) return;
    const before = { a: known.last, b: other.last };
    dragged = true;
    known.last = point;
    const oldDistance = distance(before.a, before.b);
    const newDistance = distance(point, other.last);
    const centre = middle(point, other.last);
    const previous = middle(before.a, before.b);
    handlers.pan(centre.x - previous.x, centre.y - previous.y);
    if (oldDistance > 0) handlers.zoom(newDistance / oldDistance, centre);
  };

  const release = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    if (captured === event.pointerId) {
      captured = null;
      root.classList.remove('is-panning');
      if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    }
  };

  const onUp = (event: PointerEvent) => {
    const wasClick = pointers.size === 1 && !dragged;
    release(event);
    if (wasClick) handlers.click(targetOf(event));
  };

  const onCancel = (event: PointerEvent) => {
    release(event);
    dragged = false;
  };

  const onDouble = (event: MouseEvent) => {
    event.preventDefault();
    handlers.doubleClick(targetOf(event));
  };

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onCancel);
  root.addEventListener('dblclick', onDouble);
  return () => {
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onCancel);
    root.removeEventListener('dblclick', onDouble);
  };
}

export { attachInput, wheelFactor };
export type { InputHandlers };
