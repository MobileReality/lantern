import { randomBytes } from 'node:crypto';
import { LIST_LIMIT, type CrashNotice, type DiagnosticEntry, type DiagnosticInput, type DiagnosticsListing } from '../../shared/diagnostics';
import { CLOSED_UNEXPECTEDLY, QUIT_NORMALLY, STARTED, crashNoticeFor } from './lifecycle';
import { createEntry } from './record';
import { createDiagnosticsStore, type DiagnosticsStore } from './store';
import { createThrottle } from './throttle';
import type { RotationLimits } from './rotation';
import type { ReportContext } from './report';

const ID_BYTES = 6;
const SESSION_BYTES = 4;
const PROJECTS_TTL_MS = 5000;

export interface ServiceDeps {
  file: string;
  platform: string;
  arch: string;
  version: string;
  electron: string;
  node: string;
  packaged: boolean;
  home: string;
  projects: () => string[];
  now?: () => number;
  limits?: RotationLimits;
  onError?: (error: Error) => void;
}

export interface DiagnosticsService {
  session: string;
  begin(): void;
  record(input: DiagnosticInput): DiagnosticEntry | null;
  markQuit(): void;
  listing(): DiagnosticsListing;
  find(id: string): DiagnosticEntry | undefined;
  subscribe(listener: (entry: DiagnosticEntry) => void): () => void;
  pendingNotice(): CrashNotice | null;
  dismissNotice(): void;
  reportContext(): ReportContext;
  store: DiagnosticsStore;
}

export function createDiagnosticsService(deps: ServiceDeps): DiagnosticsService {
  const now = deps.now ?? Date.now;
  const session = randomBytes(SESSION_BYTES).toString('hex');
  const store = createDiagnosticsStore({ file: deps.file, now, limits: deps.limits, onError: deps.onError });
  const throttle = createThrottle({ now });
  let notice: CrashNotice | null = null;
  let cachedProjects: { at: number; list: string[] } | null = null;
  const projects = () => {
    if (!cachedProjects || now() - cachedProjects.at > PROJECTS_TTL_MS) {
      let list: string[] = [];
      try {
        list = deps.projects();
      } catch {
        // Redaction still removes home folders when the project list is unavailable.
      }
      cachedProjects = { at: now(), list };
    }
    return cachedProjects.list;
  };

  const recordContext = () => ({
    platform: deps.platform,
    arch: deps.arch,
    version: deps.version,
    session,
    home: deps.home,
    projects,
    now,
    newId: () => `${now().toString(36)}-${randomBytes(ID_BYTES).toString('hex')}`,
  });

  function record(input: DiagnosticInput) {
    if (!throttle.allow(`${input.source}|${input.severity}|${input.message}`)) return null;
    const entry = createEntry(input, recordContext());
    store.append(entry);
    return entry;
  }

  return {
    session,
    store,
    begin() {
      const previous = store.load();
      notice = crashNoticeFor(previous, session);
      if (notice) record({ source: 'app', severity: 'warning', message: CLOSED_UNEXPECTEDLY, detail: `Run ${notice.session}: ${notice.reason === 'fatal' ? 'a crash was recorded' : 'no normal quit was recorded'}.` });
      record(STARTED);
    },
    record,
    markQuit: () => void record(QUIT_NORMALLY),
    listing: () => ({ entries: store.list().slice(-LIST_LIMIT), session }),
    find: (id) => store.list().find((entry) => entry.id === id),
    subscribe: (listener) => store.subscribe(listener),
    pendingNotice: () => notice,
    dismissNotice: () => {
      notice = null;
    },
    reportContext: () => ({
      version: deps.version,
      platform: deps.platform,
      arch: deps.arch,
      electron: deps.electron,
      node: deps.node,
      packaged: deps.packaged,
      home: deps.home,
      projects,
      now,
    }),
  };
}
