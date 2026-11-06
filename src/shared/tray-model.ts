// Order is urgency: the first of its sessions' states in this list is the one a project row shows.
export const TRAY_STATES = ['permission', 'failed', 'idle', 'running', 'done', 'shell', 'stopped', 'unknown', 'unavailable', 'ended', 'open'] as const;

export type TrayState = (typeof TRAY_STATES)[number];

export const TRAY_SECTIONS = ['needs', 'working', 'finished', 'other'] as const;

export type TraySection = (typeof TRAY_SECTIONS)[number];

export const TRAY_TONES = ['permission', 'failed', 'waiting', 'working', 'finished', 'stopped', 'quiet'] as const;

export type TrayTone = (typeof TRAY_TONES)[number];

interface StateTraits {
  section: TraySection;
  tone: TrayTone;
}

const TRAITS: Record<TrayState, StateTraits> = {
  permission: { section: 'needs', tone: 'permission' },
  failed: { section: 'needs', tone: 'failed' },
  idle: { section: 'needs', tone: 'waiting' },
  running: { section: 'working', tone: 'working' },
  done: { section: 'finished', tone: 'finished' },
  shell: { section: 'finished', tone: 'finished' },
  stopped: { section: 'other', tone: 'stopped' },
  unknown: { section: 'other', tone: 'quiet' },
  unavailable: { section: 'other', tone: 'quiet' },
  ended: { section: 'other', tone: 'stopped' },
  open: { section: 'other', tone: 'quiet' },
};

const MAX_TAIL_SEGMENTS = 3;
const ELLIPSIS = '…';

export interface TrayGroupInput {
  name: string;
  path: string;
  sessions: { state: string; provider?: string; updatedAt?: number }[];
}

export interface TrayRow {
  path: string;
  name: string;
  tail: string;
  state: TrayState;
  tone: TrayTone;
  count: number;
}

export interface TraySectionView {
  id: TraySection;
  rows: TrayRow[];
}

export interface TrayTest {
  kind: string;
  label: string;
}

export interface TrayModel {
  needsYou: number;
  tone: TrayTone;
  sections: TraySectionView[];
  empty: boolean;
  canClear: boolean;
  tests: TrayTest[];
}

export interface TrayModelOptions {
  home: string;
  tests: TrayTest[];
  isClearable: (provider: string | undefined, state: string) => boolean;
}

const rankOf = (state: TrayState) => TRAY_STATES.indexOf(state);

function asState(value: string): TrayState {
  return (TRAY_STATES as readonly string[]).includes(value) ? (value as TrayState) : 'unknown';
}

export function pathTail(fullPath: string, home: string): string {
  const parts = fullPath.split(/[\\/]/);
  parts.pop();
  const parent = parts.join('/');
  const homeParts = home.split(/[\\/]/).filter(Boolean).length;
  const inHome = home !== '' && (parent === home || parent.startsWith(`${home}/`));
  const segments = parent.split('/').filter(Boolean);
  const shown = inHome ? ['~', ...segments.slice(homeParts)] : segments;
  if (shown.length === 0) return '';
  if (shown.length <= MAX_TAIL_SEGMENTS) return inHome ? shown.join('/') : `/${shown.join('/')}`;
  return inHome ? `~/${ELLIPSIS}/${shown.slice(-(MAX_TAIL_SEGMENTS - 1)).join('/')}` : `${ELLIPSIS}/${shown.slice(-MAX_TAIL_SEGMENTS).join('/')}`;
}

function topState(group: TrayGroupInput): { state: TrayState; count: number; recency: number } {
  const states = group.sessions.map((session) => ({ state: asState(session.state), at: session.updatedAt ?? 0 }));
  if (states.length === 0) return { state: 'open', count: 0, recency: 0 };
  const state = states.reduce((top, next) => (rankOf(next.state) < rankOf(top) ? next.state : top), states[0].state);
  const same = states.filter((entry) => entry.state === state);
  return { state, count: same.length, recency: Math.max(...same.map((entry) => entry.at)) };
}

function byUrgency(a: { rank: number; recency: number; row: TrayRow }, b: typeof a) {
  return a.rank - b.rank || b.recency - a.recency || a.row.name.localeCompare(b.row.name) || a.row.path.localeCompare(b.row.path);
}

export function buildTrayModel(groups: TrayGroupInput[], options: TrayModelOptions): TrayModel {
  const ranked = groups.map((group) => {
    const top = topState(group);
    const row: TrayRow = { path: group.path, name: group.name, tail: pathTail(group.path, options.home), state: top.state, tone: TRAITS[top.state].tone, count: top.count };
    return { rank: rankOf(top.state), recency: top.recency, row, section: TRAITS[top.state].section };
  });
  const sections = TRAY_SECTIONS.map((id) => ({
    id,
    rows: ranked
      .filter((entry) => entry.section === id)
      .sort(byUrgency)
      .map((entry) => entry.row),
  })).filter((section) => section.rows.length > 0);
  const sessions = groups.flatMap((group) => group.sessions.map((session) => ({ provider: session.provider, state: asState(session.state), raw: session.state })));
  const needsYou = sessions.filter((session) => TRAITS[session.state].section === 'needs').length;
  const lead = sections[0]?.rows[0];
  return {
    needsYou,
    tone: lead && sections[0].id !== 'other' ? lead.tone : 'quiet',
    sections,
    empty: groups.length === 0,
    canClear: sessions.some((session) => options.isClearable(session.provider, session.raw)),
    tests: options.tests,
  };
}
