const SHOW_DELAY_MS = 500;
const SKIP_DELAY_MS = 300;
const WATCH_MS = 200;
const POINTER_GAP_PX = 14;
const GAP_PX = 6;
const EDGE_PX = 8;
const TIP_ID = 'lt-tip';
const TIPPED = '[data-tip]:not([data-tip=""])';

type KeysFor = (command: string) => string[] | undefined;

interface TooltipOptions {
  keysFor?: KeysFor;
}

let tip: HTMLDivElement | null = null;
let target: HTMLElement | null = null;
let watched: Element | null = null;
let shown = false;
let timer = 0;
let alive = 0;
let hiddenAt = Number.NEGATIVE_INFINITY;
let pressed: HTMLElement | null = null;
let pressedTip: string | undefined;
let pointer = { x: 0, y: 0 };
let keysFor: KeysFor = () => undefined;
const watcher = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => refresh());

function tipped(node: EventTarget | null) {
  return node instanceof Element ? node.closest<HTMLElement>(TIPPED) : null;
}

function watch(el: Element | null) {
  if (el === watched) return;
  watcher?.disconnect();
  watched = el;
  if (el) watcher?.observe(el, { attributes: true, attributeFilter: ['data-tip', 'data-tip-command'] });
}

function followsPointer(el: HTMLElement) {
  return el.dataset.tipAt === 'pointer';
}

function repeatsLabel(el: HTMLElement, text: string) {
  const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
  return label === text.trim();
}

function describe(el: HTMLElement, on: boolean) {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== TIP_ID);
  if (on) ids.push(TIP_ID);
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
}

function fill(el: HTMLElement) {
  if (!tip) return;
  const text = el.dataset.tip ?? '';
  tip.textContent = '';
  tip.append(text);
  const chips = el.dataset.tipCommand ? keysFor(el.dataset.tipCommand) : undefined;
  if (chips?.length) {
    const keys = document.createElement('span');
    keys.className = 'lt-tip-keys';
    for (const chip of chips) {
      const kbd = document.createElement('kbd');
      kbd.textContent = chip;
      keys.append(kbd);
    }
    tip.append(keys);
  }
  describe(el, !repeatsLabel(el, text) || !!chips?.length);
}

function place() {
  if (!tip || !target) return;
  const atPointer = followsPointer(target);
  tip.classList.toggle('is-at-pointer', atPointer);
  tip.style.left = '0px';
  tip.style.top = '0px';
  const box = tip.getBoundingClientRect();
  const maxLeft = window.innerWidth - EDGE_PX - box.width;
  const maxTop = window.innerHeight - EDGE_PX - box.height;
  let left: number;
  let top: number;
  if (atPointer) {
    left = pointer.x + POINTER_GAP_PX > maxLeft ? pointer.x - POINTER_GAP_PX - box.width : pointer.x + POINTER_GAP_PX;
    top = pointer.y + POINTER_GAP_PX > maxTop ? pointer.y - POINTER_GAP_PX - box.height : pointer.y + POINTER_GAP_PX;
  } else {
    const at = target.getBoundingClientRect();
    left = at.left + at.width / 2 - box.width / 2;
    top = at.top - GAP_PX - box.height;
    if (top < EDGE_PX) top = at.bottom + GAP_PX;
  }
  tip.style.left = `${Math.round(Math.max(EDGE_PX, Math.min(left, maxLeft)))}px`;
  tip.style.top = `${Math.round(Math.max(EDGE_PX, Math.min(top, maxTop)))}px`;
}

function reveal() {
  if (!tip || !target) return;
  if (!target.isConnected) return hide();
  tip.hidden = false;
  tip.showPopover?.();
  place();
  shown = true;
  window.clearInterval(alive);
  alive = window.setInterval(() => {
    if (!target || target.isConnected) return;
    const again = tipped(document.elementFromPoint?.(pointer.x, pointer.y) ?? null);
    hide();
    if (again) arm(again, 0);
  }, WATCH_MS);
}

function hide() {
  window.clearTimeout(timer);
  window.clearInterval(alive);
  watch(null);
  if (target) describe(target, false);
  if (shown) hiddenAt = performance.now();
  shown = false;
  target = null;
  if (!tip) return;
  if (tip.matches?.(':popover-open')) tip.hidePopover?.();
  tip.hidden = true;
}

function arm(el: HTMLElement, delay: number) {
  hide();
  target = el;
  fill(el);
  watch(el);
  tip?.classList.toggle('is-instant', delay === 0);
  if (delay > 0) timer = window.setTimeout(reveal, delay);
  else reveal();
}

function refresh() {
  if (!target) {
    if (watched instanceof HTMLElement && watched.matches(TIPPED) && !stillPressed(watched)) arm(watched, warm() ? 0 : SHOW_DELAY_MS);
    return;
  }
  if (!target.matches(TIPPED)) return hide();
  fill(target);
  if (shown) place();
}

function stillPressed(el: HTMLElement | null) {
  return !!el && el === pressed && (!followsPointer(el) || el.dataset.tip === pressedTip);
}

function warm() {
  return shown || performance.now() - hiddenAt < SKIP_DELAY_MS;
}

function onPointer(e: PointerEvent) {
  pointer = { x: e.clientX, y: e.clientY };
  const el = tipped(e.target);
  if (pressed && !stillPressed(el)) pressed = null;
  if (el && el === target) {
    if (shown && followsPointer(el)) place();
    return;
  }
  if (!el || stillPressed(el)) {
    hide();
    watch(e.target instanceof Element ? e.target.closest('[data-tip-at]') : null);
    return;
  }
  arm(el, warm() ? 0 : SHOW_DELAY_MS);
}

function onLeave(e: PointerEvent) {
  if (!target) return;
  const to = e.relatedTarget;
  if (to instanceof Node && target.contains(to)) return;
  if (to === null) hide();
}

function onFocus(e: FocusEvent) {
  const el = tipped(e.target);
  if (el && el === target) return;
  hide();
  if (!el) return;
  let keyboard = true;
  try {
    keyboard = (e.target as Element).matches(':focus-visible');
  } catch {}
  if (!keyboard) return;
  arm(el, SHOW_DELAY_MS);
}

function onBlur(e: FocusEvent) {
  if (target && e.target instanceof Node && target.contains(e.target)) hide();
}

function onPress(e: PointerEvent) {
  pressed = tipped(e.target);
  pressedTip = pressed?.dataset.tip;
  hide();
  hiddenAt = Number.NEGATIVE_INFINITY;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && shown) hide();
}

function installTooltips(options: TooltipOptions = {}) {
  if (options.keysFor) keysFor = options.keysFor;
  const existing = document.getElementById(TIP_ID);
  if (existing instanceof HTMLDivElement) {
    tip = existing;
    return existing;
  }
  tip = document.createElement('div');
  tip.id = TIP_ID;
  tip.className = 'lt-tip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('popover', 'manual');
  tip.hidden = true;
  document.body.append(tip);
  document.addEventListener('pointerover', onPointer);
  document.addEventListener('pointermove', onPointer);
  document.addEventListener('pointerout', onLeave);
  document.addEventListener('pointerdown', onPress, true);
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('focusout', onBlur, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('wheel', hide, { capture: true, passive: true });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  return tip;
}

function hideTooltip() {
  hide();
}

export { SHOW_DELAY_MS, SKIP_DELAY_MS, hideTooltip, installTooltips };
export type { TooltipOptions };
