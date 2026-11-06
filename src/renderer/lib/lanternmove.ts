const MOVE_MS = 240;

function motionOn() {
  if (typeof Element.prototype.animate !== 'function') return false;
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function createScroller(el: HTMLElement) {
  let frame = 0;
  const scroll = (from: number, top: number, animate: boolean) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    const to = Math.max(0, top);
    if (from === to) return;
    if (!animate || typeof requestAnimationFrame !== 'function') {
      el.scrollTop = to;
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / MOVE_MS);
      el.scrollTop = from + (to - from) * (1 - (1 - k) ** 3);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };
  scroll.cancel = () => cancelAnimationFrame(frame);
  return scroll;
}

export { MOVE_MS, createScroller, motionOn };
