const FINISHED_SESSION_STATES: ReadonlySet<string> = new Set(['done', 'failed', 'stopped', 'ended']);

// Anything that is not clearly finished (running, waiting, needs approval, unknown, status
// unavailable) counts as a live agent: ending its tab or its app would end it.
export function hasLiveSession(sessions: readonly { state: string }[]): boolean {
  return sessions.some((session) => !FINISHED_SESSION_STATES.has(session.state));
}

export function liveSessionCount(sessions: readonly { state: string }[]): number {
  return sessions.filter((session) => !FINISHED_SESSION_STATES.has(session.state)).length;
}
