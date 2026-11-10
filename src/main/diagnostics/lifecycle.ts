import type { CrashNotice, DiagnosticEntry, DiagnosticInput } from '../../shared/diagnostics';

export const STARTED: DiagnosticInput = { source: 'app', severity: 'info', message: 'Lantern started' };
export const QUIT_NORMALLY: DiagnosticInput = { source: 'app', severity: 'info', message: 'Lantern quit normally' };
export const CLOSED_UNEXPECTEDLY = 'Lantern closed unexpectedly last time';

const isMarker = (entry: DiagnosticEntry, marker: DiagnosticInput) => entry.source === marker.source && entry.message === marker.message;

export function crashNoticeFor(previous: DiagnosticEntry[], currentSession: string): CrashNotice | null {
  const earlier = previous.filter((entry) => entry.session !== currentSession);
  const last = earlier.at(-1);
  if (!last) return null;
  const run = earlier.filter((entry) => entry.session === last.session);
  const fatal = run.find((entry) => entry.severity === 'fatal');
  if (fatal) return { session: last.session, time: fatal.time, reason: 'fatal' };
  if (run.some((entry) => isMarker(entry, QUIT_NORMALLY))) return null;
  if (!run.some((entry) => isMarker(entry, STARTED))) return null;
  return { session: last.session, time: last.time, reason: 'unclean-exit' };
}
