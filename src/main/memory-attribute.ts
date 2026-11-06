import type { MemoryKind } from '../shared/memory';
import { descendantsOf } from './proctree';
import { isWithin } from './projectroot';

export interface Attributable {
  pid: number;
  ppid: number;
  kind: MemoryKind;
  command: string;
}

const PATH_BEFORE = /[\w./\\-]/;
const PATH_AFTER = /[\w.-]/;

function mentionsPath(command: string, projectPath: string) {
  for (let at = command.indexOf(projectPath); at !== -1; at = command.indexOf(projectPath, at + 1)) {
    const before = command[at - 1];
    const after = command[at + projectPath.length];
    if ((!before || !PATH_BEFORE.test(before)) && (!after || !PATH_AFTER.test(after))) return true;
  }
  return false;
}

function longest(paths: string[]) {
  return paths.reduce<string | null>((best, candidate) => (best === null || candidate.length > best.length ? candidate : best), null);
}

function directProject(entry: Attributable, cwd: string | undefined, projectPaths: string[]) {
  const byCwd = cwd ? longest(projectPaths.filter((p) => isWithin(cwd, p))) : null;
  return byCwd ?? longest(projectPaths.filter((p) => mentionsPath(entry.command, p)));
}

export function attributeProjects(entries: Attributable[], cwds: Map<number, string>, projectPaths: string[]) {
  const known = projectPaths.filter(Boolean);
  const byPid = new Map<number, string>();
  for (const entry of entries) {
    const project = directProject(entry, cwds.get(entry.pid), known);
    if (project) byPid.set(entry.pid, project);
  }
  const direct = new Map(byPid);
  const rows = entries.map((e) => ({ pid: e.pid, ppid: e.ppid, stat: '', command: '' }));
  for (const host of entries.filter((e) => e.kind === 'extension-host' && !direct.has(e.pid))) {
    const below = new Set(descendantsOf(rows, host.pid).flatMap((pid) => direct.get(pid) ?? []));
    if (below.size === 1) byPid.set(host.pid, [...below][0]);
  }
  for (const entry of entries) {
    if (byPid.has(entry.pid)) continue;
    const parent = entries.find((e) => e.pid === entry.ppid);
    const inherited = parent?.kind === 'extension-host' ? byPid.get(parent.pid) : undefined;
    if (inherited) byPid.set(entry.pid, inherited);
  }
  return byPid;
}
