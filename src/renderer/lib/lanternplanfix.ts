import { isPlanFixTarget, planFixText, slugOf } from '../../shared/lantern-plan-fix';
import type { LanternBrokenPlan, PlanFixSubject } from '../../shared/lantern-plan-fix';
import { VIEW, say } from '../../shared/lantern-plan-messages';
import { esc } from './lanternctx';
import { createCopyFeedback } from './lanternplancopy';
import type { CopyFeedback } from './lanternplancopy';

const FIX_PHASE = { IDLE: 'idle', RUNNING: 'running', DONE: 'done', FAILED: 'failed' } as const;
type FixPhase = (typeof FIX_PHASE)[keyof typeof FIX_PHASE];

interface FixHandlers {
  done(ok: boolean, denials: number): void;
  fail(text: string): void;
  cancelled(): void;
}

interface FixRunner {
  busy(): boolean;
  start(file: string, handlers: FixHandlers): void;
  cancel(): void;
}

interface FixState {
  phase: FixPhase;
  message: string;
}

interface PlanFixOptions {
  copy: (text: string) => Promise<void>;
  runner?: FixRunner;
}

interface PlanFix {
  state(file: string): FixState;
  copied(file: string): boolean;
  copyFailed(file: string): boolean;
  canRun(file: string): boolean;
  copy(subject: PlanFixSubject): Promise<boolean>;
  run(file: string): void;
  cancel(file: string): void;
  settle(troubled: ReadonlySet<string>): void;
  onChange(listener: () => void): () => void;
  dispose(): void;
}

interface FixView {
  file: string;
  copyLabel: string;
  copyTitle: string;
  runLabel: string;
  runTitle: string;
  running: boolean;
  canRun: boolean;
  status: string;
  phase: FixPhase;
}

const IDLE: FixState = { phase: FIX_PHASE.IDLE, message: '' };

function createPlanFix(options: PlanFixOptions): PlanFix {
  const states = new Map<string, FixState>();
  const feedback = new Map<string, CopyFeedback>();
  const failedCopies = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const stateOf = (file: string) => states.get(file) ?? IDLE;

  function set(file: string, state: FixState) {
    states.set(file, state);
    notify();
  }

  function feedbackFor(file: string) {
    const known = feedback.get(file);
    if (known) return known;
    const fresh = createCopyFeedback(options.copy, notify);
    feedback.set(file, fresh);
    return fresh;
  }

  const canRun = (file: string) => options.runner !== undefined && isPlanFixTarget(file);

  return {
    state: stateOf,
    copied: (file) => feedback.get(file)?.copied() ?? false,
    copyFailed: (file) => failedCopies.has(file),
    canRun,
    async copy(subject) {
      failedCopies.delete(subject.file);
      const ok = await feedbackFor(subject.file).copy(planFixText(subject));
      if (!ok) failedCopies.add(subject.file);
      notify();
      return ok;
    },
    run(file) {
      const runner = options.runner;
      if (!runner || !canRun(file) || stateOf(file).phase === FIX_PHASE.RUNNING) return;
      failedCopies.delete(file);
      if (runner.busy()) return set(file, { phase: FIX_PHASE.FAILED, message: say(VIEW.FIX_BUSY) });
      set(file, { phase: FIX_PHASE.RUNNING, message: '' });
      runner.start(file, {
        done: (ok, denials) => set(file, ok ? { phase: FIX_PHASE.DONE, message: '' } : { phase: FIX_PHASE.FAILED, message: denials ? say(VIEW.FIX_DENIED, { count: denials }) : say(VIEW.FIX_UNFINISHED) }),
        fail: (text) => set(file, { phase: FIX_PHASE.FAILED, message: say(VIEW.FIX_FAILED, { error: text }) }),
        cancelled: () => set(file, { phase: FIX_PHASE.FAILED, message: say(VIEW.FIX_CANCELLED) }),
      });
    },
    cancel(file) {
      if (stateOf(file).phase === FIX_PHASE.RUNNING) options.runner?.cancel();
    },
    settle(troubled) {
      let changed = false;
      for (const [file, state] of states) {
        if (state.phase === FIX_PHASE.RUNNING || troubled.has(file)) continue;
        states.delete(file);
        changed = true;
      }
      if (changed) notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      for (const one of feedback.values()) one.dispose();
      listeners.clear();
    },
  };
}

function statusText(fix: PlanFix, file: string) {
  if (fix.copyFailed(file)) return say(VIEW.COPY_FAILED);
  const state = fix.state(file);
  if (state.phase === FIX_PHASE.RUNNING) return say(VIEW.FIX_RUNNING);
  if (state.phase === FIX_PHASE.DONE) return say(VIEW.FIX_DONE);
  return state.message;
}

function fixView(fix: PlanFix, file: string): FixView {
  const running = fix.state(file).phase === FIX_PHASE.RUNNING;
  return {
    file,
    copyLabel: say(fix.copied(file) ? VIEW.COPIED : VIEW.COPY),
    copyTitle: say(VIEW.FIX_COPY_TITLE),
    runLabel: say(running ? VIEW.FIX_CANCEL : VIEW.FIX_RUN),
    runTitle: say(VIEW.FIX_RUN_TITLE),
    running,
    canRun: fix.canRun(file),
    status: statusText(fix, file),
    phase: fix.state(file).phase,
  };
}

function fixBarHtml(fix: PlanFix, file: string) {
  const view = fixView(fix, file);
  const slug = slugOf(file);
  const run = view.canRun ? `<button type="button" class="lt-cm-pill pl-fixrun" data-plan-fix-run="${esc(file)}" aria-pressed="${view.running}" data-tip="${esc(view.runTitle)}">${esc(view.runLabel)}</button>` : '';
  return (
    `<div class="pl-fixbar" role="group" aria-label="${esc(say(VIEW.FIX_GROUP, { slug }))}">` +
    `<button type="button" class="lt-cm-pill pl-copy" data-plan-fix-copy="${esc(file)}" data-tip="${esc(view.copyTitle)}">${esc(view.copyLabel)}</button>${run}` +
    `<span class="pl-fixstate pl-fix-${view.phase}" role="status">${esc(view.status)}</span></div>`
  );
}

function brokenPlanFix(fix: PlanFix, broken: LanternBrokenPlan) {
  const view = fixView(fix, broken.file);
  const actions: { label: string; tip: string; pressed?: boolean; run: () => void }[] = [{ label: view.copyLabel, tip: view.copyTitle, run: () => void fix.copy({ file: broken.file, problems: [], error: broken.error }) }];
  if (view.canRun) actions.push({ label: view.runLabel, tip: view.runTitle, pressed: view.running, run: () => (view.running ? fix.cancel(broken.file) : fix.run(broken.file)) });
  return { status: view.status, actions };
}

export { FIX_PHASE, brokenPlanFix, createPlanFix, fixBarHtml, fixView };
export type { FixHandlers, FixRunner, FixState, FixView, PlanFix, PlanFixOptions };
