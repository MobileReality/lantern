import { fileLabel } from './util';
import { esc } from './lanternctx';
import type { SideContext } from './lanternctx';

const LOCK_ICON = '<svg class="lock-ico" width="12" height="13" viewBox="-6 -6 12 13" aria-hidden="true"><path d="M-2.6,-0.6 V-2.4 a2.6,2.6 0 0 1 5.2,0 V-0.6" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="-4" y="-0.6" width="8" height="6" rx="1.2" fill="currentColor"/></svg>';

const LOCK_TITLE = 'Keep this file analysed while you click other files (L)';
const UNLOCK_TITLE = 'Unlock, so a click picks a new file again (L)';

function isLockKey(ev: KeyboardEvent) {
  if (ev.key.toLowerCase() !== 'l' || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const target = ev.target as Element | null;
  return !target?.closest?.('input, textarea, select, [contenteditable]');
}

function lockBarHtml(ctx: SideContext) {
  const { selected, locked, inspected, lockNote, canRelate, canMoveLock } = ctx;
  const note = lockNote ? `<p class="lock-note" role="status">${esc(lockNote)}</p>` : '';
  let body = '';
  if (selected && locked) {
    const inspecting = inspected ? `<p class="lock-insp">Inspecting <b>${esc(fileLabel(inspected))}</b>. Esc goes back.${canMoveLock ? '<button data-lock-move data-tip="Make this the locked file">Analyse this one instead</button>' : ''}</p>` : '';
    body = `<div class="lock-on">${LOCK_ICON}<span class="lock-name">Locked on <b>${esc(fileLabel(selected))}</b></span><button data-lock aria-pressed="true" data-tip="${UNLOCK_TITLE}">Unlock</button></div>${inspecting}`;
  } else if (selected && canRelate) {
    body = `<button class="lock-btn" data-lock aria-pressed="false" data-tip="${LOCK_TITLE}">${LOCK_ICON}<span>Lock on this file</span><kbd>L</kbd></button>`;
  }
  return `<div class="lt-lockbar${locked ? ' on' : ''}">${body}${note}</div>`;
}

export { LOCK_ICON, LOCK_TITLE, UNLOCK_TITLE, isLockKey, lockBarHtml };
