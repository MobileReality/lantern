export type TabPhase = 'connecting' | 'downloading' | 'starting' | 'ready' | 'failed';
type WaitingPhase = Exclude<TabPhase, 'ready' | 'failed'>;
export type PageKind = 'workbench' | 'downloading' | 'booting' | 'blank';

export interface TabLoad {
  phase: TabPhase;
  since: number;
  failedFrom?: WaitingPhase;
}

export interface ServerSnapshot {
  phase?: string;
  progress?: string;
  percent?: number | null;
}

export interface LoadView {
  title: string;
  detail: string;
  hint: string;
  step: number;
  percent: number | null;
  failed: boolean;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;

export const TAB_TIMEOUT_MS: Record<WaitingPhase, number> = {
  connecting: MS_PER_MINUTE,
  downloading: 5 * MS_PER_MINUTE,
  starting: 2 * MS_PER_MINUTE,
};

export const LOAD_STEPS = ['Server', 'VS Code Server', 'Editor'] as const;
const STEP_SERVER = 0;
const STEP_FETCH = 1;
const STEP_EDITOR = 2;

// Runs inside the embedded page. The download placeholder is served by serve-web
// itself (unstyled, black text) whenever it's fetching a server for a new VS Code.
export const PAGE_PROBE_SCRIPT = `(() => {
  if (document.querySelector('.monaco-workbench')) return 'workbench';
  const text = (document.body && document.body.innerText) || '';
  if (/Code Server is downloading/i.test(text)) return 'downloading';
  if (document.querySelector('script[src*="workbench"], link[href*="workbench"]')) return 'booting';
  return 'blank';
})()`;

const PAGE_PHASE: Record<PageKind, TabPhase | null> = {
  workbench: 'ready',
  downloading: 'downloading',
  booting: 'starting',
  blank: null,
};

export function toPageKind(value: unknown): PageKind {
  return typeof value === 'string' && Object.hasOwn(PAGE_PHASE, value) ? (value as PageKind) : 'blank';
}

const isWaiting = (phase: TabPhase): phase is WaitingPhase => phase !== 'ready' && phase !== 'failed';

export function initialTabLoad(now: number): TabLoad {
  return { phase: 'connecting', since: now };
}

// A blank probe is the gap between the download page's own reloads, so it never
// moves the phase; only a recognised page does.
export function observePage(s: TabLoad, kind: PageKind, now: number): TabLoad {
  if (!isWaiting(s.phase)) return s;
  const next = PAGE_PHASE[kind];
  if (!next || next === s.phase) return s;
  return { phase: next, since: now };
}

export function tickTabLoad(s: TabLoad, now: number): TabLoad {
  const { phase } = s;
  if (!isWaiting(phase)) return s;
  return now - s.since > TAB_TIMEOUT_MS[phase] ? { phase: 'failed', since: now, failedFrom: phase } : s;
}

// Only a live editor navigating away restarts the watch; the download page reloads
// itself every 1.5s and must not keep resetting the timeout.
export function navigatedTabLoad(s: TabLoad, now: number): TabLoad {
  return s.phase === 'ready' ? initialTabLoad(now) : s;
}

// Restarting serve-web kills every editor's extension host, including running
// Claude sessions, so only do it when no other tab is live.
export function shouldRestartServer(otherTabPhases: TabPhase[]): boolean {
  return !otherTabPhases.includes('ready');
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const secs = String(total % SECONDS_PER_MINUTE).padStart(2, '0');
  return `${Math.floor(total / SECONDS_PER_MINUTE)}:${secs}`;
}

const SERVER_FAILED_HINT = 'Retry restarts the VS Code server. If it keeps failing, open VS Code once so it can finish updating.';

// The main process's progress line mostly repeats the title, so it's only shown
// when it carries a failure reason.
export function serverView(info: ServerSnapshot): LoadView {
  const percent = typeof info.percent === 'number' ? info.percent : null;
  switch (info.phase) {
    case 'error':
      return { title: 'The editor didn’t start', detail: info.progress || '', hint: SERVER_FAILED_HINT, step: STEP_SERVER, percent: null, failed: true };
    case 'download':
      return { title: 'Downloading VS Code Server…', detail: 'Fetching the server build that matches your VS Code.', hint: 'Happens on first run and once after each VS Code update.', step: STEP_FETCH, percent, failed: false };
    case 'install':
      return { title: 'Installing VS Code Server…', detail: 'Unpacking the server build.', hint: 'Almost there.', step: STEP_FETCH, percent, failed: false };
    case 'extension':
      return { title: 'Installing Claude Code…', detail: 'Adding the Claude Code extension to the editor.', hint: 'This happens once.', step: STEP_SERVER, percent, failed: false };
    default:
      return { title: 'Starting the editor server…', detail: 'Launching VS Code in the background.', hint: '', step: STEP_SERVER, percent, failed: false };
  }
}

const TAB_FAILURE: Record<WaitingPhase, { title: string; detail: string; step: number }> = {
  connecting: { title: 'Can’t reach the editor server', detail: 'The VS Code server stopped answering.', step: STEP_FETCH },
  downloading: { title: 'The VS Code Server update stalled', detail: 'The download didn’t finish in time.', step: STEP_FETCH },
  starting: { title: 'The editor didn’t finish loading', detail: 'VS Code started but never became usable.', step: STEP_EDITOR },
};

export function tabView(s: TabLoad, name: string): LoadView {
  switch (s.phase) {
    case 'failed': {
      const f = TAB_FAILURE[s.failedFrom ?? 'connecting'];
      return { ...f, hint: 'Retry reloads this project and restarts the server when no other editor is open.', percent: null, failed: true };
    }
    case 'downloading':
      return { title: 'Updating VS Code Server…', detail: `VS Code was updated — fetching the matching server before opening ${name}.`, hint: 'Happens once per VS Code update, usually within a minute.', step: STEP_FETCH, percent: null, failed: false };
    case 'starting':
    case 'ready':
      return { title: 'Starting the editor…', detail: `Opening ${name}`, hint: 'Loading VS Code and its extensions.', step: STEP_EDITOR, percent: null, failed: false };
    default:
      return { title: 'Connecting to the editor…', detail: `Opening ${name}`, hint: 'Checking the VS Code server version.', step: STEP_FETCH, percent: null, failed: false };
  }
}
