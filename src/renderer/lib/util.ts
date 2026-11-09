import type { PlatformName } from '../../shared/platform';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function isMac(): boolean {
  return /Macintosh|Mac OS X/.test(navigator.userAgent);
}

export function currentPlatform(): PlatformName {
  if (isMac()) return 'mac';
  return /Windows/.test(navigator.userAgent) ? 'windows' : 'linux';
}

export function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}

export function baseName(p: string): string {
  return (p || '').split(/[/\\]/).filter(Boolean).pop() || p || '';
}

const SHARED_FILE_NAMES = new Set(['SKILL.md', 'README.md']);

// Every skill folder has its own SKILL.md, so the folder is part of the label.
export function fileLabel(p: string): string {
  const name = baseName(p);
  if (!SHARED_FILE_NAMES.has(name)) return name;
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.length > 1 ? `${parts[parts.length - 2]}/${name}` : name;
}

// Compact "time since" for list metadata: just now / 5m / 3h / 2d, then a date.
export function relTime(ms: number): string {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const DATE_LOCALE = 'en-GB';

export interface DayOptions {
  year?: boolean;
  utc?: boolean;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * DAY_MS],
  ['month', 30 * DAY_MS],
  ['week', 7 * DAY_MS],
  ['day', DAY_MS],
  ['hour', 60 * MINUTE_MS],
  ['minute', MINUTE_MS],
];
const relativeTime = new Intl.RelativeTimeFormat(DATE_LOCALE, { numeric: 'auto' });
const fullStamp = new Intl.DateTimeFormat(DATE_LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

export function stampTime(stamp: string): number {
  if (!DATE_ONLY.test(stamp)) return Date.parse(stamp);
  const [y, m, d] = stamp.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function timeAgo(stamp: string, now: number): string {
  const t = stampTime(stamp);
  if (!Number.isFinite(t)) return stamp;
  if (DATE_ONLY.test(stamp)) {
    const today = new Date(now);
    const days = Math.round((t - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / DAY_MS);
    if (Math.abs(days) < 7) return relativeTime.format(days, 'day');
  }
  const diff = t - now;
  for (const [unit, ms] of TIME_UNITS) if (Math.abs(diff) >= ms) return relativeTime.format(Math.round(diff / ms), unit);
  return 'just now';
}

export function exactTime(stamp: string): string {
  const t = stampTime(stamp);
  if (!Number.isFinite(t)) return stamp;
  return DATE_ONLY.test(stamp) ? formatDay(t) : fullStamp.format(t);
}

export function formatDay(ms: number, { year = true, utc = false }: DayOptions = {}): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), ...(utc ? { timeZone: 'UTC' } : {}) });
}

// serve-web reports the open folder as a URI path ("/C:/Users/…" on Windows,
// "/Users/…" on macOS). Convert it back to a real OS path so it matches the
// project paths we store and read (flows, skills, etc.).
export function folderToPath(folder: string): string {
  let p = folder || '';
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // "/C:/…" -> "C:/…"
  if (/^[A-Za-z]:/.test(p)) p = p.replace(/\//g, '\\'); // -> "C:\…"
  return p;
}

export function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

// Destructive action in a list row: the first click arms the button, a second
// within the timeout commits. Avoids a blocking dialog for a cheap, regenerable file.
export function confirmBtn(label: string, armedLabel: string, onConfirm: () => void, cls?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls || '';
  b.textContent = label;
  let armed = false;
  let timer = 0;
  const disarm = () => {
    armed = false;
    b.textContent = label;
    b.classList.remove('armed');
    window.clearTimeout(timer);
  };
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      b.textContent = armedLabel;
      b.classList.add('armed');
      timer = window.setTimeout(disarm, 3000);
      return;
    }
    disarm();
    onConfirm();
  });
  return b;
}

export function footBtn(label: string, onClick: () => void, cls?: string): HTMLButtonElement {
  const b = document.createElement('button');
  if (cls) b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
