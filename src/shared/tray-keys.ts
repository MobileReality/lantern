export type TrayIntent = { kind: 'move'; to: number } | { kind: 'activate' } | { kind: 'close' };

export const NONE = -1;

interface KeyPress {
  key: string;
  shift: boolean;
}

function wrap(index: number, count: number) {
  return (index + count) % count;
}

export function trayIntent({ key, shift }: KeyPress, active: number, count: number): TrayIntent | null {
  if (key === 'Escape') return { kind: 'close' };
  if (key === 'Enter') return active === NONE ? null : { kind: 'activate' };
  if (count === 0) return null;
  const forward = key === 'ArrowDown' || (key === 'Tab' && !shift);
  const backward = key === 'ArrowUp' || (key === 'Tab' && shift);
  if (forward) return { kind: 'move', to: active === NONE ? 0 : wrap(active + 1, count) };
  if (backward) return { kind: 'move', to: active === NONE ? count - 1 : wrap(active - 1, count) };
  if (key === 'Home') return { kind: 'move', to: 0 };
  if (key === 'End') return { kind: 'move', to: count - 1 };
  return null;
}

export function keepActive(previousKey: string | null, keys: string[], previousIndex: number): number {
  if (keys.length === 0) return NONE;
  if (previousKey === null) return NONE;
  const same = keys.indexOf(previousKey);
  return same >= 0 ? same : Math.min(Math.max(previousIndex, 0), keys.length - 1);
}
