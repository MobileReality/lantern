import { DIAGNOSTIC_SEVERITIES, LIST_LIMIT, isQuietEditorEntry, type DiagnosticEntry, type DiagnosticSeverity, type DiagnosticSource } from '../../shared/diagnostics';

export const ANY = 'all';

export interface DiagnosticsFilter {
  severity: DiagnosticSeverity | typeof ANY;
  source: DiagnosticSource | typeof ANY;
  editor?: boolean;
}

export const NO_FILTER: DiagnosticsFilter = { severity: ANY, source: ANY };

export function isShown(entry: DiagnosticEntry, filter: DiagnosticsFilter): boolean {
  if (filter.source === 'editor') return true;
  return Boolean(filter.editor) || !isQuietEditorEntry(entry);
}

export function applyFilter(entries: DiagnosticEntry[], filter: DiagnosticsFilter): DiagnosticEntry[] {
  return entries
    .filter((entry) => isShown(entry, filter) && (filter.severity === ANY || entry.severity === filter.severity) && (filter.source === ANY || entry.source === filter.source))
    .reverse();
}

export function mergeEntry(entries: DiagnosticEntry[], entry: DiagnosticEntry): DiagnosticEntry[] {
  if (entries.some((known) => known.id === entry.id)) return entries;
  const merged = [...entries, entry];
  return merged.length > LIST_LIMIT ? merged.slice(merged.length - LIST_LIMIT) : merged;
}

export function severityCounts(entries: DiagnosticEntry[]): Record<DiagnosticSeverity, number> {
  const counts = Object.fromEntries(DIAGNOSTIC_SEVERITIES.map((severity) => [severity, 0])) as Record<DiagnosticSeverity, number>;
  for (const entry of entries) counts[entry.severity]++;
  return counts;
}

export const previousRun = (entry: DiagnosticEntry, session: string) => entry.session !== session;
