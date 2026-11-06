import { mountPopover } from '@renderer/popover';
import error from '@renderer/assets/icons/problem-error.svg';
import warning from '@renderer/assets/icons/problem-warning.svg';
import notice from '@renderer/assets/icons/problem-notice.svg';
import fresh from '@renderer/assets/icons/stat-fresh.svg';

const ICONS = { error, warning, notice };

type Severity = 'error' | 'warning' | 'notice';
const ORDER: Record<Severity, number> = { error: 0, warning: 1, notice: 2 };
const TOAST_MS = 6000;
const TOAST_STEP_MS = 250;

interface Problem {
  id: string;
  severity: Severity;
  message: string;
  location?: { file: string; line?: number };
  actions?: { label: string; run: () => void; tip?: string; pressed?: boolean; primary?: boolean; disabled?: boolean }[];
  toast?: boolean;
}

interface ProblemList {
  sync(items: Problem[]): void;
  toggle(): void;
  close(): void;
  dispose(): void;
}

function compactCount(n: number) {
  return n >= 10_000 ? `${Math.floor(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n);
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function mountProblems(host: HTMLElement, onOpen?: (location: { file: string; line?: number }) => void): ProblemList {
  host.className = 'lt-diag';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lt-diag-btn';
  button.dataset.tipCommand = 'lantern.problems';
  const panel = document.createElement('div');
  panel.className = 'lt-diag-panel';
  panel.setAttribute('role', 'dialog');
  const list = document.createElement('ul');
  list.className = 'lt-diag-list';
  list.setAttribute('role', 'list');
  panel.append(list);
  const toast = document.createElement('div');
  toast.className = 'lt-diag-panel lt-toast';
  toast.setAttribute('role', 'alert');
  toast.hidden = true;
  const toastList = document.createElement('ul');
  toastList.className = 'lt-diag-list';
  toast.append(toastList);
  host.append(button, panel, toast);
  let current: Problem[] = [];
  let seen = new Set<string>();
  const popped = new Map<string, number>();
  let tick: ReturnType<typeof setInterval> | undefined;
  let frozen = false;

  function paintToast() {
    toastList.textContent = '';
    for (const item of current) if (popped.has(item.id)) toastList.append(rowFor(item, false));
    toast.hidden = !toastList.childElementCount || !panel.hidden;
    if (toast.hidden) {
      clearInterval(tick);
      tick = undefined;
    } else tick ??= setInterval(countDown, TOAST_STEP_MS);
  }
  function countDown() {
    if (frozen || !host.isConnected || host.closest('.hidden')) return;
    for (const [id, left] of popped) {
      if (left <= TOAST_STEP_MS) popped.delete(id);
      else popped.set(id, left - TOAST_STEP_MS);
    }
    paintToast();
  }
  function clearToasts() {
    popped.clear();
    paintToast();
  }
  toast.addEventListener('mouseenter', () => (frozen = true));
  toast.addEventListener('mouseleave', () => (frozen = false));

  function sentence() {
    const n = (severity: Severity) => current.filter((p) => p.severity === severity).length;
    if (!current.length) return 'No problems';
    const parts = [n('error') && plural(n('error'), 'error'), n('warning') && plural(n('warning'), 'warning'), n('notice') && plural(n('notice'), 'notice')].filter(Boolean);
    return `Problems: ${parts.join(', ')}`;
  }

  function paintButton() {
    const errors = current.filter((p) => p.severity === 'error').length;
    const warnings = current.filter((p) => p.severity === 'warning').length;
    const notices = current.filter((p) => p.severity === 'notice').length;
    button.classList.toggle('is-clear', !current.length);
    button.setAttribute('aria-label', sentence());
    button.dataset.tip = current.length ? `${sentence().slice('Problems: '.length)} — click to list them` : 'The map loaded without problems';
    if (!current.length) {
      button.innerHTML = `${fresh}<span>No problems</span>`;
      return;
    }
    const count = (severity: Severity, n: number) => (n ? `<span class="lt-diag-count is-${severity}">${ICONS[severity]}<span>${compactCount(n)}</span></span>` : '');
    button.innerHTML = count('error', errors) + count('warning', warnings) + (notices ? `<span class="lt-diag-count is-notice" data-tip="${plural(notices, 'notice')}">${ICONS.notice}</span>` : '');
  }

  function rows() {
    return [...list.querySelectorAll<HTMLElement>('[role="listitem"]')];
  }

  function paintList() {
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? (document.activeElement.closest<HTMLElement>('[data-id]')?.dataset.id ?? null) : null;
    list.textContent = '';
    panel.setAttribute('aria-label', sentence());
    if (!current.length) {
      const li = document.createElement('li');
      li.className = 'lt-diag-empty';
      li.textContent = 'No problems';
      list.append(li);
      return;
    }
    for (const item of current) list.append(rowFor(item, true));
    if (focused) (rows().find((row) => row.dataset.id === focused) ?? rows()[0])?.focus();
  }

  function rowFor(item: Problem, inList: boolean) {
    const li = document.createElement('li');
    li.className = `lt-diag-item is-${item.severity}`;
    li.dataset.id = item.id;
    if (inList) {
      li.setAttribute('role', 'listitem');
      li.tabIndex = -1;
    }
    li.innerHTML = ICONS[item.severity];
    const text = document.createElement('span');
    text.className = 'lt-diag-text';
    text.textContent = item.message;
    li.append(text);
    if (item.location) {
      const where = document.createElement('span');
      where.className = 'lt-diag-where';
      where.textContent = item.location.line ? `${item.location.file}:${item.location.line}` : item.location.file;
      li.append(where);
      if (onOpen) {
        li.classList.add('is-openable');
        li.dataset.tip = 'Open the file (Enter)';
        li.addEventListener('dblclick', () => activate(item));
      }
    }
    for (const action of item.actions ?? []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `lt-diag-action${action.primary ? ' is-primary' : ''}`;
      b.textContent = action.label;
      b.disabled = !!action.disabled;
      if (action.tip) b.dataset.tip = action.tip;
      if (action.pressed !== undefined) b.setAttribute('aria-pressed', String(action.pressed));
      b.addEventListener('click', action.run);
      li.append(b);
    }
    return li;
  }

  function activate(item: Problem) {
    if (!item.location || !onOpen) return;
    close();
    onOpen(item.location);
  }

  const popover = mountPopover(button, panel, {
    placement: 'top-start',
    inside: host,
    focus: () => rows()[0],
    onOpen: clearToasts,
    onClose: clearToasts,
  });
  panel.addEventListener('keydown', (e) => {
    if (!(e.target instanceof HTMLElement && list.contains(e.target))) return;
    const all = rows();
    const at = all.indexOf(e.target.closest<HTMLElement>('[role="listitem"]') as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    } else if (e.key === 'Enter' && at >= 0 && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      activate(current[at]);
    }
  });
  function close() {
    popover.close(false);
  }
  paintButton();
  paintList();

  return {
    sync(items) {
      for (const item of items) if (item.toast && !seen.has(item.id)) popped.set(item.id, TOAST_MS);
      seen = new Set(items.map((item) => item.id));
      for (const id of popped.keys()) if (!seen.has(id)) popped.delete(id);
      current = [...items].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
      paintButton();
      paintList();
      paintToast();
    },
    toggle: popover.toggle,
    close,
    dispose() {
      clearToasts();
      popover.dispose();
    },
  };
}

export { mountProblems };
export type { Problem, ProblemList, Severity };
