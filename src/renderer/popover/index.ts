type Placement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-stretch';

interface PopoverOptions {
  placement: Placement;
  anchor?: HTMLElement;
  focus?: () => HTMLElement | null | undefined;
  inside?: HTMLElement;
  bindClick?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

interface Popover {
  open(): void;
  close(refocus?: boolean): void;
  toggle(): void;
  isOpen(): boolean;
  contains(node: Node): boolean;
  dispose(): void;
}

const stack: Popover[] = [];
let seq = 0;

function mountPopover(trigger: HTMLElement, pop: HTMLElement, options: PopoverOptions): Popover {
  const anchorName = `--lt-pop-${++seq}`;
  const anchor = options.anchor ?? trigger;
  const inside = options.inside ?? trigger;
  pop.classList.add('lt-pop');
  pop.dataset.placement = options.placement;
  pop.setAttribute('popover', 'manual');
  pop.style.setProperty('position-anchor', anchorName);
  pop.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  if (pop.id) trigger.setAttribute('aria-controls', pop.id);

  const owns = (node: EventTarget | null) =>
    node instanceof Node && (pop.contains(node) || inside.contains(node) || stack.slice(stack.indexOf(popover) + 1).some((child) => child.contains(node)));

  function onPress(e: PointerEvent) {
    if (!pop.isConnected || !owns(e.target)) popover.close(false);
  }
  function onKey(e: KeyboardEvent) {
    if (!pop.isConnected) return popover.close(false);
    if (e.key !== 'Escape' || stack[stack.length - 1] !== popover) return;
    e.preventDefault();
    e.stopPropagation();
    popover.close(true);
  }
  function onFocusOut(e: FocusEvent) {
    if (e.relatedTarget instanceof Node && !owns(e.relatedTarget)) popover.close(false);
  }

  const popover: Popover = {
    open() {
      if (popover.isOpen()) return;
      for (const other of [...stack].reverse()) if (other !== popover && !other.contains(trigger)) other.close(false);
      anchor.style.setProperty('anchor-name', anchorName);
      pop.hidden = false;
      pop.showPopover?.();
      trigger.setAttribute('aria-expanded', 'true');
      stack.push(popover);
      document.addEventListener('pointerdown', onPress, true);
      document.addEventListener('keydown', onKey, true);
      pop.addEventListener('focusout', onFocusOut);
      inside.addEventListener('focusout', onFocusOut);
      options.onOpen?.();
      options.focus?.()?.focus();
    },
    close(refocus = false) {
      if (!popover.isOpen()) return;
      if (pop.matches?.(':popover-open')) pop.hidePopover?.();
      pop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      stack.splice(stack.indexOf(popover), 1);
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('keydown', onKey, true);
      pop.removeEventListener('focusout', onFocusOut);
      inside.removeEventListener('focusout', onFocusOut);
      options.onClose?.();
      if (refocus) trigger.focus();
    },
    toggle() {
      if (popover.isOpen()) popover.close(true);
      else popover.open();
    },
    isOpen: () => !pop.hidden,
    contains: (node) => pop.contains(node),
    dispose() {
      popover.close(false);
      anchor.style.removeProperty('anchor-name');
      if (options.bindClick !== false) trigger.removeEventListener('click', onClick);
    },
  };

  function onClick() {
    popover.toggle();
  }
  if (options.bindClick !== false) trigger.addEventListener('click', onClick);
  return popover;
}

function rovingFocus(container: HTMLElement, items: () => HTMLElement[]) {
  container.addEventListener('keydown', (e) => {
    const all = items();
    if (!all.length) return;
    const at = all.findIndex((item) => item.contains(document.activeElement));
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    all[(next + all.length) % all.length].focus();
  });
}

export { mountPopover, rovingFocus };
export type { Placement, Popover, PopoverOptions };
