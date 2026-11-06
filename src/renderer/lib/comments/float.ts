import { el } from '../util';
import { selectionAnchor } from './rows';
import type { LineSpan, SelectionAnchor } from './rows';

interface SelectionButtonOptions {
  host: HTMLElement;
  body(): HTMLElement | null;
  enabled(): boolean;
  onComment(span: LineSpan): void;
}

interface SelectionButton {
  el: HTMLButtonElement;
  update(): void;
  comment(): boolean;
  dispose(): void;
}

const GAP_PX = 8;
const SHORTCUT = 'Alt+Shift+C';

function isShortcut(ev: KeyboardEvent) {
  return ev.code === 'KeyC' && ev.altKey && ev.shiftKey && !ev.ctrlKey && !ev.metaKey;
}

function createSelectionButton(options: SelectionButtonOptions): SelectionButton {
  const { host } = options;
  const button = el('button', 'lt-cm-float', 'Comment');
  button.type = 'button';
  button.hidden = true;
  button.dataset.tip = `Comment on the selected lines (${SHORTCUT})`;
  button.setAttribute('aria-keyshortcuts', SHORTCUT);
  button.setAttribute('aria-label', 'Comment on the selected lines');
  let visible = false;

  function hide() {
    visible = false;
    button.hidden = true;
  }

  function place(anchor: SelectionAnchor) {
    const frame = host.getBoundingClientRect();
    button.hidden = false;
    visible = true;
    const room = host.clientWidth - button.offsetWidth - GAP_PX;
    const beside = anchor.rect.right - frame.left + GAP_PX;
    const fits = beside <= room;
    const top = (fits ? anchor.rect.top : anchor.rect.bottom + 2) - frame.top;
    button.style.left = `${Math.max(GAP_PX, Math.min(beside, room))}px`;
    button.style.top = `${Math.max(0, Math.min(top, host.clientHeight - button.offsetHeight))}px`;
  }

  function update() {
    const anchor = options.enabled() ? selectionAnchor(options.body()) : null;
    if (anchor) place(anchor);
    else hide();
  }

  function comment() {
    const anchor = options.enabled() ? selectionAnchor(options.body()) : null;
    if (!anchor) return false;
    hide();
    document.getSelection()?.removeAllRanges();
    options.onComment(anchor.span);
    return true;
  }

  function onSelectionChange() {
    if (visible && document.getSelection()?.isCollapsed !== false) hide();
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (isShortcut(ev) && comment()) ev.preventDefault();
  }

  function onKeyUp(ev: KeyboardEvent) {
    if (ev.shiftKey || ev.key.startsWith('Arrow')) update();
  }

  function onScroll() {
    if (visible) update();
  }

  button.addEventListener('mousedown', (ev) => ev.preventDefault());
  button.addEventListener('click', () => void comment());
  host.addEventListener('mouseup', update);
  host.addEventListener('keydown', onKeyDown);
  host.addEventListener('keyup', onKeyUp);
  host.addEventListener('scroll', onScroll, true);
  document.addEventListener('selectionchange', onSelectionChange);

  return {
    el: button,
    update,
    comment,
    dispose() {
      host.removeEventListener('mouseup', update);
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('keyup', onKeyUp);
      host.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('selectionchange', onSelectionChange);
      button.remove();
    },
  };
}

export { createSelectionButton };
export type { SelectionButton, SelectionButtonOptions };
