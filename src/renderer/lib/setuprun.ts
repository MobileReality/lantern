import type { SetupProgress } from '../../main/setup-progress';
import { activityOf, deriveRunView } from './setupprogress';
import type { RunView, SetupKind } from './setupprogress';

type RunPhase = 'idle' | 'running' | 'stopped' | 'done' | 'failed';

interface RunMeta {
  cost: string;
  secs: string;
  denials: number;
}

interface RunHandlers {
  begin(resumed: boolean): void;
  line(text: string, cls?: string): void;
  tool(tool: string, detail?: string): void;
  done(ok: boolean, meta: RunMeta): void;
  fail(text: string): void;
  cancelled(): void;
}

interface SetupDeps {
  project: string;
  assistant?(): string;
  startRun(kind: SetupKind, handlers: RunHandlers): Promise<void>;
  cancelRun(): Promise<void> | void;
  readProgress(mode: 'live' | 'fresh'): Promise<SetupProgress | null>;
  now(): number;
}

interface LogLine {
  text: string;
  cls?: string;
}

interface SetupSnapshot {
  phase: RunPhase;
  kind: SetupKind | null;
  progress: SetupProgress | null;
  baseline: SetupProgress | null;
  startedAt: number;
  elapsedMs: number;
  activity: string;
  error: string | null;
  resumed: boolean;
  summary: string;
}

const POLL_MS = 2000;
const BASELINE_WAIT_MS = 4000;
const LOG_MAX = 500;

function withinMs<T>(job: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    job.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

// running -> stopped -> running (resumed) -> done, with failed as the other way out of running.
// Stop and Resume only act from the state that allows them, so a double click cancels once.
class SetupRun {
  private snap: SetupSnapshot = { phase: 'idle', kind: null, progress: null, baseline: null, startedAt: 0, elapsedMs: 0, activity: '', error: null, resumed: false, summary: '' };
  private readonly listeners = new Set<() => void>();
  private token = 0;
  private launched = false;
  private polling = false;
  private stopping = false;
  private pending: Promise<void> = Promise.resolve();
  private lastPoll = 0;
  readonly log: LogLine[] = [];

  constructor(private readonly deps: SetupDeps) {}

  get state(): Readonly<SetupSnapshot> {
    return this.snap;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  view(): RunView {
    const { progress, baseline, kind, phase, startedAt, elapsedMs } = this.snap;
    return deriveRunView({ progress, baseline, kind: kind ?? 'lantern', elapsedMs: phase === 'running' ? this.deps.now() - startedAt : elapsedMs });
  }

  isActive() {
    return this.snap.phase === 'running';
  }

  canResume() {
    return !this.stopping && (this.snap.phase === 'stopped' || this.snap.phase === 'failed');
  }

  async start(kind: SetupKind, resumed = false, known: SetupProgress | null = null): Promise<void> {
    if (this.snap.phase === 'running') return;
    const token = ++this.token;
    this.stopping = false;
    this.launched = false;
    this.lastPoll = this.deps.now();
    if (resumed) this.addLog('— resumed —', 'muted');
    this.set({ phase: 'running', kind, progress: known ?? this.snap.progress, baseline: null, startedAt: this.deps.now(), elapsedMs: 0, activity: `Starting ${this.deps.assistant?.() ?? 'Claude'}…`, error: null, resumed, summary: '' });
    const baseline = await withinMs(this.deps.readProgress('fresh'), BASELINE_WAIT_MS, null);
    if (token !== this.token || !this.isActive()) return;
    this.set({ baseline, progress: baseline ?? this.snap.progress });
    this.launched = true;
    const handlers = this.handlers(token);
    try {
      await this.deps.startRun(kind, handlers);
    } catch (e) {
      handlers.fail(e instanceof Error ? e.message : String(e));
    }
  }

  stop(): void {
    if (this.snap.phase !== 'running') return;
    this.token++;
    const elapsedMs = this.deps.now() - this.snap.startedAt;
    const cancelled = this.launched ? this.deps.cancelRun() : undefined;
    if (!(cancelled instanceof Promise)) {
      this.set({ phase: 'stopped', elapsedMs, activity: 'Stopped' });
      this.pending = this.refresh('fresh');
      return;
    }
    this.stopping = true;
    this.set({ phase: 'stopped', elapsedMs, activity: 'Stopped' });
    this.pending = cancelled.catch(() => {}).then(() => {
      this.stopping = false;
      this.listeners.forEach((fn) => { fn(); });
      return this.refresh('fresh');
    });
  }

  resume(): Promise<void> {
    const { kind } = this.snap;
    if (!this.canResume() || !kind) return Promise.resolve();
    return this.start(kind, true);
  }

  settled(): Promise<void> {
    return this.pending;
  }

  dismiss(): void {
    if (this.snap.phase === 'running' || this.snap.phase === 'idle') return;
    this.set({ phase: 'idle' });
  }

  async tick(): Promise<void> {
    if (this.snap.phase !== 'running') return;
    this.listeners.forEach((fn) => { fn(); });
    if (this.polling || this.deps.now() - this.lastPoll < POLL_MS) return;
    this.polling = true;
    this.lastPoll = this.deps.now();
    const token = this.token;
    try {
      const progress = await this.deps.readProgress('live').catch(() => null);
      if (token !== this.token || !progress) return;
      this.set({ progress, baseline: this.snap.baseline ?? progress });
    } finally {
      this.polling = false;
    }
  }

  private async refresh(mode: 'live' | 'fresh') {
    const progress = await this.deps.readProgress(mode).catch(() => null);
    if (progress && this.snap.phase !== 'running') this.set({ progress });
  }

  private handlers(token: number): RunHandlers {
    const live = () => token === this.token && this.snap.phase === 'running';
    return {
      begin: () => {
        if (live()) this.addLog(`Starting ${this.deps.assistant?.() ?? 'Claude'}…`, 'muted');
      },
      line: (text, cls) => {
        if (live()) this.addLog(text, cls);
      },
      tool: (tool, detail) => {
        if (live()) this.set({ activity: activityOf(tool, detail, this.deps.project) || this.snap.activity });
      },
      done: (ok, meta) => {
        if (!live()) return;
        const elapsedMs = this.deps.now() - this.snap.startedAt;
        this.pending = this.refresh('fresh');
        if (ok) {
          this.set({ phase: 'done', elapsedMs, activity: 'Done', summary: [meta.secs, meta.cost].filter(Boolean).join(' · ') });
        } else {
          const error = meta.denials ? `Blocked by ${meta.denials} permission denial(s).` : 'The run did not complete successfully.';
          this.addLog(error, 'err');
          this.set({ phase: 'failed', elapsedMs, error });
        }
      },
      fail: (text) => {
        if (!live()) return;
        const error = text || 'Failed';
        this.addLog(error, 'err');
        this.pending = this.refresh('fresh');
        this.set({ phase: 'failed', elapsedMs: this.deps.now() - this.snap.startedAt, error });
      },
      cancelled: () => {
        if (!live()) return;
        this.pending = this.refresh('fresh');
        this.set({ phase: 'stopped', elapsedMs: this.deps.now() - this.snap.startedAt, activity: 'Stopped' });
      },
    };
  }

  private addLog(text: string, cls?: string) {
    this.log.push({ text, cls });
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    this.listeners.forEach((fn) => { fn(); });
  }

  private set(patch: Partial<SetupSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((fn) => { fn(); });
  }
}

export { SetupRun };
export type { SetupDeps, RunHandlers, RunPhase, SetupSnapshot, LogLine };
