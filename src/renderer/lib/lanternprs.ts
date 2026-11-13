import CLOSE_ICON from '@renderer/assets/icons/close.svg';
import PLUS_ICON from '@renderer/assets/icons/plus.svg';
import type { LanternPr } from '@main/lantern';
import { localCard, prCard, stateClass } from '@renderer/pr-info';
import { setTipCard } from '@renderer/tooltip';
import { esc } from './lanternctx';
import { plural } from './util';

const RECENT_MS = 2 * 24 * 60 * 60 * 1000;

interface FetchResult {
  ok: boolean;
  error?: string;
}

interface PrStripHost {
  el: HTMLElement;
  onSelect(id: string | null): void;
  dismissed?: string[];
  onDismiss?(id: string): void;
  onRestore?(): void;
  onCompare?(): void;
  onRemoveLocal?(id: string): void;
  now?(): number;
}

interface PrStrip {
  sync(prs: LanternPr[], selected: string | null): void;
}

function fileCount(pr: LanternPr) {
  return plural(pr.files.length, 'file');
}

function isDeclined(pr: LanternPr) {
  return pr.state === 'closed' || pr.state === 'declined';
}

function isRecent(stamp: string, now: number) {
  const t = Date.parse(stamp);
  return Number.isFinite(t) && now - t <= RECENT_MS;
}

function declinedAt(pr: LanternPr) {
  if (pr.closedAt) return pr.closedAt;
  return pr.info?.from === 'host' && pr.info.updated ? pr.info.updated : pr.opened;
}

function isShown(pr: LanternPr, now: number) {
  if (pr.state === 'open') return true;
  if (pr.state === 'merged') return isRecent(pr.mergedAt || pr.opened, now);
  return isRecent(declinedAt(pr), now);
}

function visiblePrs(prs: LanternPr[], now: number) {
  return prs.filter((p) => isShown(p, now));
}

function isSelectable(pr: LanternPr, now: number) {
  return !isDeclined(pr) && isShown(pr, now);
}

function isDismissible(pr: LanternPr) {
  return pr.state !== 'open';
}

function isLocal(pr: LanternPr) {
  return pr.source === 'local';
}

function localChipHtml(pr: LanternPr, on: boolean) {
  const chip = `<button class="pr-chip pr-local" data-pr="${esc(pr.id)}" aria-pressed="${on}" data-tip="${esc(`${pr.branch} compared with where it left ${pr.base}`)}"><span class="pr-branch">${esc(pr.title)}</span></button>`;
  return `<span class="pr-item pr-local">${chip}<button class="pr-dismiss" data-pr-remove="${esc(pr.id)}" aria-label="Remove ${esc(pr.title)}">${CLOSE_ICON}</button></span>`;
}

function chipHtml(pr: LanternPr, on: boolean) {
  if (isLocal(pr)) return localChipHtml(pr, on);
  const label = `<span class="pr-tab-id">#${esc(pr.id)}</span> <span class="pr-branch">${esc(pr.branch)}</span>`;
  const name = esc(`Pull request #${pr.id}, declined, ${fileCount(pr)}`);
  const chip = isDeclined(pr)
    ? `<button class="pr-chip ${stateClass(pr)} pr-declined" data-pr="${esc(pr.id)}" aria-disabled="true" aria-label="${name}" tabindex="-1" data-tip="${esc(`Declined: ${pr.title}`)}">${label}</button>`
    : `<button class="pr-chip ${stateClass(pr)}" data-pr="${esc(pr.id)}" aria-pressed="${on}" data-tip="${esc(pr.title)}">${label}</button>`;
  const dismiss = isDismissible(pr) ? `<button class="pr-dismiss" data-pr-dismiss="${esc(pr.id)}" aria-label="Hide pull request #${esc(pr.id)}">${CLOSE_ICON}</button>` : '';
  return `<span class="pr-item ${stateClass(pr)}">${chip}${dismiss}</span>`;
}

function isNoOrigin(error: string | undefined) {
  return /origin remote/.test(error ?? '');
}

function shortError(error: string | undefined) {
  const line = (error ?? '').split('\n')[0].trim();
  const text = line.length > 80 ? `${line.slice(0, 79)}…` : line;
  return `Could not check the remote${text ? `: ${text}` : ''}`;
}

function mountPrStrip(host: PrStripHost): PrStrip {
  const { el } = host;
  const clock = () => host.now?.() ?? Date.now();
  let prs: LanternPr[] = [];
  let selected: string | null = null;
  let pendingFocus = '';
  let dismissed = new Set(host.dismissed ?? []);
  let hiddenCount = 0;

  function focusKey(t: Element) {
    if (t.hasAttribute('data-pr')) return `pr:${t.getAttribute('data-pr')}`;
    if (t.hasAttribute('data-pr-dismiss')) return `x:${t.getAttribute('data-pr-dismiss')}`;
    if (t.hasAttribute('data-pr-remove')) return `rm:${t.getAttribute('data-pr-remove')}`;
    if (t.hasAttribute('data-pr-add')) return 'add';
    if (t.hasAttribute('data-pr-restore')) return 'restore';
    return '';
  }

  function restoreFocus() {
    if (!pendingFocus) return;
    const target = [...el.querySelectorAll('button')].find((b) => focusKey(b) === pendingFocus);
    if (!target) pendingFocus = '';
    else if (!target.disabled) {
      target.focus();
      pendingFocus = '';
    }
  }

  function addHtml() {
    if (!host.onCompare) return '';
    return `<button class="pr-add" data-pr-add aria-haspopup="dialog" data-tip="Compare two branches, commits or your uncommitted changes" aria-label="Compare changes">${PLUS_ICON}<span>Compare</span></button>`;
  }

  function render() {
    const empty = !prs.length && !hiddenCount && !host.onCompare;
    el.hidden = empty;
    const active = document.activeElement;
    if (active && active !== document.body && !el.contains(active)) pendingFocus = '';
    else if (!pendingFocus && active && el.contains(active)) pendingFocus = focusKey(active);
    if (empty) {
      pendingFocus = '';
      el.textContent = '';
      return;
    }
    const restore = hiddenCount ? `<button class="pr-restore" data-pr-restore data-tip="Show the hidden pull requests again">Hidden (${hiddenCount}) — restore</button>` : '';
    el.innerHTML = `<div class="pr-chips">${prs.map((p) => chipHtml(p, p.id === selected)).join('')}${restore}</div>${addHtml()}`;
    for (const chip of el.querySelectorAll<HTMLElement>('.pr-chip[data-pr]')) {
      const pr = prs.find((p) => p.id === chip.dataset.pr);
      if (pr) setTipCard(chip, () => (isLocal(pr) ? localCard(pr) : prCard(pr, clock())));
    }
    el.querySelector<HTMLElement>('.pr-chip[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    restoreFocus();
  }

  el.addEventListener('click', (ev) => {
    const t = (ev.target as Element).closest('button');
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    pendingFocus = focusKey(t);
    if (t.hasAttribute('data-pr-dismiss')) {
      const id = t.getAttribute('data-pr-dismiss') as string;
      const at = prs.findIndex((p) => p.id === id);
      const next = prs[at + 1] ?? prs[at - 1];
      pendingFocus = next ? `pr:${next.id}` : 'restore';
      dismissed.add(id);
      apply();
      host.onDismiss?.(id);
    } else if (t.hasAttribute('data-pr-remove')) {
      const id = t.getAttribute('data-pr-remove') as string;
      pendingFocus = 'add';
      host.onRemoveLocal?.(id);
    } else if (t.hasAttribute('data-pr-add')) host.onCompare?.();
    else if (t.hasAttribute('data-pr-restore')) {
      dismissed = new Set();
      pendingFocus = prs[0] ? `pr:${prs[0].id}` : '';
      apply();
      host.onRestore?.();
    } else if (t.hasAttribute('data-pr')) host.onSelect(t.getAttribute('data-pr'));
  });

  let all: LanternPr[] = [];

  function apply() {
    const live = visiblePrs(all, clock());
    const gone = (p: LanternPr) => isDismissible(p) && dismissed.has(p.id);
    prs = live.filter((p) => !gone(p));
    hiddenCount = live.length - prs.length;
    render();
  }

  return {
    sync(next, sel) {
      all = next;
      selected = sel;
      apply();
    },
  };
}

export { RECENT_MS, fileCount, isNoOrigin, isSelectable, mountPrStrip, shortError, visiblePrs };
export type { FetchResult, PrStrip };
