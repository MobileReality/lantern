import type { ParsedRecord } from './lantern-parse';

const TEST_ROLE = 'test';

interface FileSystem {
  system: string;
  count: number;
}

type SystemsByPath = Readonly<Record<string, readonly FileSystem[]>>;

function bySizeThenName(a: FileSystem, b: FileSystem) {
  return b.count - a.count || a.system.localeCompare(b.system);
}

function systemsOfRecord(record: ParsedRecord): FileSystem[] {
  const counts = new Map<string, number>();
  for (const relation of record.relations) if (relation.ext !== null) counts.set(relation.ext, (counts.get(relation.ext) ?? 0) + 1);
  return [...counts].map(([system, count]) => ({ system, count })).sort(bySizeThenName);
}

function macroSystemsByPath(records: readonly ParsedRecord[]): SystemsByPath {
  const byPath: Record<string, FileSystem[]> = {};
  for (const record of records) {
    if (record.role === TEST_ROLE) continue;
    const systems = systemsOfRecord(record);
    if (systems.length) byPath[record.path] = systems;
  }
  return byPath;
}

export { macroSystemsByPath };
export type { FileSystem, SystemsByPath };
