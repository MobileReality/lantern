import { parseEntry, type DiagnosticEntry } from '../../shared/diagnostics';

export interface RotationLimits {
  maxEntries: number;
  maxBytes: number;
  maxAgeMs: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_LIMITS: RotationLimits = {
  maxEntries: 2000,
  maxBytes: 2 * 1024 * 1024,
  maxAgeMs: 30 * MS_PER_DAY,
};

export const serializeEntry = (entry: DiagnosticEntry) => JSON.stringify(entry);

export function parseLog(text: string): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = parseEntry(JSON.parse(line));
      if (entry) entries.push(entry);
    } catch {
      // A torn last line after a crash is expected; the rest of the log stays readable.
    }
  }
  return entries;
}

export function rotateEntries(entries: DiagnosticEntry[], limits: RotationLimits, now: number): DiagnosticEntry[] {
  const fresh = entries.filter((entry) => now - Date.parse(entry.time) <= limits.maxAgeMs);
  const kept = fresh.slice(Math.max(0, fresh.length - limits.maxEntries));
  let bytes = kept.reduce((sum, entry) => sum + serializeEntry(entry).length + 1, 0);
  let drop = 0;
  while (bytes > limits.maxBytes && drop < kept.length - 1) {
    bytes -= serializeEntry(kept[drop]).length + 1;
    drop++;
  }
  return kept.slice(drop);
}
