import type { FederatedPointerEvent } from 'pixi.js';

const PRIMARY_BUTTON = 0;

export function isPrimaryTap(event: FederatedPointerEvent) {
  return event.button === PRIMARY_BUTTON;
}
