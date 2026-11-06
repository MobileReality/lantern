import path from 'node:path';
import type { CodexHookEvent } from './codex-event';
import { codexTracker, codexTurn, dropCodexTracker, nextPermissionSequence, pruneCodexTrackers, remember } from './codex-turns';
import type { Provider } from './provider';
import type { SessionSnapshot, SessionState } from './scanner';

const STATES = {
  running: { label: 'working…', emoji: '🟢', attention: false },
  done: { label: 'finished', emoji: '✅', attention: true },
  shell: { label: 'finished · background task running', emoji: '✅', attention: true },
  permission: { label: 'needs approval', emoji: '🟠', attention: true },
  idle: { label: 'waiting for you', emoji: '💬', attention: true },
  failed: { label: 'failed', emoji: '🔴', attention: true },
  stopped: { label: 'stopped', emoji: '⚪️', attention: true },
  unknown: { label: 'state unknown', emoji: '❔', attention: false },
  unavailable: { label: 'status unavailable', emoji: '⚪️', attention: false },
  ended: { label: 'closed', emoji: '⚪️', attention: false },
  open: { label: 'open · no Claude session', emoji: '🪟', attention: false },
};

const TERMINAL = new Set(['done', 'idle', 'ended']);
const CLEARABLE_CLAUDE = new Set<string>(['done', 'failed', 'stopped']);
const ENDED_TOMBSTONE_MS = 10 * 60 * 1000;

const NOTICE_FOR_STATE: Partial<Record<SessionState, NoticeKind>> = { idle: 'waiting', permission: 'permission', done: 'finished', shell: 'finished', failed: 'failed' };

interface Session {
  id: string;
  provider: Provider;
  cwd: string;
  project: string;
  state: string;
  lastMessage: string;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  waitingFor?: string;
  transcript?: string;
  lastStopAt?: number;
  source?: string;
}

type NoticeKind = 'waiting' | 'permission' | 'finished' | 'failed';

interface SessionNotice { session: Session; kind: NoticeKind; }

const sessions = new Map<string, Session>();
const endedSessions = new Map<string, number>();
const observedStates = new Map<string, SessionState>();
const observedChanges = new Map<string, number>();
const dismissedStates = new Map<string, SessionState>();
let hasBaseline = false;
let recovering = false;
let statusAvailable = false;

function sessionKey(provider: Provider, id: string) {
  return `${provider}:${id}`;
}

function projectName(cwd: string) {
  if (!cwd) return 'unknown';
  return path.basename(cwd) || cwd;
}

function all() {
  return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function hasEnded(key: string, now = Date.now()) {
  const endedAt = endedSessions.get(key);
  if (endedAt === undefined) return false;
  if (now - endedAt <= ENDED_TOMBSTONE_MS) return true;
  endedSessions.delete(key);
  return false;
}

function pruneEnded(now = Date.now()) {
  for (const [key, endedAt] of endedSessions) {
    if (now - endedAt > ENDED_TOMBSTONE_MS) endedSessions.delete(key);
  }
}

function unavailable() {
  statusAvailable = false;
  if (!hasBaseline) return;
  recovering = true;
  for (const session of sessions.values()) if (session.provider === 'claude') session.state = 'unavailable';
}

function reconcile(found: SessionSnapshot[]): SessionNotice[] {
  const silent = !hasBaseline || recovering;
  const foundIds = new Set(found.map((snapshot) => snapshot.id));
  const notices: SessionNotice[] = [];
  for (const [key, session] of sessions) if (session.provider === 'claude' && !foundIds.has(session.id)) sessions.delete(key);
  for (const id of observedStates.keys()) if (!foundIds.has(id)) observedStates.delete(id);
  for (const id of observedChanges.keys()) if (!foundIds.has(id)) observedChanges.delete(id);
  for (const id of dismissedStates.keys()) if (!foundIds.has(id)) dismissedStates.delete(id);

  for (const snapshot of found) {
    const key = sessionKey('claude', snapshot.id);
    const previous = observedStates.get(snapshot.id);
    const previousChange = observedChanges.get(snapshot.id) ?? 0;
    observedStates.set(snapshot.id, snapshot.state);
    observedChanges.set(snapshot.id, snapshot.changedAt);
    const roundTrip = previous === snapshot.state && previousChange > 0 && snapshot.changedAt > previousChange;
    if (roundTrip) dismissedStates.delete(snapshot.id);
    if (dismissedStates.get(snapshot.id) !== snapshot.state) dismissedStates.delete(snapshot.id);
    if (dismissedStates.get(snapshot.id) === snapshot.state) {
      sessions.delete(key);
      continue;
    }

    const session: Session = sessions.get(key) ?? {
      id: snapshot.id, provider: 'claude', sessionId: snapshot.sessionId, cwd: snapshot.cwd, project: projectName(snapshot.cwd),
      state: snapshot.state, lastMessage: '', createdAt: snapshot.startedAt, updatedAt: snapshot.startedAt, waitingFor: snapshot.waitingFor,
    };
    const changed = session.sessionId !== snapshot.sessionId || session.cwd !== snapshot.cwd || session.state !== snapshot.state || session.createdAt !== snapshot.startedAt || session.waitingFor !== snapshot.waitingFor || roundTrip;
    session.sessionId = snapshot.sessionId;
    session.cwd = snapshot.cwd;
    session.project = projectName(snapshot.cwd);
    session.state = snapshot.state;
    session.createdAt = snapshot.startedAt;
    if (changed) session.updatedAt = Date.now();
    session.waitingFor = snapshot.waitingFor;
    sessions.set(key, session);

    // The background task ending after a finished turn is not a second finish.
    const taskEnded = previous === 'shell' && snapshot.state === 'done';
    if (!silent && previous && previous !== 'unknown' && !taskEnded && (previous !== snapshot.state || roundTrip)) {
      const kind = NOTICE_FOR_STATE[snapshot.state];
      if (kind) notices.push({ session, kind });
    }
  }
  hasBaseline = true;
  recovering = false;
  statusAvailable = true;
  return notices;
}

function isAvailable() { return statusAvailable; }

function isClearable(provider: string | undefined, sessionState: string) {
  return provider === 'claude' ? CLEARABLE_CLAUDE.has(sessionState) : TERMINAL.has(sessionState);
}

function clearFinished() {
  for (const [key, s] of sessions) {
    if (!isClearable(s.provider, s.state)) continue;
    if (s.provider === 'claude') dismissedStates.set(s.id, s.state as SessionState);
    sessions.delete(key);
  }
  pruneEnded();
}

// Drop finished hook sessions after `maxAgeMs` so the list doesn't grow forever
// (scan sessions are reconciled in mergeDiscovered).
function pruneStale(maxAgeMs = 2 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if ((s.source === 'hook' || s.source === 'runner') && TERMINAL.has(s.state) && now - s.updatedAt > maxAgeMs) {
      sessions.delete(id);
    }
  }
  pruneEnded(now);
  pruneCodexTrackers((key) => sessions.has(key) || hasEnded(key, now));
}

function applyCodexEvent(event: CodexHookEvent) {
  const key = sessionKey('codex', event.session_id);
  if (hasEnded(key) && event.hook_event_name !== 'SessionStart') return null;
  const now = Date.now();
  const tracker = codexTracker(key);
  const turn = !['SessionStart', 'SessionEnd'].includes(event.hook_event_name) ? codexTurn(tracker, event, now) : '';
  if (!turn && !['SessionStart', 'SessionEnd'].includes(event.hook_event_name)) return null;
  const existing = sessions.get(key);
  const session = existing || {
    id: event.session_id,
    provider: 'codex' as const,
    cwd: event.cwd,
    project: projectName(event.cwd),
    state: 'running',
    transcript: '',
    lastMessage: '',
    createdAt: now,
    updatedAt: now,
    lastStopAt: 0,
    source: 'hook',
  };
  session.source = 'hook';
  session.cwd = event.cwd;
  session.project = projectName(event.cwd);
  session.updatedAt = now;
  let notify = null;

  if (event.hook_event_name === 'SessionStart') {
    endedSessions.delete(key);
    if (!tracker.activityAt) session.state = 'running';
  } else if (event.hook_event_name === 'SessionEnd') {
    endedSessions.set(key, now);
    dropCodexTracker(key);
    sessions.delete(key);
    return { session: { ...session, state: 'ended' }, notify: null };
  } else {
    tracker.activityAt = now;
    if (event.hook_event_name === 'UserPromptSubmit') {
      tracker.terminal.delete(turn);
      tracker.interrupted.delete(turn);
      session.state = 'running';
    } else if (event.hook_event_name === 'PermissionRequest') {
      if (tracker.terminal.has(turn)) return null;
      session.state = 'permission';
      notify = { kind: 'permission', id: `codex-${event.session_id}-${turn}-permission-${nextPermissionSequence(tracker)}`, body: 'Needs your approval to continue' };
    } else if (event.hook_event_name === 'Interrupt') {
      if (tracker.terminal.has(turn)) return null;
      remember(tracker.terminal, turn, now);
      remember(tracker.interrupted, turn, now);
      session.state = 'idle';
    } else if (event.hook_event_name === 'Stop') {
      if (tracker.interrupted.has(turn)) return null;
      const first = !tracker.stopped.has(turn);
      remember(tracker.stopped, turn, now);
      remember(tracker.terminal, turn, now);
      tracker.lastNoIdStopAt = event.turn_id ? tracker.lastNoIdStopAt : now;
      session.state = 'done';
      session.lastStopAt = now;
      if (typeof event.last_assistant_message === 'string') session.lastMessage = event.last_assistant_message;
      if (first) notify = { kind: 'stop', id: `codex-${event.session_id}-${turn}`, body: 'Finished — waiting for your reply' };
    }
  }

  sessions.set(key, session);
  return { session, notify };
}

// Reconcile scan-discovered sessions: never notifies, never overrides a hook
// session, and drops scan sessions no longer present so the list stays current.
function mergeDiscovered(found: any[]) {
  const foundIds = new Set(found.map((f) => sessionKey(f.provider === 'codex' ? 'codex' : 'claude', f.id)));
  for (const [key, s] of sessions) {
    if (s.source === 'scan' && !foundIds.has(key)) sessions.delete(key);
  }
  const now = Date.now();
  for (const f of found) {
    const provider: Provider = f.provider === 'codex' ? 'codex' : 'claude';
    const key = sessionKey(provider, f.id);
    if (hasEnded(key, now)) continue;
    const existing = sessions.get(key);
    if (existing && existing.source !== 'scan') continue;
    const session = existing || {
      id: f.id,
      provider,
      cwd: f.cwd,
      project: f.project,
      state: f.state,
      transcript: '',
      lastMessage: '',
      createdAt: now,
      updatedAt: f.updatedAt,
      lastStopAt: 0,
      source: 'scan',
    };
    session.cwd = f.cwd;
    session.project = f.project;
    session.state = f.state;
    session.updatedAt = f.updatedAt;
    session.source = 'scan';
    sessions.set(key, session);
  }
}

function upsertRunnerSession(provider: Provider, id: string, cwd: string) {
  if (!id || !cwd) return;
  const key = sessionKey(provider, id);
  if (hasEnded(key)) return;
  const now = Date.now();
  const existing = sessions.get(key);
  if (existing?.source === 'hook') {
    existing.updatedAt = now;
    return;
  }
  sessions.set(key, {
    id,
    provider,
    cwd,
    project: projectName(cwd),
    state: 'running',
    transcript: existing?.transcript || '',
    lastMessage: existing?.lastMessage || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastStopAt: existing?.lastStopAt || 0,
    source: existing?.source === 'hook' ? 'hook' : 'runner',
  });
}

function finishRunnerSession(provider: Provider, id: string, ok: boolean) {
  const session = sessions.get(sessionKey(provider, id));
  if (!session || session.state !== 'running') return false;
  session.state = ok ? 'done' : 'idle';
  session.updatedAt = Date.now();
  return true;
}

function latest(project: string, provider: Provider, rootForCwd: (cwd: string) => string = (cwd) => cwd) {
  return all().find((session) => session.provider === provider && rootForCwd(session.cwd) === project) || null;
}

export type { NoticeKind, SessionNotice };
export { STATES, ENDED_TOMBSTONE_MS, applyCodexEvent, mergeDiscovered, reconcile, unavailable, isAvailable, all, isClearable, clearFinished, pruneStale, upsertRunnerSession, finishRunnerSession, latest };
