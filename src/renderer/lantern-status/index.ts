import type { LanternMap } from '@main/lantern';
import { isMissing } from '@renderer/lib/lanternlayout';
import { providerLabel } from '@renderer/lib/providers';
import type { Provider } from '@main/provider';
import recordsIcon from '@renderer/assets/icons/stat-records.svg';
import relationsIcon from '@renderer/assets/icons/stat-relations.svg';
import mappedIcon from '@renderer/assets/icons/stat-mapped.svg';
import missingIcon from '@renderer/assets/icons/stat-missing.svg';
import unmappedIcon from '@renderer/assets/icons/stat-unmapped.svg';
import freshIcon from '@renderer/assets/icons/stat-fresh.svg';

const ICONS = {
  records: recordsIcon,
  relations: relationsIcon,
  mapped: mappedIcon,
  missing: missingIcon,
  unmapped: unmappedIcon,
  fresh: freshIcon,
};

type Stat = { icon: keyof typeof ICONS; text: string };

function stats(data: LanternMap): Stat[] {
  const unmapped = data.unmappedCount;
  const missing = data.nodes.filter(isMissing).length;
  const items: Stat[] = [
    { icon: 'records', text: `${data.nodes.length} map records` },
    { icon: 'relations', text: `${data.relations.length} relations` },
  ];
  if (data.coveragePending) return items;
  if (data.total) items.push({ icon: 'mapped', text: `${data.total - unmapped}/${data.total} source files mapped` });
  if (missing) items.push({ icon: 'missing', text: `${missing} missing` });
  if (unmapped) items.push({ icon: 'unmapped', text: `${unmapped} source files unmapped` });
  if (!missing && !unmapped) items.push({ icon: 'fresh', text: 'up to date' });
  return items;
}

function renderStats(host: HTMLElement, data: LanternMap | null) {
  host.textContent = '';
  if (!data?.exists) return;
  stats(data).forEach((stat, i) => {
    if (i) host.append(' · ');
    const el = document.createElement('span');
    el.className = `lt-stat lt-stat-${stat.icon}`;
    el.innerHTML = ICONS[stat.icon];
    el.append(stat.text);
    host.append(el);
  });
}

const SESSION_ORDER = ['permission', 'failed', 'stopped', 'running', 'shell', 'done', 'idle', 'unknown', 'unavailable'] as const;
const SESSION_WORD: Record<(typeof SESSION_ORDER)[number], string> = {
  permission: 'needs you',
  failed: 'failed',
  stopped: 'stopped',
  running: 'working',
  shell: 'running a shell',
  done: 'finished',
  idle: 'waiting',
  unknown: 'state unknown',
  unavailable: 'status unavailable',
};

function renderSessions(host: HTMLElement, sessions: { state: string; provider?: Provider }[], assistant: string) {
  const states = sessions.map((s) => s.state);
  const state = SESSION_ORDER.find((s) => states.includes(s));
  const n = state ? states.filter((s) => s === state).length : 0;
  const shown = sessions.find((s) => s.state === state)?.provider;
  if (shown) assistant = providerLabel(shown);
  host.className = `lt-session is-${state ?? 'none'}`;
  host.textContent = '';
  const dot = document.createElement('i');
  dot.setAttribute('aria-hidden', 'true');
  const text = state ? `${assistant} ${SESSION_WORD[state]}${n > 1 ? ` · ${n} sessions` : ''}` : `No ${assistant} session running`;
  host.append(dot, text);
  host.dataset.tip = states.length > n ? `${text} · ${states.length} sessions in all` : text;
}

export { renderSessions, renderStats };
