export const MEMORY_SAMPLE_INTERVAL_MS = 5000;
export const MEMORY_HISTORY_LENGTH = 36;
export const MEMORY_TOP_COUNT = 10;
export const OLD_PROCESS_SECONDS = 24 * 60 * 60;
export const LARGE_PROCESS_BYTES = 1024 * 1024 * 1024;

export const MEMORY_CATEGORIES = ['app', 'editor', 'agents', 'other'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_CATEGORY_LABEL: Record<MemoryCategory, string> = {
  app: 'Lantern app',
  editor: 'Editor server',
  agents: 'Agents',
  other: 'Other children',
};

export const MEMORY_KINDS = [
  'main',
  'renderer',
  'gpu',
  'utility',
  'server',
  'extension-host',
  'tsserver',
  'watcher',
  'pty-host',
  'agent-host',
  'extension',
  'claude',
  'codex',
  'test',
  'dev-server',
  'git',
  'shell',
  'node',
  'other',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface MemoryProcess {
  pid: number;
  category: MemoryCategory;
  kind: MemoryKind;
  name: string;
  label: string;
  project: string | null;
  ageSeconds: number;
  bytes: number;
  history: number[];
  oldAndLarge: boolean;
}

export interface MemoryCategoryRow {
  category: MemoryCategory;
  bytes: number;
  count: number;
}

export interface MemoryProjectRow {
  project: string | null;
  hosts: number;
  agents: number;
  tsserver: number;
  total: number;
  count: number;
}

export interface MemorySnapshot {
  takenAt: number;
  sampleMs: number;
  totalBytes: number;
  processCount: number;
  installedBytes: number | null;
  freePercent: number | null;
  categories: MemoryCategoryRow[];
  projects: MemoryProjectRow[];
  processes: MemoryProcess[];
  totalHistory: number[];
  oldAndLargeCount: number;
}

export type MemoryViewState = { supported: false } | { supported: true; snapshot: MemorySnapshot | null };

export const MEMORY_UPDATE_CHANNEL = 'memory:update';
export const MEMORY_WATCH_CHANNEL = 'memory:watch';
export const MEMORY_FREE_CHANNEL = 'memory:free-project';

export type FreeMemoryFailure = 'unsupported' | 'invalid-project' | 'no-server' | 'shared-window' | 'no-host' | 'unreadable';
export type FreeMemoryResult = { ok: true; terminated: Partial<Record<MemoryKind, number>> } | { ok: false; reason: FreeMemoryFailure };

export function isOldAndLarge(bytes: number, ageSeconds: number) {
  return ageSeconds > OLD_PROCESS_SECONDS && bytes > LARGE_PROCESS_BYTES;
}
