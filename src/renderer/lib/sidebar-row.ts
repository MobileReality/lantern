const SVG_OPEN = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const FREE_ICON = `${SVG_OPEN}<rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.6" stroke-width="1.5" /><path d="M6.2 1.8v1.8M9.8 1.8v1.8M6.2 12.4v1.8M9.8 12.4v1.8M1.8 6.2h1.8M1.8 9.8h1.8M12.4 6.2h1.8M12.4 9.8h1.8" stroke-width="1.4" /><path d="M6.2 8h3.6" stroke-width="1.5" /></svg>`;
const REMOVE_ICON = `${SVG_OPEN}<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" stroke-width="1.7" /></svg>`;

export interface RowOpts {
  key: string;
  name: string;
  badge?: string;
  status?: string;
  sub: string;
  active: boolean;
  title?: string;
  cls?: string;
  open: boolean;
  onClick: () => void;
  onRemove: () => void;
  onFree?: () => void;
}

interface ActionButton {
  cls: string;
  icon: string;
  label: string;
  tooltip: string;
  focusKey: string;
  onClick: () => void;
}

function actionButton({ cls, icon, label, tooltip, focusKey, onClick }: ActionButton) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = cls;
  button.innerHTML = icon;
  button.dataset.tip = tooltip;
  button.setAttribute('aria-label', label);
  button.dataset.projectFocus = focusKey;
  button.addEventListener('click', onClick);
  return button;
}

function removeButton({ key, name, title, open, onRemove }: RowOpts) {
  const isProject = title !== undefined;
  const action = isProject ? `Remove ${name} from sidebar` : `Close ${name}`;
  const tooltip = isProject && open ? `${action} and free its memory` : action;
  return actionButton({ cls: 'close', icon: REMOVE_ICON, label: title ? `${action}, ${title}` : action, tooltip, focusKey: `close:${key}`, onClick: onRemove });
}

function freeButton({ key, name, title, onFree }: RowOpts) {
  return actionButton({
    cls: 'free',
    icon: FREE_ICON,
    label: title ? `Free memory of ${name}, ${title}` : `Free memory of ${name}`,
    tooltip: `Free memory: close ${name} and stop its editor processes`,
    focusKey: `free:${key}`,
    onClick: onFree!,
  });
}

export function makeRow(opts: RowOpts) {
  const { key, name, badge, status, sub, active, title, cls, onClick, onFree, open } = opts;
  const row = document.createElement('div');
  row.className = 'proj' + (active ? ' active' : '') + (cls ? ' ' + cls : '');
  if (title) row.dataset.tip = title;
  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'project-select';
  select.dataset.projectFocus = `select:${key}`;
  if (title) select.setAttribute('aria-label', `${name}, ${title}`);
  if (active) select.setAttribute('aria-current', 'page');
  select.addEventListener('click', onClick);
  const b = document.createElement('span');
  if (status) {
    b.className = `badge dot ${status}`;
  } else {
    b.className = 'badge';
    b.textContent = badge || '';
  }
  const n = document.createElement('span');
  n.className = 'name';
  n.textContent = name;
  const s = document.createElement('span');
  s.className = 'state';
  s.textContent = sub || '';
  select.append(b, n, s);
  row.append(select);
  if (open && onFree) row.append(freeButton(opts));
  row.append(removeButton(opts));
  return row;
}
