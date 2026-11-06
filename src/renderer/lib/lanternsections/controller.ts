import type { LanternMap } from '../../../main/lantern';
import { applyDbFilters, clearDbFilters, readDbFilters, writeDbFilters } from './db';
import type { DbFilterState } from './db';
import { barHtml, overlayHtml, sectionsIn } from './registry';

interface SectionsHost {
  root: HTMLElement;
  bar: HTMLElement;
  grid: HTMLElement;
  side: HTMLElement;
  main: HTMLElement;
  overlay: HTMLElement;
  onCite(path: string): void;
  onOpenCode?(path: string, symbol: string): void;
  onChange(id: string): void;
}

interface SectionsController {
  sync(data: LanternMap, platform: string): void;
}

function mountSections(host: SectionsHost, remembered: string): SectionsController {
  const { root, bar, grid, side, main, overlay } = host;
  let data: LanternMap | null = null;
  let platform = '';
  let open: string | null = remembered || null;
  let shown: string | null = null;
  let listening = false;
  const dbFilters = new Map<string, DbFilterState>();

  function dbFilterKey(section: string) {
    return `${platform}\n${section}`;
  }

  function setOpen(id: string | null) {
    if (id === open) return;
    open = id;
    host.onChange(id ?? '');
    render();
  }

  function focusBar(id: string | null) {
    [...bar.querySelectorAll<HTMLElement>('[data-section]')].find((b) => b.getAttribute('data-section') === id)?.focus();
  }

  function restoreFocus(before: { barId: string | null; dbControl: string | null; selection: number | null; inOverlay: boolean }, previous: string | null, opened: boolean, sameSection = false) {
    if (before.barId) focusBar(before.barId);
    else if (before.dbControl && sameSection) {
      const control = overlay.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-db-filters] [name="${before.dbControl}"]`);
      control?.focus({ preventScroll: true });
      if (control instanceof HTMLInputElement && before.selection !== null) control.setSelectionRange(before.selection, before.selection);
    }
    else if (before.inOverlay) {
      if (opened) overlay.focus({ preventScroll: true });
      else focusBar(previous);
    }
  }

  function render() {
    if (!data) return;
    const active = document.activeElement;
    const dbControl = active instanceof HTMLInputElement || active instanceof HTMLSelectElement ? active.closest('[data-db-filters]') && active.name : null;
    const before = {
      barId: active && bar.contains(active) ? (active.closest('[data-section]')?.getAttribute('data-section') ?? null) : null,
      dbControl: dbControl || null,
      selection: active instanceof HTMLInputElement ? active.selectionStart : null,
      inOverlay: !!active && overlay.contains(active),
    };
    const previous = shown;
    const scoped = sectionsIn(data, platform);
    if (open && !scoped.some((s) => s.id === open)) {
      open = null;
      host.onChange('');
    }
    const sec = scoped.find((s) => s.id === open);
    bar.innerHTML = barHtml(scoped, open);
    const sameSection = shown === open;
    const keep = overlay.querySelector('.sx-body')?.scrollTop ?? 0;
    overlay.hidden = !sec;
    grid.classList.toggle('sec-open', !!sec);
    side.hidden = !!sec;
    main.toggleAttribute('inert', !!sec);
    if (!sec) {
      overlay.textContent = '';
      shown = null;
      detachKeys();
      restoreFocus(before, previous, false);
      return;
    }
    overlay.innerHTML = overlayHtml(data, sec, new Set(data.nodes.map((n) => n.path)), !!host.onOpenCode);
    if (sec.type === 'db') {
      const state = dbFilters.get(dbFilterKey(sec.id));
      if (state) writeDbFilters(overlay, state);
      const normalized = readDbFilters(overlay);
      dbFilters.set(dbFilterKey(sec.id), normalized);
      applyDbFilters(overlay, normalized);
    }
    const body = overlay.querySelector('.sx-body');
    if (body && sameSection) body.scrollTop = keep;
    shown = open;
    attachKeys();
    restoreFocus(before, previous, true, sameSection);
  }

  function revealWithRelated(): DbFilterState | null {
    const current = readDbFilters(overlay);
    if (current.related) return null;
    const next = { ...current, related: true };
    writeDbFilters(overlay, next);
    applyDbFilters(overlay, next);
    return next;
  }

  function jumpToEntity(id: string) {
    const card = [...overlay.querySelectorAll<HTMLElement>('[data-entity-card]')].find((c) => c.getAttribute('data-entity-card') === id);
    if (!card) return;
    if (card.hidden) {
      const revealed = revealWithRelated();
      if (revealed && open) dbFilters.set(dbFilterKey(open), revealed);
      if (card.hidden) {
        const cleared = clearDbFilters(overlay);
        if (open) dbFilters.set(dbFilterKey(open), cleared);
      }
    }
    card.tabIndex = -1;
    card.scrollIntoView?.({ block: 'center' });
    card.focus({ preventScroll: true });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1200);
  }

  bar.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest('button[data-section]');
    if (!btn) return;
    const id = btn.getAttribute('data-section');
    setOpen(id === open ? null : id);
  });

  overlay.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-close')) setOpen(null);
    else if (btn.hasAttribute('data-code')) host.onOpenCode?.(btn.getAttribute('data-code') ?? '', btn.getAttribute('data-symbol') ?? '');
    else if (btn.hasAttribute('data-entity')) jumpToEntity(btn.getAttribute('data-entity') ?? '');
    else if (btn.hasAttribute('data-cite')) {
      const path = btn.getAttribute('data-cite') ?? '';
      setOpen(null);
      host.onCite(path);
    }
  });

  function updateDbFilters(ev: Event) {
    if (!(ev.target as Element).closest('[data-db-filters]') || !open) return;
    const state = readDbFilters(overlay);
    dbFilters.set(dbFilterKey(open), state);
    applyDbFilters(overlay, state);
  }

  overlay.addEventListener('input', updateDbFilters);
  overlay.addEventListener('change', updateDbFilters);

  overlay.addEventListener('reset', (ev) => {
    if (!(ev.target as Element).matches('[data-db-filters]') || !open) return;
    ev.preventDefault();
    dbFilters.set(dbFilterKey(open), clearDbFilters(overlay));
  });

  overlay.addEventListener('submit', (ev) => {
    if ((ev.target as Element).matches('[data-db-filters]')) ev.preventDefault();
  });

  function onKeydown(ev: KeyboardEvent) {
    if (!root.isConnected) return detachKeys();
    if (ev.key !== 'Escape' || !open || root.closest('.hidden, [hidden]') || document.querySelector('.modal:not(.hidden)')) return;
    const target = ev.target;
    if (target instanceof HTMLInputElement && target.type === 'search' && target.value && target.closest('[data-db-filters]')) {
      ev.preventDefault();
      ev.stopPropagation();
      target.value = '';
      updateDbFilters(ev);
      return;
    }
    setOpen(null);
  }

  function attachKeys() {
    if (!listening) document.addEventListener('keydown', onKeydown, true);
    listening = true;
  }

  function detachKeys() {
    document.removeEventListener('keydown', onKeydown, true);
    listening = false;
  }

  return {
    sync(next, nextPlatform) {
      data = next;
      platform = nextPlatform;
      render();
    },
  };
}

export { mountSections };
export type { SectionsController, SectionsHost };
