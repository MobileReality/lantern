interface StepFile {
  path: string;
  reason?: string;
}

interface StepNav {
  files: StepFile[];
  index: number;
}

interface Stepper {
  el: HTMLElement;
  update(index: number): void;
  step(delta: number): boolean;
  handleKey(ev: KeyboardEvent): boolean;
}

const PREV_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>';
const NEXT_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>';

function arrow(cls: string, label: string, icon: string) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `lt-step ${cls}`;
  b.dataset.tip = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = icon;
  return b;
}

function createStepper(nav: StepNav, go: (index: number) => void, onBlocked: () => void): Stepper {
  const el = document.createElement('div');
  el.className = 'lt-steps';
  const prev = arrow('lt-step-prev', 'Previous file (Left arrow)', PREV_ICON);
  const next = arrow('lt-step-next', 'Next file (Right arrow)', NEXT_ICON);
  const count = document.createElement('span');
  count.className = 'lt-step-count';
  count.setAttribute('aria-live', 'polite');
  el.append(prev, count, next);
  const total = nav.files.length;
  let at = nav.index;

  function update(index: number) {
    at = index;
    count.textContent = `${index + 1} / ${total}`;
    prev.disabled = index <= 0;
    next.disabled = index >= total - 1;
    if ((document.activeElement === prev && prev.disabled) || (document.activeElement === next && next.disabled)) onBlocked();
  }
  function step(delta: number) {
    const to = at + delta;
    if (to < 0 || to >= total) return false;
    go(to);
    return true;
  }
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  function handleKey(ev: KeyboardEvent) {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return false;
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return false;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    step(ev.key === 'ArrowLeft' ? -1 : 1);
    return true;
  }
  update(nav.index);
  return { el, update, step, handleKey };
}

export { createStepper };
export type { StepFile, StepNav, Stepper };
