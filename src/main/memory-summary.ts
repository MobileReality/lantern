import path from 'node:path';
import {
  MEMORY_CATEGORIES,
  MEMORY_HISTORY_LENGTH,
  MEMORY_TOP_COUNT,
  isOldAndLarge,
  type MemoryProcess,
  type MemoryProjectRow,
  type MemorySnapshot,
} from '../shared/memory';
import type { MemorySample, SampledProcess } from './memory-collect';

interface Track {
  ageSeconds: number;
  bytes: number[];
}

export class MemoryHistory {
  private tracks = new Map<number, Track>();
  private totals: number[] = [];

  record(processes: SampledProcess[]) {
    const next = new Map<number, Track>();
    for (const { pid, ageSeconds, bytes } of processes) {
      const previous = this.tracks.get(pid);
      const continued = previous !== undefined && ageSeconds >= previous.ageSeconds;
      next.set(pid, { ageSeconds, bytes: [...(continued ? previous.bytes : []), bytes].slice(-MEMORY_HISTORY_LENGTH) });
    }
    this.tracks = next;
    this.totals = [...this.totals, processes.reduce((sum, p) => sum + p.bytes, 0)].slice(-MEMORY_HISTORY_LENGTH);
  }

  series(pid: number) {
    return this.tracks.get(pid)?.bytes ?? [];
  }

  totalSeries() {
    return this.totals;
  }

  clear() {
    this.tracks.clear();
    this.totals = [];
  }
}

export function projectNames(projectPaths: string[]) {
  const unique = [...new Set(projectPaths)];
  const counts = new Map<string, number>();
  for (const p of unique) counts.set(path.basename(p), (counts.get(path.basename(p)) ?? 0) + 1);
  return new Map(unique.map((p) => [p, (counts.get(path.basename(p)) ?? 0) > 1 ? path.join(path.basename(path.dirname(p)), path.basename(p)) : path.basename(p) || p]));
}

const sum = (processes: SampledProcess[]) => processes.reduce((total, p) => total + p.bytes, 0);

function projectRows(processes: SampledProcess[], names: Map<string, string>): MemoryProjectRow[] {
  const groups = new Map<string | null, SampledProcess[]>();
  for (const p of processes) groups.set(p.projectPath, [...(groups.get(p.projectPath) ?? []), p]);
  const rows = [...groups].map(([projectPath, members]) => ({
    project: projectPath === null ? null : (names.get(projectPath) ?? projectPath),
    hosts: sum(members.filter((p) => p.kind === 'extension-host')),
    agents: sum(members.filter((p) => p.category === 'agents')),
    tsserver: sum(members.filter((p) => p.kind === 'tsserver')),
    total: sum(members),
    count: members.length,
  }));
  return rows.sort((a, b) => Number(a.project === null) - Number(b.project === null) || b.total - a.total);
}

export function summarize(sample: MemorySample, history: MemoryHistory): MemorySnapshot {
  history.record(sample.processes);
  const names = projectNames(sample.processes.flatMap((p) => (p.projectPath ? [p.projectPath] : [])));
  const ranked = [...sample.processes].sort((a, b) => b.bytes - a.bytes);
  const flagged = ranked.filter((p) => isOldAndLarge(p.bytes, p.ageSeconds));
  const shown = new Set([...ranked.slice(0, MEMORY_TOP_COUNT), ...flagged]);
  const processes: MemoryProcess[] = ranked
    .filter((p) => shown.has(p))
    .map((p) => ({
      pid: p.pid,
      category: p.category,
      kind: p.kind,
      name: p.name,
      label: p.label,
      project: p.projectPath === null ? null : (names.get(p.projectPath) ?? p.projectPath),
      ageSeconds: p.ageSeconds,
      bytes: p.bytes,
      history: history.series(p.pid),
      oldAndLarge: isOldAndLarge(p.bytes, p.ageSeconds),
    }));
  return {
    takenAt: sample.takenAt,
    sampleMs: sample.sampleMs,
    totalBytes: sum(sample.processes),
    processCount: sample.processes.length,
    installedBytes: sample.installedBytes,
    freePercent: sample.freePercent,
    categories: MEMORY_CATEGORIES.map((category) => {
      const members = sample.processes.filter((p) => p.category === category);
      return { category, bytes: sum(members), count: members.length };
    }),
    projects: projectRows(sample.processes, names),
    processes,
    totalHistory: history.totalSeries(),
    oldAndLargeCount: flagged.length,
  };
}
