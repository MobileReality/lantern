interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const POPOVER_WIDTH = 340;
const GAP = 6;
const EDGE = 8;
const REOPEN_GUARD_MS = 250;

const hasArea = (rect: Rect) => rect.width > 0 && rect.height > 0;

export function popoverBounds(anchor: Rect, height: number, workArea: Rect): Rect {
  const rightLimit = workArea.x + workArea.width - POPOVER_WIDTH - EDGE;
  const leftLimit = workArea.x + EDGE;
  const centred = hasArea(anchor) ? anchor.x + anchor.width / 2 - POPOVER_WIDTH / 2 : rightLimit;
  const y = hasArea(anchor) ? Math.max(anchor.y + anchor.height, workArea.y) + GAP : workArea.y + GAP;
  const room = workArea.y + workArea.height - y - EDGE;
  return { x: Math.round(Math.min(Math.max(centred, leftLimit), rightLimit)), y: Math.round(y), width: POPOVER_WIDTH, height: Math.max(1, Math.min(Math.ceil(height), room)) };
}

export function maxPopoverHeight(anchor: Rect, workArea: Rect): number {
  return popoverBounds(anchor, Number.MAX_SAFE_INTEGER, workArea).height;
}

// A click on the icon blurs the open popover first, so the click that follows must not reopen it.
export function shouldOpen(lastHiddenAt: number, now: number): boolean {
  return now - lastHiddenAt > REOPEN_GUARD_MS;
}
