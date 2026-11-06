import { mountPopover } from '@renderer/popover';
import { esc } from './lanternctx';

interface DropItem {
  value: string;
  html: string;
  text: string;
}

interface Dropdown {
  set(items: DropItem[], value: string, empty?: string): void;
  disable(on: boolean): void;
  isOpen(): boolean;
  close(): void;
  focus(): void;
  dispose(): void;
}

const CHEVRON = '<svg class="cmp-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let dropSeq = 0;

function mountDropdown(field: HTMLElement, label: string, onPick: (value: string) => void): Dropdown {
  const id = `cmp-dd-${++dropSeq}`;
  field.innerHTML = `<span class="cmp-label" id="${id}-l">${esc(label)}</span><button type="button" class="cmp-trigger" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-l" aria-controls="${id}-list" disabled><span class="cmp-trigger-body"></span>${CHEVRON}</button>`;
  const trigger = field.querySelector('.cmp-trigger') as HTMLButtonElement;
  const body = trigger.querySelector('.cmp-trigger-body') as HTMLElement;
  const pop = document.createElement('div');
  pop.className = 'cmp-pop';
  pop.innerHTML = `<input class="cmp-search" type="search" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="${id}-list" placeholder="Filter" aria-label="Filter ${esc(label.toLowerCase())}" spellcheck="false"><div class="cmp-options" role="listbox" id="${id}-list" aria-labelledby="${id}-l"></div>`;
  field.closest('.modal')?.append(pop);
  const search = pop.querySelector('.cmp-search') as HTMLInputElement;
  const list = pop.querySelector('.cmp-options') as HTMLElement;
  let items: DropItem[] = [];
  let value = '';
  let emptyText = '';
  let active = -1;

  const shown = () => {
    const needle = search.value.trim().toLowerCase();
    return needle ? items.filter((i) => i.text.toLowerCase().includes(needle)) : items;
  };

  function renderTrigger() {
    const pick = items.find((i) => i.value === value);
    body.innerHTML = pick ? pick.html : `<span class="cmp-sub">${esc(emptyText || 'Nothing to choose')}</span>`;
  }

  function renderList() {
    const rows = shown();
    if (active >= rows.length) active = rows.length - 1;
    list.innerHTML = rows.length
      ? rows.map((i, n) => `<div class="cmp-opt${n === active ? ' active' : ''}" role="option" id="${id}-o${n}" data-value="${esc(i.value)}" aria-selected="${i.value === value}">${i.html}</div>`).join('')
      : '<p class="cmp-note">Nothing matches</p>';
    if (active >= 0) {
      search.setAttribute('aria-activedescendant', `${id}-o${active}`);
      list.querySelector('.cmp-opt.active')?.scrollIntoView?.({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  }

  const popover = mountPopover(trigger, pop, {
    placement: 'bottom-start',
    bindClick: false,
    focus: () => search,
    onOpen: () => {
      search.value = '';
      active = Math.max(0, items.findIndex((i) => i.value === value));
      renderList();
    },
  });

  function open() {
    if (!trigger.disabled) popover.open();
  }

  function close(refocus = false) {
    popover.close(refocus);
  }

  function pick(next: string) {
    close(true);
    if (next === value) return;
    value = next;
    renderTrigger();
    onPick(next);
  }

  trigger.addEventListener('click', () => (popover.isOpen() ? close() : open()));
  trigger.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      open();
    }
  });
  search.addEventListener('input', () => {
    active = 0;
    renderList();
  });
  search.addEventListener('keydown', (ev) => {
    const rows = shown();
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = rows.length ? (active + (ev.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length : -1;
      renderList();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (rows[active]) pick(rows[active].value);
    } else if (ev.key === 'Tab') close(true);
  });
  list.addEventListener('mousedown', (ev) => ev.preventDefault());
  list.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement).closest('.cmp-opt') as HTMLElement | null;
    if (row?.dataset.value !== undefined) pick(row.dataset.value);
  });

  return {
    set(next, v, empty = '') {
      items = next;
      value = v;
      emptyText = empty;
      renderTrigger();
      if (popover.isOpen()) renderList();
    },
    disable(on) {
      trigger.disabled = on;
      if (on) close();
    },
    isOpen: popover.isOpen,
    close: () => close(true),
    focus: () => trigger.focus(),
    dispose: popover.dispose,
  };
}

export { mountDropdown };
export type { DropItem, Dropdown };
