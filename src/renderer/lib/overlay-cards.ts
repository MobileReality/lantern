import type { SoundKind } from './notification-sound';

type Card = Parameters<Window['overlay']['open']>[0];
type Bridge = Pick<Window['overlay'], 'open' | 'jump' | 'resize' | 'setInteractive' | 'animate'>;

export interface OverlayDeps {
  play(kind: SoundKind, card: Card): void;
  now(): number;
  frame(cb: () => void): void;
  reducedMotion(): boolean;
}

export interface OverlayController {
  add(card: Card): void;
  dismiss(id: string): void;
}

const EXIT_MS = 200;
const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const GLYPHS: Record<Card['kind'], string> = {
  done: '<path d="M5 10.5l3.2 3.2L15 7" />',
  waiting: '<path d="M4 9.5a6 5 0 1 1 3 4.3L4 15.5l.9-3A5 5 0 0 1 4 9.5z" /><path d="M7.5 9.6h.01M10 9.6h.01M12.5 9.6h.01" />',
  permission: '<path d="M11 3L5 11h4.5L8.5 17 15 9h-4.5L11 3z" />',
  error: '<path d="M10 4l7 12H3L10 4z" /><path d="M10 9v3M10 14.2h.01" />',
};

const OPEN_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5h7v7M15 5l-9 9" /></svg>';

const TERMINAL_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M6.5 8.5l2 1.75-2 1.75M10.5 12.5h3" /></svg>';

const KIND_LABEL: Record<Card['kind'], string> = { done: 'done', waiting: 'waiting', permission: 'permission', error: 'failed' };

interface Shown {
  card: Card;
  node: HTMLElement;
  badge: HTMLElement;
  ring: SVGCircleElement;
  elapsed: number;
  resumedAt: number | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function glyph(kind: Card['kind']): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = GLYPHS[kind];
  return svg;
}

export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

function closeButton(): { button: HTMLButtonElement; ring: SVGCircleElement } {
  const button = el('button', 'close');
  button.type = 'button';
  button.setAttribute('aria-label', 'Dismiss notification');
  button.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle class="track" cx="16" cy="16" r="${RING_RADIUS}" /><circle class="progress" cx="16" cy="16" r="${RING_RADIUS}" stroke-dasharray="${RING_LENGTH}" stroke-dashoffset="0" /><path class="cross" d="M12.5 12.5l7 7M19.5 12.5l-7 7" /></svg>`;
  return { button, ring: button.querySelector('.progress') as SVGCircleElement };
}

export function mountOverlay(stage: HTMLElement, bridge: Bridge, deps: OverlayDeps): OverlayController {
  const queue: Card[] = [];
  const seen = new Set<string>();
  let current: Shown | null = null;
  let leaving = false;

  const still = (card: Card) => !card.prefs.animations || deps.reducedMotion();
  const report = () => bridge.resize(stage.getBoundingClientRect().height);

  function updateBadge() {
    if (!current) return;
    current.badge.textContent = queue.length ? `+${queue.length}` : '';
    current.badge.hidden = queue.length === 0;
  }

  function remaining(shown: Shown): number {
    const running = shown.resumedAt === null ? 0 : deps.now() - shown.resumedAt;
    return 1 - (shown.elapsed + running) / shown.card.prefs.dismissMs;
  }

  function tick(shown: Shown) {
    if (current !== shown || leaving) return;
    const left = remaining(shown);
    shown.ring.setAttribute('stroke-dashoffset', String(RING_LENGTH * (1 - Math.max(0, left))));
    if (left <= 0) return dismiss(shown.card.id);
    deps.frame(() => tick(shown));
  }

  function pause() {
    if (!current || current.resumedAt === null) return;
    current.elapsed += deps.now() - current.resumedAt;
    current.resumedAt = null;
  }

  function resume() {
    if (!current || current.resumedAt !== null) return;
    current.resumedAt = deps.now();
  }

  function render(card: Card) {
    const node = el('article', `card ${card.kind}`);
    document.body.classList.toggle('still', still(card));
    document.body.dataset.kind = card.kind;

    const head = el('div', 'head');
    const chip = el('div', 'chip');
    const mark = el('span', 'mark');
    mark.append(glyph(card.kind));
    const names = el('div', 'names');
    names.append(el('span', 'repo', card.repoName || KIND_LABEL[card.kind]));
    if (card.branch) names.append(el('span', 'branch', middleTruncate(card.branch, 32)));
    chip.append(mark, names);
    const badge = el('span', 'badge');
    const { button, ring } = closeButton();
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss(card.id);
    });
    const open = el('button', 'open');
    open.type = 'button';
    open.dataset.tip = 'Open in Lantern';
    open.setAttribute('aria-label', 'Open in Lantern');
    open.innerHTML = OPEN_ICON;
    head.append(chip, el('span', 'spacer'), badge);
    if (card.sessionId) {
      const jump = el('button', 'open jump');
      jump.type = 'button';
      jump.dataset.tip = 'Go to the terminal';
      jump.setAttribute('aria-label', 'Go to the terminal');
      jump.innerHTML = TERMINAL_ICON;
      jump.addEventListener('click', (e) => {
        e.stopPropagation();
        bridge.jump(card);
        dismiss(card.id);
      });
      head.append(jump);
    }
    head.append(open, button);

    const text = el('div', 'text');
    text.append(el('h1', 'title', card.title));
    if (card.context) text.append(el('p', 'context', card.context));

    node.append(head, text);
    node.addEventListener('click', () => {
      bridge.open(card);
      dismiss(card.id);
    });
    node.addEventListener('mouseenter', () => {
      bridge.setInteractive(true);
      pause();
    });
    node.addEventListener('mouseleave', () => {
      bridge.setInteractive(false);
      resume();
    });

    stage.replaceChildren(node);
    const shown: Shown = { card, node, badge, ring, elapsed: 0, resumedAt: deps.now() };
    current = shown;
    updateBadge();
    report();
    bridge.animate('in', still(card));
    deps.frame(() => {
      // A queued card replacing one under the pointer gets no mouseenter until the pointer moves.
      if (node.matches(':hover')) {
        bridge.setInteractive(true);
        pause();
      }
      tick(shown);
    });
  }

  function showNext() {
    const next = queue.shift();
    if (next) return render(next);
    stage.replaceChildren();
    report();
  }

  function dismiss(id: string) {
    const index = queue.findIndex((card) => card.id === id);
    if (index >= 0) {
      queue.splice(index, 1);
      updateBadge();
      return;
    }
    if (!current || current.card.id !== id || leaving) return;
    const { card } = current;
    bridge.setInteractive(false); // pointer may have been over this card
    bridge.animate('out', still(card));
    leaving = true;
    const done = () => {
      leaving = false;
      current = null;
      showNext();
    };
    if (still(card)) done();
    else setTimeout(done, EXIT_MS);
  }

  function add(card: Card) {
    if (seen.has(card.id)) return;
    seen.add(card.id);
    deps.play(card.kind, card);
    if (current) {
      queue.push(card);
      updateBadge();
    } else {
      render(card);
    }
  }

  return { add, dismiss };
}
