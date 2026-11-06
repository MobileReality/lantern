import { msg } from '@shared/lang/messages';
import CLOSE_ICON from '@renderer/assets/icons/close.svg';
import { focusableIn } from './modal-focus';

interface OverviewDrawer {
  readonly el: HTMLElement;
  readonly id: string;
  isOpen(): boolean;
  set(open: boolean, quiet?: boolean): void;
  fill(html: string): void;
  dispose(): void;
}

type OverviewChange = (open: boolean, hadFocus: boolean) => void;

function overviewId(uid: string) {
  return `lt-overview-${uid || 'view'}`;
}

function drawerMarkup(id: string) {
  const label = msg('overview.label');
  return (
    '<div class="lt-overview-scrim" hidden></div>' +
    `<aside class="lt-side lt-overview" id="${id}" role="region" aria-label="${label}" hidden>` +
    `<button type="button" class="lt-overview-close" data-overview aria-label="${msg('overview.close')}" data-tip="${msg('overview.close')}">${CLOSE_ICON}</button>` +
    '<div class="lt-overview-body"></div></aside>'
  );
}

function mountOverviewDrawer(grid: HTMLElement, uid: string, onChange: OverviewChange): OverviewDrawer {
  const id = overviewId(uid);
  grid.insertAdjacentHTML('beforeend', drawerMarkup(id));
  const el = grid.querySelector<HTMLElement>(`#${id}`) as HTMLElement;
  const scrim = grid.querySelector<HTMLElement>('.lt-overview-scrim') as HTMLElement;
  const body = el.querySelector<HTMLElement>('.lt-overview-body') as HTMLElement;
  let open = false;

  function set(next: boolean, quiet = false) {
    if (next === open) return;
    const hadFocus = el.contains(document.activeElement);
    open = next;
    el.hidden = !next;
    scrim.hidden = !next;
    if (next) (el.querySelector<HTMLElement>('.lt-overview-close') ?? focusableIn(el)[0])?.focus({ preventScroll: true });
    if (!quiet) onChange(next, hadFocus);
  }

  const onScrim = () => set(false);
  scrim.addEventListener('click', onScrim);

  return {
    el,
    id,
    isOpen: () => open,
    set,
    fill(html) {
      const keep = el.scrollTop;
      body.innerHTML = html;
      el.scrollTop = keep;
    },
    dispose() {
      scrim.removeEventListener('click', onScrim);
    },
  };
}

function overviewButtonHtml(open: boolean, id: string) {
  const label = msg(open ? 'overview.close' : 'overview.open');
  return `<button class="lt-plat lt-overview-toggle" data-overview aria-expanded="${open}" aria-controls="${id}" data-tip="${msg('overview.label')}">${label}</button>`;
}

export { mountOverviewDrawer, overviewButtonHtml, overviewId };
export type { OverviewDrawer };
