const FINISHED_SESSION_STATES: ReadonlySet<string> = new Set(['done', 'failed', 'stopped', 'ended']);

function isLiveSession(session: { state: string }): boolean {
  return !FINISHED_SESSION_STATES.has(session.state);
}

export function hasLiveSession(sessions: readonly { state: string }[]): boolean {
  return sessions.some(isLiveSession);
}

export function liveSessionCount(sessions: readonly { state: string }[]): number {
  return sessions.filter(isLiveSession).length;
}
