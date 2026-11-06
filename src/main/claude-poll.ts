import type { SessionSnapshot } from './scanner';

const BASE_INTERVAL_MS = 4000;
const QUIET_INTERVAL_CAP_MS = 30_000;
const FAILURE_INTERVAL_CAP_MS = 60_000;
const NO_WINDOW_INTERVAL_MS = 15_000;
const QUIET_POLLS_AT_BASE = 2;
const CHEAP_INTERVAL_MS = 2000;

interface PollHistory {
  quietPolls: number;
  failures: number;
}

interface PollerDeps {
  scan: () => Promise<SessionSnapshot[] | null>;
  apply: (snapshot: SessionSnapshot[] | null) => void;
  publish: () => void;
  hasOpenWindow: () => boolean;
  cheap?: () => boolean;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

function nextDelay(history: PollHistory, hasOpenWindow: boolean) {
  const backoff = history.failures > 0
    ? Math.min(BASE_INTERVAL_MS * 2 ** history.failures, FAILURE_INTERVAL_CAP_MS)
    : Math.min(BASE_INTERVAL_MS * 2 ** Math.max(0, history.quietPolls - QUIET_POLLS_AT_BASE), QUIET_INTERVAL_CAP_MS);
  return hasOpenWindow ? backoff : Math.max(backoff, NO_WINDOW_INTERVAL_MS);
}

function snapshotSignature(snapshot: SessionSnapshot[] | null) {
  if (snapshot === null) return 'unavailable';
  return JSON.stringify(snapshot.map((row) => [row.id, row.sessionId, row.cwd, row.state, row.startedAt, row.waitingFor, row.changedAt]).sort());
}

function createPoller(deps: PollerDeps) {
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  const history: PollHistory = { quietPolls: 0, failures: 0 };
  let signature = '';
  let inFlight: Promise<void> | null = null;
  let timer: unknown = null;
  let stopped = true;

  function schedule(ms: number) {
    if (stopped) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; void pollNow(); }, ms);
  }

  async function runOnce() {
    let snapshot: SessionSnapshot[] | null = null;
    try {
      snapshot = await deps.scan();
    } catch {
      snapshot = null;
    }
    const next = snapshotSignature(snapshot);
    const changed = next !== signature;
    signature = next;
    history.failures = snapshot === null ? history.failures + 1 : 0;
    history.quietPolls = changed ? 0 : history.quietPolls + 1;
    try {
      deps.apply(snapshot);
      if (changed) deps.publish();
    } catch {}
  }

  function pollNow() {
    if (inFlight) return inFlight;
    inFlight = runOnce().finally(() => {
      inFlight = null;
      schedule(history.failures === 0 && deps.cheap?.() ? CHEAP_INTERVAL_MS : nextDelay(history, deps.hasOpenWindow()));
    });
    return inFlight;
  }

  function start() {
    stopped = false;
    void pollNow();
  }

  function stop() {
    stopped = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function wake() {
    if (stopped || inFlight) return;
    history.quietPolls = 0;
    history.failures = 0;
    if (timer !== null) clearTimer(timer);
    timer = null;
    void pollNow();
  }

  return { start, stop, wake, pollNow };
}

export { BASE_INTERVAL_MS, CHEAP_INTERVAL_MS, QUIET_INTERVAL_CAP_MS, FAILURE_INTERVAL_CAP_MS, NO_WINDOW_INTERVAL_MS, createPoller, nextDelay, snapshotSignature };
