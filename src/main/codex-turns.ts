import type { CodexHookEvent } from './codex-event';

// Codex hook events may lack a turn id and can arrive twice or late, so each session keeps
// a small window of recent turns to drop duplicate and stale Stop/Interrupt/PermissionRequest events.
const CODEX_TURN_LIMIT = 32;
const CODEX_STOP_DEDUPE_MS = 6000;
const CODEX_NOTIFICATION_SEQUENCE_MAX = 1_000_000;

interface CodexTurns {
  active: string;
  generation: number;
  activityAt: number;
  lastNoIdStopAt: number;
  recent: Map<string, number>;
  terminal: Map<string, number>;
  stopped: Map<string, number>;
  interrupted: Map<string, number>;
  permissionSequence: number;
}

const codexTurns = new Map<string, CodexTurns>();

function remember(map: Map<string, number>, value: string, now: number) {
  map.delete(value);
  map.set(value, now);
  while (map.size > CODEX_TURN_LIMIT) map.delete(map.keys().next().value!);
}

function codexTracker(key: string) {
  let tracker = codexTurns.get(key);
  if (!tracker) {
    tracker = { active: '', generation: 0, activityAt: 0, lastNoIdStopAt: 0, recent: new Map(), terminal: new Map(), stopped: new Map(), interrupted: new Map(), permissionSequence: 0 };
    codexTurns.set(key, tracker);
  }
  return tracker;
}

function adoptTurn(tracker: CodexTurns, turn: string, now: number) {
  if (turn === tracker.active) return true;
  if (tracker.recent.has(turn)) return false;
  if (tracker.active) remember(tracker.recent, tracker.active, now);
  tracker.active = turn;
  tracker.terminal.delete(turn);
  return true;
}

function codexTurn(tracker: CodexTurns, event: CodexHookEvent, now: number) {
  if (event.turn_id) return adoptTurn(tracker, event.turn_id, now) ? event.turn_id : '';
  if (event.hook_event_name === 'UserPromptSubmit') {
    const turn = `local:${++tracker.generation}`;
    adoptTurn(tracker, turn, now);
    return turn;
  }
  if (event.hook_event_name === 'Stop' && tracker.stopped.has(tracker.active) && now - tracker.lastNoIdStopAt > CODEX_STOP_DEDUPE_MS) {
    const turn = `fallback:${++tracker.generation}`;
    adoptTurn(tracker, turn, now);
    return turn;
  }
  if (tracker.active) return tracker.active;
  const turn = `${event.hook_event_name === 'Stop' ? 'fallback' : 'local'}:${++tracker.generation}`;
  adoptTurn(tracker, turn, now);
  return turn;
}

function nextPermissionSequence(tracker: CodexTurns) {
  tracker.permissionSequence = tracker.permissionSequence >= CODEX_NOTIFICATION_SEQUENCE_MAX ? 1 : tracker.permissionSequence + 1;
  return tracker.permissionSequence;
}

function dropCodexTracker(key: string) {
  codexTurns.delete(key);
}

function pruneCodexTrackers(keep: (key: string) => boolean) {
  for (const key of codexTurns.keys()) if (!keep(key)) codexTurns.delete(key);
}

export { codexTracker, codexTurn, dropCodexTracker, nextPermissionSequence, pruneCodexTrackers, remember };
export type { CodexTurns };
