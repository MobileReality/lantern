import type { Direction } from './focus';

type KeyAction =
  | { type: 'zoom'; factor: number }
  | { type: 'fit' }
  | { type: 'move'; direction: Direction }
  | { type: 'pan'; direction: Direction }
  | { type: 'dive' }
  | { type: 'out' }
  | { type: 'pick' };

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

const ZOOM_IN = 1.4;
const ZOOM_OUT = 1 / ZOOM_IN;
const ARROWS: Readonly<Record<string, Direction>> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function actionOf(event: KeyLike): KeyAction | null {
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) return null;
  if (event.key === '0' && !event.shiftKey) return { type: 'fit' };
  if (event.key === '+' || event.key === '=') return { type: 'zoom', factor: ZOOM_IN };
  if (event.key === '-' || event.key === '_') return { type: 'zoom', factor: ZOOM_OUT };
  if (event.key === 'Home') return { type: 'fit' };
  if (event.key === 'Enter') return { type: 'dive' };
  if (event.key === 'Escape') return { type: 'out' };
  if (event.key === ' ') return { type: 'pick' };
  const direction = Object.hasOwn(ARROWS, event.key) ? ARROWS[event.key] : null;
  if (!direction) return null;
  return { type: event.shiftKey ? 'pan' : 'move', direction };
}

export { ZOOM_IN, ZOOM_OUT, actionOf };
export type { KeyAction, KeyLike };
